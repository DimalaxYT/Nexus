// ─── NEXUS — LLM « code-v1 » : inférence navigateur ──────────────────────────
// Moteur d'inférence du transformeur entraîné hors ligne (train_llm.py, JAX).
// Même architecture que model.ts : pré-norme, attention causale multi-têtes,
// MLP GELU (approximation tanh), LayerNorm eps 1e-5, tête liée à l'embedding.
// Les poids sont un fichier Float32 little-endian dans l'ordre `paramList`
// (tokEmb, posEmb, puis par couche ln1g ln1b wq wk wv wo ln2g ln2b w1 b1 w2 b2,
// puis lnfg lnfb). Aucun appel réseau pendant la génération : tout se passe
// dans le navigateur, sur le PC de l'utilisateur.
//
// Un cache clé/valeur (KV) évite de recalculer tout le contexte à chaque jeton :
// un jeton coûte O(couches · (4·D² + 8·D²) + couches · t · D) opérations.

export interface NexusCodeMeta {
  format: string
  config: { vocab: number; ctx: number; dim: number; heads: number; layers: number }
  vocab: string[]
  steps: number
  loss: number
  params: number
  exportedAt: string
}

interface LayerW {
  ln1g: Float32Array
  ln1b: Float32Array
  wq: Float32Array
  wk: Float32Array
  wv: Float32Array
  wo: Float32Array
  ln2g: Float32Array
  ln2b: Float32Array
  w1: Float32Array
  b1: Float32Array
  w2: Float32Array
  b2: Float32Array
}

export interface NexusCodeWeights {
  tokEmb: Float32Array
  posEmb: Float32Array
  layers: LayerW[]
  lnfg: Float32Array
  lnfb: Float32Array
}

/** Découpe le fichier de poids en vues, dans l'ordre d'export de train_llm.py. */
export function loadWeights(buf: ArrayBuffer, meta: NexusCodeMeta): NexusCodeWeights {
  const { vocab: V, ctx, dim: D, layers: L } = meta.config
  const hid = 4 * D
  const flat = new Float32Array(buf)
  let off = 0
  const take = (n: number) => {
    if (off + n > flat.length) throw new Error('poids tronqués')
    const v = flat.subarray(off, off + n)
    off += n
    return v
  }
  const tokEmb = take(V * D)
  const posEmb = take(ctx * D)
  const layers: LayerW[] = []
  for (let l = 0; l < L; l++) {
    layers.push({
      ln1g: take(D), ln1b: take(D), wq: take(D * D), wk: take(D * D), wv: take(D * D), wo: take(D * D),
      ln2g: take(D), ln2b: take(D), w1: take(D * hid), b1: take(hid), w2: take(hid * D), b2: take(D),
    })
  }
  const lnfg = take(D)
  const lnfb = take(D)
  if (off !== flat.length) throw new Error(`taille inattendue : ${flat.length - off} valeurs en trop`)
  return { tokEmb, posEmb, layers, lnfg, lnfb }
}

/** y = x · W avec W [inDim, outDim] stocké ligne par ligne (même convention que JAX). */
function matVec(x: Float32Array, W: Float32Array, inDim: number, outDim: number, out: Float32Array) {
  out.fill(0)
  for (let i = 0; i < inDim; i++) {
    const xi = x[i]
    if (xi === 0) continue
    const row = i * outDim
    for (let j = 0; j < outDim; j++) out[j] += xi * W[row + j]
  }
}

function layerNormInto(x: Float32Array, g: Float32Array, b: Float32Array, out: Float32Array) {
  const n = x.length
  let mu = 0
  for (let i = 0; i < n; i++) mu += x[i]
  mu /= n
  let va = 0
  for (let i = 0; i < n; i++) {
    const d = x[i] - mu
    va += d * d
  }
  const inv = 1 / Math.sqrt(va / n + 1e-5)
  for (let i = 0; i < n; i++) out[i] = (x[i] - mu) * inv * g[i] + b[i]
}

const GELU_C = Math.sqrt(2 / Math.PI)
function geluInPlace(v: Float32Array) {
  for (let i = 0; i < v.length; i++) {
    const x = v[i]
    v[i] = 0.5 * x * (1 + Math.tanh(GELU_C * (x + 0.044715 * x * x * x)))
  }
}

export class NexusCodeModel {
  readonly meta: NexusCodeMeta
  readonly w: NexusCodeWeights
  private readonly index: Map<string, number>

  constructor(meta: NexusCodeMeta, buf: ArrayBuffer) {
    this.meta = meta
    this.w = loadWeights(buf, meta)
    this.index = new Map(meta.vocab.map((c, i) => [c, i]))
  }

  encode(text: string): number[] {
    const out: number[] = []
    for (const ch of text) out.push(this.index.get(ch) ?? 0)
    return out
  }

  decode(ids: number[]): string {
    let s = ''
    for (const id of ids) {
      const c = this.meta.vocab[id]
      if (c && c !== '\u0000') s += c
    }
    return s
  }

  session(): NexusCodeSession {
    return new NexusCodeSession(this)
  }
}

/** Session d'inférence : cache KV par couche, une position à la fois. */
export class NexusCodeSession {
  private readonly m: NexusCodeModel
  private readonly D: number
  private readonly H: number
  private readonly dh: number
  private readonly ctx: number
  private readonly hid: number
  private readonly K: Float32Array[]
  private readonly V: Float32Array[]
  /** Position suivante (= nombre de jetons déjà dans le cache). */
  pos = 0
  private readonly x: Float32Array
  private readonly h: Float32Array
  private readonly q: Float32Array
  private readonly k: Float32Array
  private readonly v: Float32Array
  private readonly att: Float32Array
  private readonly proj: Float32Array
  private readonly ff: Float32Array
  private readonly scores: Float32Array
  readonly logits: Float32Array

  constructor(model: NexusCodeModel) {
    this.m = model
    const { ctx, dim, heads, layers, vocab } = model.meta.config
    this.D = dim
    this.H = heads
    this.dh = dim / heads
    this.ctx = ctx
    this.hid = 4 * dim
    this.K = Array.from({ length: layers }, () => new Float32Array(ctx * dim))
    this.V = Array.from({ length: layers }, () => new Float32Array(ctx * dim))
    this.x = new Float32Array(dim)
    this.h = new Float32Array(dim)
    this.q = new Float32Array(dim)
    this.k = new Float32Array(dim)
    this.v = new Float32Array(dim)
    this.att = new Float32Array(dim)
    this.proj = new Float32Array(dim)
    this.ff = new Float32Array(4 * dim)
    this.scores = new Float32Array(ctx)
    this.logits = new Float32Array(vocab)
  }

  reset() {
    this.pos = 0
  }

  /** Ajoute un jeton à la position courante ; remplit `logits` pour le jeton suivant. */
  step(token: number): Float32Array {
    const { w } = this.m
    const D = this.D
    const t = this.pos
    if (t >= this.ctx) throw new Error('contexte plein')
    const tok = w.tokEmb.subarray(token * D, token * D + D)
    const pe = w.posEmb.subarray(t * D, t * D + D)
    for (let i = 0; i < D; i++) this.x[i] = tok[i] + pe[i]

    const dh = this.dh
    const scale = 1 / Math.sqrt(dh)
    for (let l = 0; l < w.layers.length; l++) {
      const L = w.layers[l]
      layerNormInto(this.x, L.ln1g, L.ln1b, this.h)
      matVec(this.h, L.wq, D, D, this.q)
      matVec(this.h, L.wk, D, D, this.k)
      matVec(this.h, L.wv, D, D, this.v)
      const Kc = this.K[l]
      const Vc = this.V[l]
      Kc.set(this.k, t * D)
      Vc.set(this.v, t * D)
      // attention causale : la position t voit les positions 0..t
      for (let hh = 0; hh < this.H; hh++) {
        const ho = hh * dh
        let max = -Infinity
        for (let j = 0; j <= t; j++) {
          let s = 0
          const kb = j * D + ho
          for (let d = 0; d < dh; d++) s += this.q[ho + d] * Kc[kb + d]
          s *= scale
          this.scores[j] = s
          if (s > max) max = s
        }
        let sum = 0
        for (let j = 0; j <= t; j++) {
          const e = Math.exp(this.scores[j] - max)
          this.scores[j] = e
          sum += e
        }
        for (let d = 0; d < dh; d++) this.att[ho + d] = 0
        for (let j = 0; j <= t; j++) {
          const p = this.scores[j] / sum
          const vb = j * D + ho
          for (let d = 0; d < dh; d++) this.att[ho + d] += p * Vc[vb + d]
        }
      }
      matVec(this.att, L.wo, D, D, this.proj)
      for (let i = 0; i < D; i++) this.x[i] += this.proj[i]

      layerNormInto(this.x, L.ln2g, L.ln2b, this.h)
      matVec(this.h, L.w1, D, this.hid, this.ff)
      for (let i = 0; i < this.hid; i++) this.ff[i] += L.b1[i]
      geluInPlace(this.ff)
      matVec(this.ff, L.w2, this.hid, D, this.proj)
      for (let i = 0; i < D; i++) this.x[i] += this.proj[i] + L.b2[i]
    }
    layerNormInto(this.x, w.lnfg, w.lnfb, this.h)
    // tête liée à l'embedding : logits[v] = h · tokEmb[v]
    const V = this.logits.length
    for (let v = 0; v < V; v++) {
      let s = 0
      const eb = v * D
      for (let d = 0; d < D; d++) s += this.h[d] * w.tokEmb[eb + d]
      this.logits[v] = s
    }
    this.pos = t + 1
    return this.logits
  }

  /** Donne le prompt au modèle (les logits du dernier jeton sont renvoyés). */
  feed(ids: number[]): Float32Array {
    let last = this.logits
    for (const id of ids) last = this.step(id)
    return last
  }
}

export interface SampleOptions {
  maxNew: number
  /** 0 = glouton (argmax). Recommandé : 0.6 à 0.8. */
  temperature: number
  /** Ne garde que les K jetons les plus probables. */
  topK: number
  /** Nucleus sampling : plus petit ensemble dont la masse atteint `topP` (1 = désactivé). */
  topP?: number
  /** Pénalité de répétition sur les jetons récents (1 = désactivé ; 1.1 à 1.3 typique). */
  repeatPenalty?: number
  /** Nombre de jetons récents concernés par la pénalité. */
  repeatWindow?: number
  /** Chaînes d'arrêt : la génération s'arrête dès que la sortie se termine par l'une d'elles. */
  stops?: string[]
  /** Générateur aléatoire (tests reproductibles). */
  random?: () => number
  /** Reçoit le texte au fil de l'eau, sans jamais émettre une chaîne d'arrêt. */
  onText?: (chunk: string) => void
  signal?: AbortSignal
}

export interface TokenChoice {
  temperature: number
  topK: number
  topP?: number
  repeatPenalty?: number
  /** Jetons déjà générés (pour la pénalité de répétition). */
  recent?: number[]
}

/** Tire un jeton : pénalité de répétition, température, top-k puis top-p. */
export function sampleToken(logits: Float32Array, c: TokenChoice, rand: () => number): number {
  const n = logits.length
  const work = Float32Array.from(logits)
  const pen = c.repeatPenalty ?? 1
  if (pen !== 1 && c.recent) {
    const seen = new Set(c.recent)
    for (const id of seen) {
      if (id < 0 || id >= n) continue
      work[id] = work[id] > 0 ? work[id] / pen : work[id] * pen
    }
  }
  if (c.temperature <= 0) {
    let best = 0
    for (let i = 1; i < n; i++) if (work[i] > work[best]) best = i
    return best
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => work[b] - work[a])
  const keep = order.slice(0, Math.max(1, Math.min(c.topK, n)))
  const max = work[keep[0]] / c.temperature
  const probs = keep.map((i) => Math.exp(work[i] / c.temperature - max))
  const total = probs.reduce((a, b) => a + b, 0)
  let cut = keep.length
  const topP = c.topP ?? 1
  if (topP < 1) {
    let acc = 0
    for (let j = 0; j < keep.length; j++) {
      acc += probs[j] / total
      if (acc >= topP) {
        cut = j + 1
        break
      }
    }
  }
  let mass = 0
  for (let j = 0; j < cut; j++) mass += probs[j]
  let r = rand() * mass
  for (let j = 0; j < cut; j++) {
    r -= probs[j]
    if (r <= 0) return keep[j]
  }
  return keep[cut - 1]
}

/** Longueur du plus long suffixe de `text` qui est un préfixe strict d'une chaîne d'arrêt. */
export function holdbackLength(text: string, stops: string[] | undefined): number {
  if (!stops?.length) return 0
  let hold = 0
  for (const st of stops) {
    for (let k = Math.min(st.length - 1, text.length); k > hold; k--) {
      if (text.endsWith(st.slice(0, k))) {
        hold = k
        break
      }
    }
  }
  return hold
}

/**
 * Génère une suite à partir d'un prompt. Le contexte est recalculé en
 * partie (moitié récente) quand il atteint la limite `ctx`.
 */
export function generate(model: NexusCodeModel, prompt: string, opts: SampleOptions): string {
  const rand = opts.random ?? Math.random
  const session = model.session()
  const ctx = model.meta.config.ctx
  const cut = Math.floor(ctx / 2)
  const window = opts.repeatWindow ?? 64
  let ids = model.encode(prompt)
  if (ids.length > cut) ids = ids.slice(ids.length - cut)
  let logits = session.feed(ids)
  const generated: number[] = []
  let out = ''
  let emitted = 0
  let stopped = false
  for (let n = 0; n < opts.maxNew; n++) {
    if (opts.signal?.aborted) break
    const tok = sampleToken(
      logits,
      {
        temperature: opts.temperature,
        topK: opts.topK,
        topP: opts.topP,
        repeatPenalty: opts.repeatPenalty,
        recent: generated.slice(-window),
      },
      rand
    )
    generated.push(tok)
    out += model.decode([tok])
    const hit = opts.stops?.find((st) => out.endsWith(st))
    if (hit) {
      out = out.slice(0, out.length - hit.length)
      stopped = true
      break
    }
    const safe = out.length - holdbackLength(out, opts.stops)
    if (opts.onText && safe > emitted) opts.onText(out.slice(emitted, safe))
    emitted = Math.max(emitted, safe)
    if (session.pos >= ctx) {
      // fenêtre pleine : on repart de la moitié récente de ce qui a été dit
      const all = model.encode(prompt + out)
      session.reset()
      logits = session.feed(all.slice(all.length - cut))
    } else {
      logits = session.step(tok)
    }
  }
  if (!stopped && opts.onText && emitted < out.length) opts.onText(out.slice(emitted))
  return out
}
