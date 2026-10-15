// ─── NEXUS — Moteur d'inférence du LLM maison ────────────────────────────────
// Charge le modèle actif depuis la base (Turso ou locale), le garde en mémoire
// tant qu'il n'a pas changé, et génère du texte échantillonné (température,
// top-k, pénalité de répétition). Tout est local : aucune API, aucun Ollama.
//
// Garde-fou de qualité : une réponse n'est proposée au chat que si elle est
// assez « probable » selon le modèle lui-même (perplexité) et non répétitive.
// Sinon, NEXUS retombe sur son cerveau à règles — le modèle ne « bluffe » pas.

import { db } from '@/lib/db'
import { decodeIds, deserializeWeights, encodeText, forward, lexiconCoverage, makeRng, type LmConfig, type LmParams, type Vocab } from './model'
import { noGrad } from './tensor'
import {
  GROUNDED_FORMAT,
  MIN_GROUNDING,
  MIN_PASSAGE_SCORE,
  bestPassage,
  gatherPassages,
  groundedPrompt,
  groundingOf,
} from './grounding'

export interface LoadedModel {
  id: string
  cfg: LmConfig
  vocab: Vocab
  params: LmParams
  steps: number
  loss: number
  corpusChars: number
  corpusInfo: Record<string, number>
  createdAt: number
  updatedAt: number
}

let cache: LoadedModel | null = null
let cacheKey = ''
let lexicon = new Set<string>()

/** Oublie le modèle en mémoire (appelé après chaque entraînement). */
export function invalidateModelCache(): void {
  cache = null
  cacheKey = ''
}

/** Modèle actif, rechargé seulement si la ligne a changé en base. */
export async function loadActiveModel(): Promise<LoadedModel | null> {
  const meta = await db.llmModel.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' }, select: { id: true, updatedAt: true } }).catch(() => null)
  if (!meta) {
    invalidateModelCache()
    return null
  }
  const key = `${String(meta.id)}:${new Date(meta.updatedAt as Date).getTime()}`
  if (cache && cacheKey === key) return cache

  const row = await db.llmModel.findUnique({ where: { id: String(meta.id) } }).catch(() => null)
  if (!row || !row.weights) return null
  const cfg = JSON.parse(String(row.config)) as LmConfig
  const vocab: Vocab = { itos: JSON.parse(String(row.vocab)) as string[] }
  const params = deserializeWeights(cfg, String(row.weights))
  lexicon = new Set(cfg.lexicon ?? [])
  cache = {
    id: String(row.id),
    cfg,
    vocab,
    params,
    steps: Number(row.steps ?? 0),
    loss: Number(row.loss ?? 0),
    corpusChars: Number(row.corpusChars ?? 0),
    corpusInfo: safeJson(String(row.corpusInfo ?? '{}')),
    createdAt: new Date(row.createdAt as Date).getTime(),
    updatedAt: new Date(row.updatedAt as Date).getTime(),
  }
  cacheKey = key
  return cache
}

function safeJson(raw: string): Record<string, number> {
  try {
    return JSON.parse(raw) as Record<string, number>
  } catch {
    return {}
  }
}

export interface GenOptions {
  maxTokens?: number
  temperature?: number
  topK?: number
  seed?: number
  /** Arrêt dès qu'une ligne vide apparaît (une réponse = un bloc). */
  stopAtBlank?: boolean
  /** Arrêt à la fin de la ligne (format ancré : une réponse = une ligne). */
  stopAtLine?: boolean
}

export interface GenResult {
  text: string
  tokens: number
  /** Log-vraisemblance négative moyenne (en nats) selon le modèle : plus bas = plus sûr. */
  avgNll: number
  ms: number
  stop: 'blank' | 'max' | 'eos'
}

/** Génère une suite de texte à partir de `prompt`. */
export function generateWith(model: LoadedModel, prompt: string, opts: GenOptions = {}): GenResult {
  const { cfg, vocab, params } = model
  const maxTokens = Math.max(1, Math.min(400, opts.maxTokens ?? 160))
  const temperature = Math.max(0.05, opts.temperature ?? 0.8)
  const topK = Math.max(1, opts.topK ?? 10)
  const rng = makeRng(opts.seed ?? 42)
  const V = cfg.vocab
  const ids: number[] = Array.from(encodeText(vocab, prompt))
  if (ids.length === 0) ids.push(1)
  const out: number[] = []
  let nll = 0
  let stop: GenResult['stop'] = 'max'
  const t0 = Date.now()

  noGrad(() => {
    for (let i = 0; i < maxTokens; i++) {
      const window = ids.slice(-cfg.ctx)
      const T = window.length
      const logits = forward(cfg, params, Int32Array.from(window), 1, T).data
      const off = (T - 1) * V

      // Probabilités brutes (pour la confiance) et distribution d'échantillonnage.
      let max = -Infinity
      for (let j = 0; j < V; j++) if (logits[off + j] > max) max = logits[off + j]
      let sum = 0
      const probs = new Float64Array(V)
      for (let j = 0; j < V; j++) {
        probs[j] = Math.exp(logits[off + j] - max)
        sum += probs[j]
      }

      // Pénalité de répétition sur les 24 derniers tokens, puis température + top-k.
      const adjusted = new Float64Array(V)
      const recent = new Set(out.slice(-24))
      for (let j = 0; j < V; j++) {
        let l = logits[off + j] / temperature
        if (recent.has(j)) l = l > 0 ? l / 1.15 : l * 1.15
        adjusted[j] = j === 0 ? -Infinity : l // jamais le caractère inconnu
      }
      const candidates = Array.from({ length: V }, (_, j) => j)
        .filter((j) => Number.isFinite(adjusted[j]))
        .sort((a, b) => adjusted[b] - adjusted[a])
        .slice(0, topK)
      let amax = -Infinity
      for (const j of candidates) if (adjusted[j] > amax) amax = adjusted[j]
      let z = 0
      const weights = candidates.map((j) => {
        const w = Math.exp(adjusted[j] - amax)
        z += w
        return w
      })
      let r = rng() * z
      let chosen = candidates[candidates.length - 1]
      for (let k = 0; k < candidates.length; k++) {
        r -= weights[k]
        if (r <= 0) {
          chosen = candidates[k]
          break
        }
      }

      nll += -Math.log(Math.max(probs[chosen] / sum, 1e-12))
      out.push(chosen)
      ids.push(chosen)

      const soFar = decodeIds(vocab, out)
      if (opts.stopAtBlank !== false && soFar.includes('\n\n')) {
        stop = 'blank'
        break
      }
      if (opts.stopAtLine && soFar.includes('\n')) {
        stop = 'blank'
        break
      }
      if (/\nQ:/.test(soFar)) {
        stop = 'blank'
        break
      }
    }
  })

  const text = decodeIds(vocab, out)
    .split(opts.stopAtLine ? /\n/ : /\n\s*\n|\nQ:/)[0]
    .replace(/^\s+/, '')
    .trimEnd()
  return {
    text,
    tokens: out.length,
    avgNll: out.length ? nll / out.length : Infinity,
    ms: Date.now() - t0,
    stop,
  }
}

export type LocalAnswer =
  | { ok: true; text: string; avgNll: number; ms: number; confidence: number; grounded?: boolean; source?: string }
  | { ok: false; reason: string; avgNll?: number; text?: string }

/**
 * Seuils calibrés sur un modèle entraîné (800 pas, corpus de NEXUS) — mesures :
 *  - NLL moyenne (nats/caractère) : texte réel du corpus 2,21–2,65 ; bruit aléatoire 5,8–6,7.
 *    Seuil 3,5 : tout ce qui ressemble à la langue apprise passe, le bruit est refusé.
 *  - Couverture lexicale : texte réel 0,31–0,88 (moyenne 0,60) ; réponses générées en charabia 0,12–0,17.
 *    Seuil 0,25 : sépare le charabia (le filtre principal, car la NLL d'un texte généré reste basse).
 * Un modèle plus gros et un corpus plus riche permettront de remonter ces seuils.
 */
/** Seuil de confiance (perplexité moyenne en nats) au-delà duquel le modèle se tait. */
export const MAX_AVG_NLL = 3.5
/** Part minimale de mots appris dans la réponse (0,25 = un mot sur quatre connu). */
export const MIN_LEXICON_COVERAGE = 0.25

/**
 * Réponse du LLM maison à une question, avec garde-fou.
 * Déterministe pour une même question (graine dérivée du texte).
 */
export async function answerWithLocalModel(question: string, userId?: string | null): Promise<LocalAnswer> {
  const model = await loadActiveModel()
  if (!model) return { ok: false, reason: 'aucun modèle entraîné' }
  const q = question.trim().slice(0, 600)
  if (!q) return { ok: false, reason: 'question vide' }
  if (model.cfg.format === GROUNDED_FORMAT) return answerGrounded(model, q, userId ?? null)
  const seed = hash(q)
  const res = generateWith(model, `Q: ${q}\nR: `, { maxTokens: 180, temperature: 0.6, topK: 6, seed })
  if (res.text.length < 16) return { ok: false, reason: 'réponse trop courte', avgNll: res.avgNll, text: res.text }
  if (res.avgNll > MAX_AVG_NLL) return { ok: false, reason: 'confiance insuffisante', avgNll: res.avgNll, text: res.text }
  const words = res.text.toLowerCase().split(/\s+/).filter(Boolean)
  const uniq = new Set(words).size / Math.max(1, words.length)
  if (words.length > 12 && uniq < 0.45) return { ok: false, reason: 'réponse répétitive', avgNll: res.avgNll, text: res.text }
  // Anti-charabia : la réponse doit être faite de mots que le modèle a réellement appris.
  const coverage = lexiconCoverage(res.text, lexicon)
  if (coverage < MIN_LEXICON_COVERAGE) return { ok: false, reason: 'mots inconnus', avgNll: res.avgNll, text: res.text }
  return {
    ok: true,
    text: res.text,
    avgNll: res.avgNll,
    ms: res.ms,
    confidence: Math.max(0, Math.min(1, Math.exp(-res.avgNll))),
  }
}

/**
 * Réponse ancrée : on donne au modèle le passage le plus pertinent du savoir de
 * NEXUS, il rédige à partir de lui, et la réponse est refusée si elle ne reprend
 * pas ce passage (anti-hallucination) ou si le modèle n'est pas sûr de lui.
 */
async function answerGrounded(model: LoadedModel, q: string, userId: string | null): Promise<LocalAnswer> {
  const passages = await gatherPassages(userId)
  const best = bestPassage(q, passages)
  if (!best || best.score < MIN_PASSAGE_SCORE) {
    return { ok: false, reason: 'aucun passage pertinent dans le savoir de NEXUS' }
  }
  const passage = best.passage.text
  const res = generateWith(model, groundedPrompt(q, passage), {
    maxTokens: 120,
    temperature: 0.15,
    topK: 2,
    seed: hash(q),
    stopAtLine: true,
  })
  const text = res.text.trim()
  if (text.length < 8) return { ok: false, reason: 'réponse trop courte', avgNll: res.avgNll, text }
  if (res.avgNll > MAX_AVG_NLL) return { ok: false, reason: 'confiance insuffisante', avgNll: res.avgNll, text }
  const grounding = groundingOf(text, passage)
  if (grounding < MIN_GROUNDING) {
    return { ok: false, reason: `réponse non ancrée (${Math.round(grounding * 100)} % du passage)`, avgNll: res.avgNll, text }
  }
  return {
    ok: true,
    text,
    avgNll: res.avgNll,
    ms: res.ms,
    confidence: Math.max(0, Math.min(1, Math.exp(-res.avgNll))),
    grounded: true,
    source: best.passage.source,
  }
}

/** Préchauffe le modèle (charge les poids, un petit passage) — utilisé par le Gardien. */
export async function warmUpLocalModel(): Promise<{ trained: boolean; ms: number }> {
  const t0 = Date.now()
  const model = await loadActiveModel()
  if (!model) return { trained: false, ms: Date.now() - t0 }
  generateWith(model, 'Q: Bonjour\nR: ', { maxTokens: 4, temperature: 0.8, seed: 1 })
  return { trained: true, ms: Date.now() - t0 }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
