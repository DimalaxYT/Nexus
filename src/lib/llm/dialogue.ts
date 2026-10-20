// ─── NEXUS — Couche conversation : retrieval + rédaction par le modèle maison ─
// Comment un petit modèle de langue (≈ 300 k paramètres, entraîné ici) peut
// tenir une vraie conversation en français sans rien inventer :
//
//   1. RETRIEVAL — on retrouve dans le savoir local (banque de dialogue écrite à
//      la main, banque de connaissances, notes de l'utilisateur) l'entrée la plus
//      proche du message. C'est elle qui apporte le FOND.
//   2. RÉDACTION — le transformeur reçoit ce fond dans son contexte (`C:`), le
//      message (`Q:`) et l'échange précédent (`H:`), puis génère la réponse
//      token par token (`R:`). C'est lui qui apporte la FORME.
//   3. GARDE-FOUS — confiance du modèle (NLL), couverture lexicale, répétition,
//      ancrage dans le passage fourni. Si la réponse générée est faible, on
//      revient au texte retrouvé : l'utilisateur obtient toujours du français
//      cohérent et jamais d'invention.
//
// Tout est local : aucun appel réseau, aucune API, aucun service tiers.

import { DIALOGUE_BANK, DIALOGUE_OPENERS, type DialogueEntry } from '@/lib/brain/dialogue-bank'
import { contentTokens, stem, tokenize } from '@/lib/brain/text'
import { lexiconCoverage } from './model'
import { bestPassage, gatherPassages, groundingOf, scorePassage, type Passage } from './grounding'
import { sample } from './generate'
// Import de TYPE uniquement : `engine` appelle `answerChat`, donc un import
// runtime créerait un cycle. Le modèle chargé est fourni par l'appelant.
import type { LoadedModel } from './engine'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Longueurs maximales des lignes du format `chat-v1`. Additionnées, elles
 * doivent tenir dans `CHAT_CTX` (352 caractères) :
 *   H: 3+34 · Q: 3+60 · C: 3+90 · R: 3+130 · 3 sauts de ligne = 329.
 * Un exemple plus long que le contexte serait coupé en deux fenêtres et le
 * modèle n'apprendrait plus la tâche « lire C: et Q:, écrire R: ».
 */
export const HISTORY_MAX = 34
export const CONTEXT_MAX = 90
export const MESSAGE_MAX = 60

/** Score de retrieval en dessous duquel on rédige sans contexte fourni. */
export const MIN_CONTEXT_SCORE = 0.2
/** Score en dessous duquel aucun repli textuel n'est proposé. */
export const MIN_FALLBACK_SCORE = 0.12

/**
 * Seuils étalonnés sur des mesures réelles, pas devinés :
 *  · couverture lexicale des 186 réponses de la banque : min 0,69 · médiane 1,00
 *    → seuil 0,55 (large, mais le charabia de mots-outils monte aussi à 1,00 :
 *      ce filtre seul ne suffit pas, d'où les mots de contenu ci-dessous),
 *  · ancrage d'une réponse réelle sur son contexte tronqué à 110 caractères :
 *    min 0,44 · médiane 0,91 → seuil 0,42 (ne rejette presque rien de légitime,
 *    rejette tout ce qui n'a rien à voir avec le contenu fourni),
 *  · longueur des réponses réelles : min 18 caractères / 4 mots → seuils 16/4,
 *  · charabia observé en début d'entraînement (« De l'est-moi et Je je d'ai. ») :
 *    0 à 2 mots de contenu, NLL pourtant basse (1,6-1,9) → la NLL NE SUFFIT PAS,
 *      le nombre de mots de contenu est le filtre décisif (seuil 3).
 */
/** Seuil de confiance du modèle de conversation (nats par caractère). */
export const MAX_CHAT_NLL = 3.5
/** Part minimale de mots appris dans une réponse générée. */
export const MIN_CHAT_LEXICON = 0.55
/** Part minimale des radicaux de la réponse présents dans le contexte fourni. */
export const MIN_CHAT_GROUNDING = 0.42
/** Mots de contenu (hors mots vides) exigés dans une réponse générée. */
export const MIN_CONTENT_WORDS = 3
/** Longueur minimale d'une réponse générée. */
export const MIN_ANSWER_CHARS = 16
/** Nombre minimal de mots d'une réponse générée. */
export const MIN_ANSWER_WORDS = 4

// ── Retrieval ────────────────────────────────────────────────────────────────
// NB : on n'utilise PAS `stems()` de brain/text ici — il retire les mots vides
// (« qui », « tu », « es », « faire »…), or ce sont précisément les mots-clés des
// questions conversationnelles. On garde tous les mots normalisés.

function words(text: string): string[] {
  return tokenize(text).map((w) => stem(w))
}

function wordSet(text: string): Set<string> {
  return new Set(words(text))
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** Mots-clés d'une entrée, stemmés une fois pour toutes. */
const ENTRY_KEYS: Set<string>[] = DIALOGUE_BANK.map((e) => new Set(e.k.map((k) => stem(k))))

/**
 * Marqueurs de relance : l'utilisateur ne pose pas une nouvelle question, il
 * rebondit sur ce que NEXUS vient de dire (« et pourquoi ? », « explique »,
 * « continue », « vraiment ? »). Aucun mot-clé thématique ne peut les matcher —
 * c'est le tour précédent qui donne le sens.
 */
const FOLLOWUP_RE = /^(?:et |bon |ben |bah |ok |d'accord |dac |oui |non |si |ah )*(?:pourquoi|comment [çc]a|explique|pr[ée]cise|d[ée]veloppe|d[ée]taille|dis m'en plus|dis-moi en plus|continue|encore|et alors|vraiment|ah bon|c'est[- ]à[- ]dire|tu crois|t'es s[ûu]r|tu es s[ûu]r|je ne comprends pas|je comprends pas|pas compris)\b/i

export interface DialogueMatch {
  entry: DialogueEntry
  score: number
  index: number
  /** Vrai si le message est une relance du tour précédent. */
  followUp?: boolean
}

/** Meilleure entrée de la banque de dialogue pour un message (0 → 1). */
export function matchDialogue(message: string, history: ChatTurn[] = []): DialogueMatch | null {
  const msg = String(message ?? '').toLowerCase()
  const mw = wordSet(msg)
  if (mw.size === 0) return null

  let best: DialogueMatch | null = null
  for (let i = 0; i < DIALOGUE_BANK.length; i++) {
    const entry = DIALOGUE_BANK[i]
    const keys = ENTRY_KEYS[i]
    let hits = 0
    for (const k of keys) if (mw.has(k)) hits++
    // Proximité avec la question canonique (même sans mot-clé exact).
    const sim = overlap(mw, wordSet(entry.q))
    if (hits === 0 && sim <= 0) continue
    // Les listes de mots-clés longues ne doivent pas être pénalisées : la
    // couverture sature dès 2 mots-clés touchés.
    const coverage = hits / Math.min(2, Math.max(1, keys.size))
    const score = Math.min(1, coverage * 0.72 + sim * 1.35)
    if (!best || score > best.score) best = { entry, score, index: i }
  }

  // Relances (« et pourquoi ? », « explique », « d'accord ») : elles n'ont de
  // sens que par rapport au tour précédent, donc uniquement s'il existe, et
  // uniquement si aucun sujet net ne se détache. On répond alors par une entrée
  // de suivi, en privilégiant celle qui partage des mots avec la relance.
  const hasPreviousAnswer = history.some((h) => h.role === 'assistant' && h.content.trim())
  const isFollowUp = hasPreviousAnswer && mw.size <= 6 && (FOLLOWUP_RE.test(msg.trim()) || (best?.score ?? 0) < 0.45)
  if (isFollowUp) {
    const followUps = DIALOGUE_BANK.map((entry, index) => ({ entry, index })).filter((x) => x.entry.t === 'suivi')
    if (followUps.length > 0) {
      let pick = followUps[0]
      let pickHits = -1
      for (const candidate of followUps) {
        let hits = 0
        for (const k of candidate.entry.k) if (mw.has(stem(k))) hits++
        if (hits > pickHits) {
          pickHits = hits
          pick = candidate
        }
      }
      if (pickHits <= 0) {
        const turn = history.filter((h) => h.role === 'user').length
        pick = followUps[(hashText(msg) + turn) % followUps.length]
      }
      // Score volontairement modéré : un vrai passage de savoir reste prioritaire.
      return { entry: pick.entry, score: Math.max(0.34, (best?.score ?? 0) * 0.6), index: pick.index, followUp: true }
    }
  }
  return best
}

export interface ChatContext {
  /** Contenu fourni au modèle (ligne `C:`), ou null si rien de pertinent. */
  passage: string | null
  source: string | null
  score: number
  entry: DialogueEntry | null
  /** Réponse de repli (texte retrouvé) si la génération est refusée. */
  fallback: string | null
}

/**
 * Retrouve le fond de la réponse : banque de dialogue d'abord (conversation),
 * savoir de NEXUS et notes de l'utilisateur ensuite (questions factuelles).
 * Les deux scores sont sur la même échelle (part de mots partagés), donc le
 * meilleur gagne naturellement : « qui es-tu ? » tombe sur le dialogue,
 * « qu'est-ce que Turso ? » tombe sur la banque de connaissances.
 */
export async function retrieveChatContext(
  message: string,
  userId?: string | null,
  history: ChatTurn[] = []
): Promise<ChatContext> {
  const match = matchDialogue(message, history)
  const dialogueScore = match?.score ?? 0

  let passageScore = 0
  let passage: Passage | null = null
  const qStems = wordSet(message)
  if (qStems.size > 0) {
    const passages = await gatherPassages(userId ?? null).catch(() => [] as Passage[])
    const best = bestPassage(message, passages ?? [])
    if (best) {
      // `scorePassage` ignore les mots vides : pour une question purement
      // conversationnelle il renvoie 0, ce qui laisse la main au dialogue.
      passageScore = scorePassage(message, best.passage.text)
      passage = best.passage
    }
  }

  if (passage && passageScore > dialogueScore && passageScore >= MIN_CONTEXT_SCORE) {
    return {
      passage: clip(passage.text, CONTEXT_MAX),
      source: passage.source,
      score: passageScore,
      entry: match?.entry ?? null,
      fallback: clip(passage.text, 240),
    }
  }

  if (match && dialogueScore >= MIN_CONTEXT_SCORE) {
    return {
      passage: clip(match.entry.a, CONTEXT_MAX),
      source: `banque de dialogue · ${match.entry.t}`,
      score: dialogueScore,
      entry: match.entry,
      fallback: varyFallback(match, history),
    }
  }

  // Rien de pertinent : le modèle rédige seul (garde-fous renforcés), et le
  // repli reste possible si un match faible existe ou via une relance.
  const weak = match && dialogueScore >= MIN_FALLBACK_SCORE ? varyFallback(match, history) : null
  return {
    passage: null,
    source: null,
    score: Math.max(dialogueScore, passageScore),
    entry: match?.entry ?? null,
    fallback: weak ?? (DIALOGUE_OPENERS.length ? DIALOGUE_OPENERS[hashText(message) % DIALOGUE_OPENERS.length] : null),
  }
}

/** Évite de renvoyer deux fois la même phrase : variante du même sujet. */
function varyFallback(match: DialogueMatch, history: ChatTurn[]): string {
  const lastAssistant = [...history].reverse().find((h) => h.role === 'assistant')?.content ?? ''
  const answer = match.entry.a
  if (!lastAssistant.includes(answer.slice(0, 40))) return answer
  const sameTopic = DIALOGUE_BANK.filter((e) => e.t === match.entry.t && e.a !== answer)
  if (sameTopic.length > 0) {
    const turn = history.filter((h) => h.role === 'user').length
    return sameTopic[(match.index + turn + 1) % sameTopic.length].a
  }
  return answer
}

function clip(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.lastIndexOf(' ', max)
  return t.slice(0, cut > max * 0.5 ? cut : max).replace(/[,;:.\s]+$/, '')
}

function hashText(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// ── Invite (format `chat-v1`) ────────────────────────────────────────────────

/** Ligne `H:` : le dernier échange, pour que les relances aient du sens. */
export function historyLine(history: ChatTurn[] = []): string | null {
  const lastUser = [...history].reverse().find((h) => h.role === 'user')
  const lastAssistant = [...history].reverse().find((h) => h.role === 'assistant')
  if (!lastAssistant) return null
  const u = clip(lastUser?.content ?? '', 34)
  const a = clip(lastAssistant.content, HISTORY_MAX - (u ? u.length + 3 : 0))
  if (!a) return null
  return u ? `${u} > ${a}` : a
}

/** Construit l'invite exacte apprise à l'entraînement (`H:` / `C:` / `Q:` / `R:`). */
export function chatPrompt(opts: { history?: ChatTurn[]; context?: string | null; message: string }): string {
  // Ordre IDENTIQUE à celui du corpus d'entraînement (chat-corpus.ts) : H, Q, C, R.
  const lines: string[] = []
  const h = historyLine(opts.history ?? [])
  if (h) lines.push(`H: ${h}`)
  lines.push(`Q: ${clip(opts.message, MESSAGE_MAX)}`)
  const c = opts.context ? clip(opts.context, CONTEXT_MAX) : ''
  if (c) lines.push(`C: ${c}`)
  lines.push('R: ')
  return lines.join('\n')
}

// ── Réponse ──────────────────────────────────────────────────────────────────

export type ChatAnswer =
  | {
      ok: true
      text: string
      /** true = rédigé par le transformeur, false = texte retrouvé (repli). */
      generated: boolean
      avgNll: number
      ms: number
      tokens: number
      confidence: number
      source: string | null
      grounded: boolean
    }
  | { ok: false; reason: string; text?: string; avgNll?: number; generated: false }

export interface ChatOptions {
  message: string
  userId?: string | null
  history?: ChatTurn[]
  seed?: number
  temperature?: number
  maxTokens?: number
  /** Diffusion progressive du texte retenu (après validation). */
  onDelta?: (chunk: string) => void
  /** Modèle chargé (null = aucun modèle entraîné : repli sur le savoir retrouvé). */
  model: LoadedModel | null
}

/** Nettoie la sortie brute du modèle (marqueurs du format, espaces, casse). */
export function cleanAnswer(raw: string): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  t = t.replace(/^(?:R|Q|C|H)\s*:\s*/i, '')
  t = t.replace(/^["'«\s]+|["'»\s]+$/g, '')
  t = t.replace(/\b(?:Q|C|H)\s*:\s*$/i, '').trim()
  if (!t) return ''
  return t.charAt(0).toUpperCase() + t.slice(1)
}

interface Verdict {
  ok: boolean
  reason: string
}

/** Garde-fous : confiance, lexique appris, répétition, ancrage dans le contexte. */
export function verdictOn(
  text: string,
  opts: { avgNll: number; lexicon: Set<string>; passage: string | null; minGrounding: number }
): Verdict {
  if (text.length < MIN_ANSWER_CHARS) return { ok: false, reason: `réponse trop courte (${text.length} caractères)` }
  if (text.length > 600) return { ok: false, reason: 'réponse trop longue' }
  const allWords = text.toLowerCase().split(/[^\p{L}']+/u).filter((w) => w.length >= 1)
  if (allWords.length < MIN_ANSWER_WORDS) return { ok: false, reason: `réponse trop courte (${allWords.length} mot(s))` }

  // Filtre décisif : une vraie réponse contient des mots porteurs de sens.
  // Le charabia d'un modèle sous-entraîné n'empile que des mots vides
  // (« De l'est-moi et Je je d'ai. ») tout en affichant une NLL très basse.
  const content = contentTokens(text)
  if (content.length < MIN_CONTENT_WORDS) {
    return { ok: false, reason: `pas assez de mots de contenu (${content.length})` }
  }

  if (opts.avgNll > MAX_CHAT_NLL) return { ok: false, reason: `confiance insuffisante (NLL ${opts.avgNll.toFixed(2)})` }

  const longWords = allWords.filter((w) => w.length >= 3)
  if (longWords.length > 10) {
    const uniq = new Set(longWords).size / longWords.length
    if (uniq < 0.5) return { ok: false, reason: 'réponse répétitive' }
  }
  if (opts.lexicon.size > 0) {
    const coverage = lexiconCoverage(text, opts.lexicon)
    if (coverage < MIN_CHAT_LEXICON) return { ok: false, reason: `mots inconnus (couverture ${coverage.toFixed(2)})` }
  }
  if (opts.passage) {
    const g = groundingOf(text, opts.passage)
    if (g < opts.minGrounding) return { ok: false, reason: `réponse non ancrée (${Math.round(g * 100)} % du contexte)` }
  }
  return { ok: true, reason: '' }
}

/**
 * Réponse de conversation : retrieval → rédaction par le modèle → garde-fous →
 * repli sur le texte retrouvé. Ne renvoie `ok: false` que si rien d'utilisable
 * n'existe (aucun modèle ET aucun savoir pertinent).
 */
export async function answerChat(opts: ChatOptions): Promise<ChatAnswer> {
  const t0 = Date.now()
  const history = opts.history ?? []
  const message = String(opts.message ?? '').trim()
  if (!message) return { ok: false, reason: 'message vide', generated: false }

  const ctx = await retrieveChatContext(message, opts.userId ?? null, history)
  const model = opts.model
  const prompt = chatPrompt({ history, context: ctx.passage, message })

  if (!model) {
    // Aucun modèle entraîné : on répond quand même avec le savoir retrouvé,
    // mais on le signale (le chat n'est pas « généré »).
    if (ctx.fallback) {
      return {
        ok: true,
        text: ctx.fallback,
        generated: false,
        avgNll: Infinity,
        ms: Date.now() - t0,
        tokens: 0,
        confidence: 0,
        source: ctx.source,
        grounded: true,
      }
    }
    return { ok: false, reason: 'aucun modèle entraîné', generated: false }
  }

  // Sans contenu retrouvé, on ne génère pas : le modèle est là pour FORMULER un
  // savoir, pas pour en inventer. Le repli (relance naturelle) prend le relais.
  if (!ctx.passage) {
    if (ctx.fallback) {
      return {
        ok: true,
        text: ctx.fallback,
        generated: false,
        avgNll: Infinity,
        ms: Date.now() - t0,
        tokens: 0,
        confidence: 0,
        source: ctx.source,
        grounded: false,
      }
    }
    return { ok: false, reason: 'aucun contenu pertinent retrouvé', generated: false }
  }

  const seed = opts.seed ?? hashText(`${message}|${history.length}`)
  const res = sample(model, prompt, {
    maxTokens: opts.maxTokens ?? 120,
    // Décodage sobre : la tâche apprise est de rédiger à partir du contenu
    // fourni, pas d'inventer. Une température basse stabilise la copie fidèle.
    temperature: opts.temperature ?? 0.35,
    topK: 4,
    seed,
    repeatPenalty: 1.2,
    repeatWindow: 28,
    stopAtLine: true,
  })
  const text = cleanAnswer(res.text)
  const verdict = verdictOn(text, {
    avgNll: res.avgNll,
    lexicon: model.lexicon,
    passage: ctx.passage,
    minGrounding: MIN_CHAT_GROUNDING,
  })

  if (!verdict.ok) {
    if (ctx.fallback) {
      return {
        ok: true,
        text: ctx.fallback,
        generated: false,
        avgNll: res.avgNll,
        ms: Date.now() - t0,
        tokens: res.tokens,
        confidence: 0,
        source: ctx.source,
        grounded: true,
      }
    }
    return { ok: false, reason: verdict.reason, text, avgNll: res.avgNll, generated: false }
  }

  return {
    ok: true,
    text,
    generated: true,
    avgNll: res.avgNll,
    ms: Date.now() - t0,
    tokens: res.tokens,
    confidence: Math.max(0, Math.min(1, Math.exp(-res.avgNll / 2))),
    source: ctx.source,
    grounded: Boolean(ctx.passage),
  }
}

/**
 * Même traitement que `answerChat`, mais diffuse le texte retenu par petits
 * morceaux : la validation a lieu AVANT le premier octet envoyé, donc on
 * n'affiche jamais un début de charabia pour devoir le reprendre ensuite.
 */
export async function streamChat(opts: ChatOptions): Promise<ChatAnswer> {
  const answer = await answerChat(opts)
  if (!answer.ok || !opts.onDelta) return answer
  const text = answer.text
  const chunk = Math.max(3, Math.round(text.length / 26))
  for (let i = 0; i < text.length; i += chunk) {
    opts.onDelta(text.slice(i, i + chunk))
    // Respiration entre les morceaux : le client voit la réponse s'écrire.
    await new Promise<void>((resolve) => setTimeout(resolve, 9))
  }
  return answer
}

/** Taille du savoir conversationnel disponible (journal / diagnostic). */
export function dialogueStats(): { entries: number; chars: number; topics: number } {
  const topics = new Set(DIALOGUE_BANK.map((e) => e.t))
  return {
    entries: DIALOGUE_BANK.length,
    chars: DIALOGUE_BANK.reduce((s, e) => s + e.q.length + e.a.length, 0),
    topics: topics.size,
  }
}
