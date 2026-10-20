// ─── NEXUS — Décodage avec cache clé/valeur (KV cache) ───────────────────────
// Sans cache, générer N caractères coûte N passes complètes sur toute la fenêtre
// (O(N²·ctx)) : mesuré à ~110 ms/passe pour dim 64 → 20 s pour une réponse de
// 200 caractères. Avec le cache, chaque nouveau token ne calcule QUE sa propre
// position et réutilise les clés/valeurs déjà produites : ~1 ms/token.
//
// Ce module réimplémente exactement la même passe avant que `model.forward()`
// (mêmes poids, même ordre des opérations, LayerNorm/GELU identiques) mais en
// Float32Array purs, sans autograd : c'est le chemin d'inférence du chat.
//
// Vérifié contre `forward()` : les logits produits token par token sont égaux
// aux logits de la passe complète (voir scripts/check-kv.ts).

import type { LmConfig, LmParams } from './model'

const GELU_C = Math.sqrt(2 / Math.PI)

interface LayerCache {
  /** Clés accumulées : [cap, dim] (ordre d'arrivée). */
  k: Float32Array
  /** Valeurs accumulées : [cap, dim]. */
  v: Float32Array
  len: number
}

export interface KvState {
  cfg: LmConfig
  params: LmParams
  layers: LayerCache[]
  /** Position courante (= nombre de tokens en cache). */
  pos: number
  /** Historique des ids en cache (pour re-préfiller après débordement). */
  ids: number[]
  /** Buffers réutilisés (zéro allocation par token). */
  buf: {
    x: Float32Array
    h: Float32Array
    q: Float32Array
    k: Float32Array
    v: Float32Array
    a: Float32Array
    scores: Float32Array
    f: Float32Array
    logits: Float32Array
  }
}

/** Crée un état de décodage vide (capacité = contexte du modèle). */
export function createKv(cfg: LmConfig, params: LmParams): KvState {
  const cap = cfg.ctx
  const layers: LayerCache[] = []
  for (let l = 0; l < cfg.layers; l++) {
    layers.push({ k: new Float32Array(cap * cfg.dim), v: new Float32Array(cap * cfg.dim), len: 0 })
  }
  return {
    cfg,
    params,
    layers,
    pos: 0,
    ids: [],
    buf: {
      x: new Float32Array(cfg.dim),
      h: new Float32Array(cfg.dim),
      q: new Float32Array(cfg.dim),
      k: new Float32Array(cfg.dim),
      v: new Float32Array(cfg.dim),
      a: new Float32Array(cfg.dim),
      scores: new Float32Array(cap),
      f: new Float32Array(4 * cfg.dim),
      logits: new Float32Array(cfg.vocab),
    },
  }
}

/** Vide le cache (nouvelle génération). */
export function resetKv(kv: KvState): void {
  for (const l of kv.layers) l.len = 0
  kv.pos = 0
  kv.ids.length = 0
}

// ── Primitives (identiques à tensor.ts, mais sur des vecteurs) ────────────────

function layerNormVec(x: Float32Array, g: Float32Array, b: Float32Array, out: Float32Array, eps = 1e-5): void {
  const D = x.length
  let mean = 0
  for (let i = 0; i < D; i++) mean += x[i]
  mean /= D
  let variance = 0
  for (let i = 0; i < D; i++) {
    const d = x[i] - mean
    variance += d * d
  }
  const r = 1 / Math.sqrt(variance / D + eps)
  for (let i = 0; i < D; i++) out[i] = ((x[i] - mean) * r) * g[i] + b[i]
}

/** out[j] = Σ_d x[d] · W[d·cols + j]  (W stockée [rows, cols] = x @ W). */
function matVec(x: Float32Array, W: Float32Array, cols: number, out: Float32Array, bias?: Float32Array): void {
  const K = x.length
  out.fill(0, 0, cols)
  for (let d = 0; d < K; d++) {
    const xv = x[d]
    if (xv === 0) continue
    const off = d * cols
    for (let j = 0; j < cols; j++) out[j] += xv * W[off + j]
  }
  if (bias) for (let j = 0; j < cols; j++) out[j] += bias[j]
}

function geluVec(x: Float32Array): void {
  for (let i = 0; i < x.length; i++) {
    const v = x[i]
    x[i] = 0.5 * v * (1 + Math.tanh(GELU_C * (v + 0.044715 * v * v * v)))
  }
}

// ── Un token → logits ─────────────────────────────────────────────────────────

/**
 * Fait avancer le modèle d'UN token et renvoie les logits sur le vocabulaire.
 * Positions absolues apprises : `kv.pos` doit rester < cfg.ctx (sinon appeler
 * `refillWindow()` qui re-préremplit le cache sur la dernière fenêtre).
 */
export function stepToken(kv: KvState, id: number): Float32Array {
  const { cfg, params, buf } = kv
  const D = cfg.dim
  const H = cfg.heads
  const dh = D / H
  const pos = kv.pos

  // x = tokEmb[id] + posEmb[pos]
  const x = buf.x
  const tokOff = id * D
  const posOff = pos * D
  for (let i = 0; i < D; i++) x[i] = params.tokEmb.data[tokOff + i] + params.posEmb.data[posOff + i]

  const h = buf.h
  const q = buf.q
  const k = buf.k
  const v = buf.v
  const a = buf.a
  const scores = buf.scores

  for (let li = 0; li < cfg.layers; li++) {
    const l = params.layers[li]
    const cache = kv.layers[li]

    // ── Attention multi-têtes causale (une seule position) ──
    layerNormVec(x, l.ln1g.data, l.ln1b.data, h)
    matVec(h, l.wq.data, D, q)
    matVec(h, l.wk.data, D, k)
    matVec(h, l.wv.data, D, v)

    // On stocke k/v AVANT l'attention (le token courant se voit lui-même).
    const kOff = cache.len * D
    cache.k.set(k, kOff)
    cache.v.set(v, kOff)
    cache.len++

    const scale = 1 / Math.sqrt(dh)
    a.fill(0)
    for (let head = 0; head < H; head++) {
      const dOff = head * dh
      // scores[j] = q_head · k_j_head · scale
      let max = -Infinity
      for (let j = 0; j < cache.len; j++) {
        const jOff = j * D + dOff
        let s = 0
        for (let d = 0; d < dh; d++) s += q[dOff + d] * cache.k[jOff + d]
        s *= scale
        scores[j] = s
        if (s > max) max = s
      }
      let sum = 0
      for (let j = 0; j < cache.len; j++) {
        const e = Math.exp(scores[j] - max)
        scores[j] = e
        sum += e
      }
      const inv = 1 / sum
      for (let j = 0; j < cache.len; j++) {
        const w = scores[j] * inv
        if (w === 0) continue
        const jOff = j * D + dOff
        for (let d = 0; d < dh; d++) a[dOff + d] += w * cache.v[jOff + d]
      }
    }

    // x += a @ Wo
    const wo = l.wo.data
    for (let d = 0; d < D; d++) {
      const av = a[d]
      if (av === 0) continue
      const off = d * D
      for (let j = 0; j < D; j++) x[j] += av * wo[off + j]
    }

    // ── MLP ──
    layerNormVec(x, l.ln2g.data, l.ln2b.data, h)
    const hidden = 4 * D
    const f = buf.f
    matVec(h, l.w1.data, hidden, f, l.b1.data)
    geluVec(f)
    const w2 = l.w2.data
    for (let g = 0; g < hidden; g++) {
      const fv = f[g]
      if (fv === 0) continue
      const off = g * D
      for (let j = 0; j < D; j++) x[j] += fv * w2[off + j]
    }
    for (let j = 0; j < D; j++) x[j] += l.b2.data[j]
  }

  // ── Tête de sortie (liée aux embeddings) ──
  layerNormVec(x, params.lnfg.data, params.lnfb.data, h)
  const logits = buf.logits
  const V = cfg.vocab
  const emb = params.tokEmb.data
  for (let j = 0; j < V; j++) {
    const off = j * D
    let s = 0
    for (let d = 0; d < D; d++) s += h[d] * emb[off + d]
    logits[j] = s
  }

  kv.pos++
  kv.ids.push(id)
  return logits
}

/** Pré-remplit le cache avec une suite de tokens (le prompt). */
export function prefill(kv: KvState, ids: ArrayLike<number>): void {
  for (let i = 0; i < ids.length; i++) {
    if (kv.pos >= kv.cfg.ctx) refillWindow(kv)
    stepToken(kv, ids[i])
  }
}

/**
 * Le contexte est plein : on oublie le plus ancien quart et on reconstruit le
 * cache sur la fenêtre restante (mêmes positions relatives qu'à l'entraînement,
 * où la fenêtre est toujours les `ctx` derniers tokens).
 */
export function refillWindow(kv: KvState): void {
  const keep = Math.max(8, Math.floor(kv.cfg.ctx * 0.75))
  const tail = kv.ids.slice(-keep)
  resetKv(kv)
  for (const id of tail) stepToken(kv, id)
}

/** Nombre de tokens actuellement en cache. */
export function kvLength(kv: KvState): number {
  return kv.pos
}
