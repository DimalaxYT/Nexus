// ─── NEXUS — Échantillonnage du LLM maison (cache clé/valeur) ────────────────
// La boucle de génération : température, top-k, pénalité de répétition,
// conditions d'arrêt (fin de ligne, ligne vide, token de fin, séquences),
// mesure de confiance (NLL moyenne) et diffusion incrémentale du texte.
//
// Elle s'appuie sur `./kv` (une passe par token au lieu d'une passe complète
// par caractère) : mesuré à ~40× plus rapide, ce qui rend la réponse
// conversatoire immédiate au lieu de plusieurs secondes.
//
// Le tokenizer est choisi d'après le modèle (`./tokenize`) : les modèles
// `char` existants et le modèle de conversation `bpe` passent par la même boucle.

import { createKv, prefill, refillWindow, resetKv, stepToken, type KvState } from './kv'
import { makeRng, type LmConfig, type LmParams, type Vocab } from './model'
import { createStreamDecoder, decodeFor, encodeFor, eosIdOf } from './tokenize'

/** Ce dont l'échantillonneur a besoin (le modèle chargé en mémoire). */
export interface SampleModel {
  cfg: LmConfig
  vocab: Vocab
  params: LmParams
}

export interface SampleOptions {
  maxTokens?: number
  temperature?: number
  topK?: number
  seed?: number
  /** Arrêt dès qu'une ligne vide apparaît. */
  stopAtBlank?: boolean
  /** Arrêt à la fin de la première ligne (format ancré : une réponse = une ligne). */
  stopAtLine?: boolean
  /** Séquences qui terminent la génération (ex. `\nQ:`, `\nC:`). */
  stopSequences?: string[]
  /** Multiplicateur appliqué aux tokens déjà produits (1 = aucune pénalité). */
  repeatPenalty?: number
  /** Fenêtre de tokens considérée pour la pénalité de répétition. */
  repeatWindow?: number
  /** Diffusion incrémentale du texte au fil de la génération. */
  onDelta?: (chunk: string) => void
}

export interface SampleResult {
  /** Texte généré, nettoyé (marqueurs d'arrêt retirés). */
  text: string
  tokens: number
  ids: number[]
  /** Log-vraisemblance négative moyenne par token (nats) : plus bas = plus sûr. */
  avgNll: number
  ms: number
  stop: 'eos' | 'blank' | 'line' | 'seq' | 'max'
  /** Nombre de tokens du prompt (coût du pré-remplissage). */
  promptTokens: number
}

// Un seul état de cache réutilisé : la génération est synchrone, deux appels ne
// peuvent donc pas s'entrecroiser, et on évite d'allouer ~300 ko à chaque réponse.
let pooledKv: KvState | null = null
let pooledFor: LmParams | null = null

function kvFor(model: SampleModel): KvState {
  if (!pooledKv || pooledFor !== model.params || pooledKv.cfg.ctx !== model.cfg.ctx || pooledKv.cfg.vocab !== model.cfg.vocab) {
    pooledKv = createKv(model.cfg, model.params)
    pooledFor = model.params
  }
  return pooledKv
}

/** Choisit un token : température → pénalité de répétition → top-k → tirage. */
function pickToken(
  logits: Float32Array,
  V: number,
  opts: { temperature: number; topK: number; penalty: number; recent: number[]; forbidden: number[] },
  rng: () => number
): { id: number; prob: number } {
  // Softmax exact (pour la confiance) + distribution d'échantillonnage.
  let max = -Infinity
  for (let j = 0; j < V; j++) if (logits[j] > max) max = logits[j]
  let sum = 0
  const probs = new Float64Array(V)
  for (let j = 0; j < V; j++) {
    const e = Math.exp(logits[j] - max)
    probs[j] = e
    sum += e
  }

  const adjusted = new Float64Array(V)
  const recent = new Set(opts.recent)
  const forbidden = new Set(opts.forbidden)
  for (let j = 0; j < V; j++) {
    if (forbidden.has(j)) {
      adjusted[j] = -Infinity
      continue
    }
    let l = logits[j] / opts.temperature
    if (recent.has(j)) l = l > 0 ? l / opts.penalty : l * opts.penalty
    adjusted[j] = l
  }

  // Top-k sans trier tout le vocabulaire : on garde les k meilleurs par sélection.
  const k = Math.max(1, Math.min(opts.topK, V))
  const chosen: number[] = []
  const used = new Uint8Array(V)
  for (let n = 0; n < k; n++) {
    let best = -1
    let bestVal = -Infinity
    for (let j = 0; j < V; j++) {
      if (used[j]) continue
      if (adjusted[j] > bestVal) {
        bestVal = adjusted[j]
        best = j
      }
    }
    if (best < 0 || !Number.isFinite(bestVal)) break
    used[best] = 1
    chosen.push(best)
  }
  if (chosen.length === 0) return { id: 1, prob: 1 / V }

  let amax = -Infinity
  for (const j of chosen) if (adjusted[j] > amax) amax = adjusted[j]
  let z = 0
  const weights = chosen.map((j) => {
    const w = Math.exp(adjusted[j] - amax)
    z += w
    return w
  })
  let r = rng() * z
  let id = chosen[chosen.length - 1]
  for (let i = 0; i < chosen.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      id = chosen[i]
      break
    }
  }
  return { id, prob: Math.max(probs[id] / sum, 1e-12) }
}

/** Première séquence d'arrêt rencontrée dans `text` (index + séquence). */
function earliestStop(text: string, sequences: string[]): { at: number; seq: string } | null {
  let found: { at: number; seq: string } | null = null
  for (const s of sequences) {
    const i = text.indexOf(s)
    if (i >= 0 && (!found || i < found.at)) found = { at: i, seq: s }
  }
  return found
}

/**
 * Génère la suite de `prompt`. Déterministe pour une même graine : deux
 * utilisateurs posant la même question obtiennent la même réponse.
 */
export function sample(model: SampleModel, prompt: string, opts: SampleOptions = {}): SampleResult {
  const { cfg, vocab, params } = model
  const t0 = Date.now()
  const maxTokens = Math.max(1, Math.min(512, opts.maxTokens ?? 160))
  const temperature = Math.max(0.05, opts.temperature ?? 0.8)
  const topK = Math.max(1, opts.topK ?? 10)
  const penalty = Math.max(1, opts.repeatPenalty ?? 1.15)
  const repeatWindow = Math.max(1, opts.repeatWindow ?? 24)
  const rng = makeRng(opts.seed ?? 42)
  const V = cfg.vocab
  const eos = eosIdOf(cfg)

  const promptIds = encodeFor(cfg, vocab, prompt)
  const windowIds = promptIds.length > cfg.ctx ? promptIds.subarray(promptIds.length - cfg.ctx) : promptIds
  const ids: number[] = Array.from(windowIds.length ? windowIds : [1])

  // Marqueurs du format appris : une réponse ne déborde jamais sur le bloc suivant.
  const stopSequences = [...(opts.stopSequences ?? []), '\nQ:', '\nC:', '\nH:']
  // Fin de ligne : opt-in (le format de conversation répond sur une seule ligne).
  if (opts.stopAtLine) stopSequences.push('\n')
  // Ligne vide : comportement historique du moteur (arrêt par défaut).
  if (opts.stopAtBlank !== false) stopSequences.push('\n\n')

  const decoder = createStreamDecoder(cfg, vocab)
  const kv = kvFor(model)
  resetKv(kv)

  const out: number[] = []
  let text = ''
  let emitted = 0
  let nll = 0
  let stop: SampleResult['stop'] = 'max'

  // Pré-remplissage : tous les tokens du prompt sauf le dernier, puis un pas
  // pour obtenir la distribution du token suivant.
  if (ids.length > 1) prefill(kv, ids.slice(0, -1))
  let logits = stepToken(kv, ids[ids.length - 1])

  for (let i = 0; i < maxTokens; i++) {
    const recent = out.slice(-repeatWindow)
    const picked = pickToken(logits, V, { temperature, topK, penalty, recent, forbidden: [0] }, rng)
    nll += -Math.log(picked.prob)
    out.push(picked.id)
    ids.push(picked.id)

    if (eos !== null && picked.id === eos) {
      stop = 'eos'
      break
    }

    text += decoder.push([picked.id])
    const hit = earliestStop(text, stopSequences)
    if (hit) {
      stop = hit.seq === '\n\n' ? 'blank' : hit.seq === '\n' ? 'line' : 'seq'
      if (opts.onDelta && hit.at > emitted) opts.onDelta(text.slice(emitted, hit.at))
      text = text.slice(0, hit.at)
      break
    }
    if (opts.onDelta && text.length > emitted) {
      opts.onDelta(text.slice(emitted))
      emitted = text.length
    }

    if (i === maxTokens - 1) break
    if (kv.pos >= cfg.ctx) refillWindow(kv)
    logits = stepToken(kv, picked.id)
  }

  text += decoder.flush()
  return {
    text: text.replace(/\s+$/, ''),
    tokens: out.length,
    ids: out,
    avgNll: out.length ? nll / out.length : Infinity,
    ms: Date.now() - t0,
    stop,
    promptTokens: ids.length - out.length,
  }
}

/**
 * NLL moyenne d'un texte sachant un prompt (mesure de confiance « à froid ») :
 * sert à étalonner les seuils de qualité et à comparer deux modèles.
 */
export function averageNll(model: SampleModel, prompt: string, text: string): number {
  const { cfg, vocab, params } = model
  const V = cfg.vocab
  const promptIds = Array.from(encodeFor(cfg, vocab, prompt))
  const textIds = Array.from(encodeFor(cfg, vocab, text))
  if (!textIds.length) return Infinity
  const kv = kvFor(model)
  resetKv(kv)
  const all = promptIds.concat(textIds)
  const start = Math.max(0, all.length - cfg.ctx)
  let nll = 0
  let counted = 0
  let logits = stepToken(kv, all[start])
  for (let i = start + 1; i < all.length; i++) {
    if (i > promptIds.length - 1) {
      let max = -Infinity
      for (let j = 0; j < V; j++) if (logits[j] > max) max = logits[j]
      let sum = 0
      for (let j = 0; j < V; j++) sum += Math.exp(logits[j] - max)
      const p = Math.exp(logits[all[i]] - max) / sum
      nll += -Math.log(Math.max(p, 1e-12))
      counted++
    }
    if (kv.pos >= cfg.ctx) {
      // Fenêtre pleine : on s'arrête (mesure sur les ctx derniers tokens).
      break
    }
    logits = stepToken(kv, all[i])
  }
  void params
  return counted ? nll / counted : Infinity
}

/** Décode des ids avec le tokenizer du modèle (pratique pour les journaux). */
export function decodeWith(model: SampleModel, ids: number[]): string {
  return decodeFor(model.cfg, model.vocab, ids)
}
