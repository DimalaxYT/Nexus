// ─── NEXUS — Moteur d'inférence du LLM maison ────────────────────────────────
// Charge le modèle actif depuis la base (Turso ou locale), le garde en mémoire
// tant qu'il n'a pas changé, et génère du texte échantillonné (température,
// top-k, pénalité de répétition). Tout est local : aucune API, aucun Ollama.
//
// Garde-fou de qualité : une réponse n'est proposée au chat que si elle est
// assez « probable » selon le modèle lui-même (perplexité) et non répétitive.
// Sinon, NEXUS retombe sur son cerveau à règles — le modèle ne « bluffe » pas.

import { db } from '@/lib/db'
import { CHAT_FORMAT, deserializeWeights, lexiconCoverage, type LmConfig, type LmParams, type Vocab } from './model'
import { isBpe } from './tokenize'
import { sample } from './generate'
import { loadSeedModel } from './seed'
import { answerChat } from './dialogue'
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
  /** Mots appris par le modèle : garde-fou anti-charabia. */
  lexicon: Set<string>
  /** Vrai si ce sont les poids livrés dans le dépôt (non entraînés ici). */
  seeded: boolean
}

let cache: LoadedModel | null = null
let cacheKey = ''

/** Oublie le modèle en mémoire (appelé après chaque entraînement). */
export function invalidateModelCache(): void {
  cache = null
  cacheKey = ''
}

/** Modèle actif, rechargé seulement si la ligne a changé en base. */
export async function loadActiveModel(): Promise<LoadedModel | null> {
  const meta = await db.llmModel.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' }, select: { id: true, updatedAt: true } }).catch(() => null)
  if (!meta) {
    // Aucun modèle entraîné sur cette instance : on utilise le point de contrôle
    // livré dans le dépôt (entraîné hors ligne), pour que le chat fonctionne dès
    // le premier démarrage — y compris sans base accessible.
    const seed = loadSeedModel()
    if (seed) {
      cache = seed
      cacheKey = `seed:${seed.updatedAt}`
      return cache
    }
    invalidateModelCache()
    return null
  }
  const key = `${String(meta.id)}:${new Date(meta.updatedAt as Date).getTime()}`
  if (cache && cacheKey === key) return cache

  const row = await db.llmModel.findUnique({ where: { id: String(meta.id) } }).catch(() => null)
  if (!row || !row.weights) return null
  const cfg = JSON.parse(String(row.config)) as LmConfig
  const vocab: Vocab = isBpe(cfg) ? { itos: [] } : { itos: JSON.parse(String(row.vocab ?? '[]')) as string[] }
  const params = deserializeWeights(cfg, String(row.weights))
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
    lexicon: new Set(cfg.lexicon ?? []),
    seeded: false,
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
  stop: 'blank' | 'max' | 'eos' | 'line' | 'seq'
}

/**
 * Génère la suite de `prompt`.
 * Délégué à l'échantillonneur sur cache clé/valeur (`./generate`) : même
 * comportement qu'avant (température, top-k, pénalité de répétition, arrêts),
 * mais une seule passe par token au lieu d'une passe complète par caractère —
 * mesuré à ~40× plus rapide, ce qui rend la conversation fluide.
 */
export function generateWith(model: LoadedModel, prompt: string, opts: GenOptions = {}): GenResult {
  const res = sample(model, prompt, {
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
    topK: opts.topK,
    seed: opts.seed,
    stopAtLine: opts.stopAtLine,
    stopAtBlank: opts.stopAtBlank,
  })
  return {
    text: res.text,
    tokens: res.tokens,
    avgNll: res.avgNll,
    ms: res.ms,
    stop: res.stop === 'line' || res.stop === 'seq' ? 'blank' : res.stop,
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
  if (model.cfg.format === CHAT_FORMAT) {
    // Modèle de conversation : la couche dialogue fait le retrieval, la
    // rédaction et les garde-fous (avec repli sur le texte retrouvé).
    const answer = await answerChat({ message: q, userId: userId ?? null, model })
    if (!answer.ok) return { ok: false, reason: answer.reason, avgNll: answer.avgNll, text: answer.text }
    return {
      ok: true,
      text: answer.text,
      avgNll: answer.avgNll,
      ms: answer.ms,
      confidence: answer.confidence,
      grounded: answer.grounded,
      source: answer.source ?? undefined,
    }
  }
  const seed = hash(q)
  const res = generateWith(model, `Q: ${q}\nR: `, { maxTokens: 180, temperature: 0.6, topK: 6, seed })
  if (res.text.length < 16) return { ok: false, reason: 'réponse trop courte', avgNll: res.avgNll, text: res.text }
  if (res.avgNll > MAX_AVG_NLL) return { ok: false, reason: 'confiance insuffisante', avgNll: res.avgNll, text: res.text }
  const words = res.text.toLowerCase().split(/\s+/).filter(Boolean)
  const uniq = new Set(words).size / Math.max(1, words.length)
  if (words.length > 12 && uniq < 0.45) return { ok: false, reason: 'réponse répétitive', avgNll: res.avgNll, text: res.text }
  // Anti-charabia : la réponse doit être faite de mots que le modèle a réellement appris.
  const coverage = lexiconCoverage(res.text, model.lexicon)
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
  generateWith(model, isBpe(model.cfg) ? 'Q: bonjour\nR: ' : 'Q: Bonjour\nR: ', { maxTokens: 4, temperature: 0.8, seed: 1 })
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
