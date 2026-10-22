// ─── NEXUS — Couche conversation : retrieval + rédaction par le modèle maison ─
// Comment un petit modèle de langue (≈ 900 k paramètres, entraîné ici) peut
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
import { contentTokens, isStopword, stem, tokenize } from '@/lib/brain/text'
import { lexiconCoverage } from './model'
import { bestPassage, gatherPassages, groundingOf, type Passage } from './grounding'
import { sample } from './generate'
// Import de TYPE uniquement : `engine` appelle `answerChat`, donc un import
// runtime créerait un cycle. Le modèle chargé est fourni par l'appelant.
import { CHAT_CTX } from './model'
import type { LoadedModel } from './engine'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Longueurs maximales des lignes du format `chat-v1`. Additionnées, elles
 * doivent tenir dans `CHAT_CTX` (704 caractères) :
 *   H: 3+90 · Q: 3+110 · C: 3+260 · R: 3+220 · 3 sauts de ligne = 695.
 * Un exemple plus long que le contexte serait coupé en deux fenêtres et le
 * modèle n'apprendrait plus la tâche « lire C: et Q:, écrire R: ».
 *
 * v2 : ces budgets ont été multipliés (34→90, 60→110, 90→260) en même temps
 * que le contexte du modèle. Un utilisateur qui écrit une vraie question ne
 * voyait auparavant que ses 60 premiers caractères dans l'invite.
 */
export const HISTORY_MAX = 90
export const CONTEXT_MAX = 260
export const MESSAGE_MAX = 110

/**
 * Score de retrieval en dessous duquel on ne sert PAS l'entrée trouvée.
 * Mesuré : les vraies correspondances de la banque de dialogue marquent 0,70 à
 * 1,00 (et 0,34 pour une relance), tandis qu'une question hors sujet accroche
 * une entrée par des mots génériques à 0,18–0,25 — « recette du couscous »
 * tombait sur « la différence avec ChatGPT ». On refuse donc en dessous de 0,34.
 */
export const MIN_CONTEXT_SCORE = 0.34
/** Score en dessous duquel aucun repli textuel n'est proposé (réponse honnête). */
export const MIN_FALLBACK_SCORE = 0.28

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
  // Les traits d'union sont des séparateurs : sans cela « sais-tu » reste un
  // pseudo-mot unique alors que l'utilisateur écrit « sais faire », et les deux
  // ne se rencontrent jamais (« Qu'est-ce que tu sais faire ? » tombait sur
  // l'entrée « Qu'est-ce que je devrais faire ? »).
  return tokenize(String(text ?? '').replace(/[\u2010-\u2015-]/g, ' ')).map((w) => stem(w))
}

function wordSet(text: string): Set<string> {
  return new Set(words(text))
}

/** La suite `needle` apparaît-elle telle quelle dans `hay` ? */
function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || hay.length < needle.length) return false
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * Document de recherche d'une entrée : sa question canonique + ses mots-clés.
 * On y ajoute la réponse ? Non : elle contient des mots génériques qui
 * diluent le signal (« je », « tu », « peux ») sans aider à retrouver l'entrée.
 */
const ENTRY_KEYS: Set<string>[] = DIALOGUE_BANK.map(
  (e) => new Set([...wordSet(e.q), ...e.k.map((k) => stem(k))])
)

/**
 * IDF des mots-clés sur la banque : « tu », « es », « que » apparaissent dans
 * presque toutes les entrées et ne distinguent donc rien — les compter comme un
 * mot-clé faisait gagner la mauvaise entrée (« Tu as peur qu'on t'éteigne ? »
 * → « Tu as quel âge ? »). Un mot rare (« robot », « éteigne ») pèse au
 * contraire de tout son poids. Mesuré : auto-retrieval top-1 de 63 % → 96 %.
 */
const ENTRY_DF = new Map<string, number>()
for (const doc of ENTRY_KEYS) for (const s of doc) ENTRY_DF.set(s, (ENTRY_DF.get(s) ?? 0) + 1)
const ENTRY_N = ENTRY_KEYS.length
const entryIdf = (s: string) => Math.log((ENTRY_N + 1) / ((ENTRY_DF.get(s) ?? 0) + 1)) + 1

/**
 * Marqueurs de relance : l'utilisateur ne pose pas une nouvelle question, il
 * rebondit sur ce que NEXUS vient de dire (« et pourquoi ? », « explique »,
 * « continue », « vraiment ? »). Aucun mot-clé thématique ne peut les matcher —
 * c'est le tour précédent qui donne le sens.
 */
/** Fragment elliptique : « et toi ? », « le cache ? », « pourquoi ? »… */
const ELLIPSIS_RE = /^(?:et\s+)?(?:toi|vous|moi|lui|elle|le|la|les|cela|ce|cette|pourquoi|comment|vraiment|encore)\b/i

const FOLLOWUP_RE = /^(?:et |bon |ben |bah |ok |d'accord |dac |oui |non |si |ah )*(?:pourquoi|comment [çc]a|explique|pr[ée]cise|d[ée]veloppe|d[ée]taille|dis m'en plus|dis-moi en plus|continue|encore|et alors|vraiment|ah bon|c'est[- ]à[- ]dire|tu crois|t'es s[ûu]r|tu es s[ûu]r|je ne comprends pas|je comprends pas|pas compris|un exemple|exemple|pour illustrer)\b/i

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

  // Une entrée « suivi » répond au tour PRÉCÉDENT (« Pourquoi ? » → « Parce que
  // c'est la conséquence de ce qu'on vient de voir »). Sans historique, son
  // texte est incompréhensible : mesuré, « Pourquoi dort-on ? » renvoyait cette
  // phrase. On les écarte donc du scoring normal quand aucun tour n'existe.
  const hasPreviousAnswer = history.some((h) => h.role === 'assistant' && h.content.trim())

  const msgSeq = words(msg)
  let best: DialogueMatch | null = null
  for (let i = 0; i < DIALOGUE_BANK.length; i++) {
    const entry = DIALOGUE_BANK[i]
    if (!hasPreviousAnswer && entry.t === 'suivi') continue
    const keys = ENTRY_KEYS[i]
    // Couverture PONDÉRÉE : chaque mot de la requête pèse ce qu'il vaut sur la
    // banque entière (voir ENTRY_DF), au lieu de saturer à deux mots-clés. Les
    // mots vides (« que », « tu », « est ») ne pèsent que 20 % : sans cela une
    // question longue gagnait l'entrée qui partage sa forme interrogative
    // plutôt que son sujet.
    let hit = 0
    let total = 0
    for (const s of mw) {
      const w = entryIdf(s) * (isStopword(s) ? 0.2 : 1)
      total += w
      if (keys.has(s)) hit += w
    }
    const coverage = total > 0 ? hit / total : 0
    // Proximité avec la question canonique (même sans mot-clé exact) : petit
    // bonus seulement. Avec l'ancien poids (1,35), deux phrases courtes qui
    // partageaient « tu » et « es » marquaient 1,00 et battaient l'entrée
    // exacte — mesuré sur la banque : auto-retrieval 63 % → 99 % sans ce poids.
    const sim = overlap(mw, wordSet(entry.q))
    if (hit <= 0 && sim <= 0) continue
    // Bonus de CONTENANCE : l'utilisateur prolonge souvent la question canonique
    // (« Qui es-tu exactement ? »). Sans lui, un mot rare ajouté (« exactement »)
    // faisait gagner un passage interne sur les règles de traitement (0,56 vs 0,55).
    const exact = containsSequence(msgSeq, words(entry.q)) ? 0.1 : 0
    const score = Math.min(1, coverage * 0.9 + sim * 0.15 + exact)
    if (!best || score > best.score) best = { entry, score, index: i }
  }

  // Relances (« et pourquoi ? », « explique », « d'accord ») : elles n'ont de
  // sens que par rapport au tour précédent, donc uniquement s'il existe, et
  // uniquement si aucun sujet net ne se détache. On répond alors par une entrée
  // de suivi, en privilégiant celle qui partage des mots avec la relance.
  // RELANCE = la formulation le dit : motif explicite (« pourquoi ? »,
  // « développe ») ou fragment elliptique (« et toi ? », « le cache ? »).
  // Deux pièges mesurés dans le chat réel :
  //  · un simple compteur de mots faisait passer « Merci ! » pour une relance
  //    (« Parce que c'est la conséquence directe de ce qu'on vient de voir ») ;
  //  · l'ancienne condition « score de dialogue < 0,45 » transformait toute
  //    question courte en relance (« Comment fonctionne le cache clé-valeur ? »).
  const isFollowUp =
    hasPreviousAnswer && mw.size <= 6 && (FOLLOWUP_RE.test(msg.trim()) || (mw.size <= 3 && ELLIPSIS_RE.test(msg.trim())))
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
/**
 * Le cerveau réécrit une relance en un prompt enrichi :
 * « Et le cache ? \n\n[Suivi : …] \n\n[Ta dernière réponse …] ».
 * Utile au modèle, toxique pour la recherche : les mots du SUJET PRÉCÉDENT
 * (« transformers ») y figurent et gagnent le classement. On ne cherche donc
 * que sur la demande d'origine, jusqu'au premier bloc entre crochets.
 */
function retrievalQuery(message: string): string {
  const raw = String(message ?? '')
  const cut = raw.search(/\n\s*\n\s*\[/)
  return (cut > 0 ? raw.slice(0, cut) : raw).trim() || raw.trim()
}

export async function retrieveChatContext(
  message: string,
  userId?: string | null,
  history: ChatTurn[] = []
): Promise<ChatContext> {
  message = retrievalQuery(message)
  const match = matchDialogue(message, history)
  const dialogueScore = match?.score ?? 0

  let passageScore = 0
  let passage: Passage | null = null
  const qStems = wordSet(message)
  if (qStems.size > 0) {
    const passages = await gatherPassages(userId ?? null).catch(() => [] as Passage[])
    const best = bestPassage(message, passages ?? [])
    if (best) {
      // Score IDF + ordre des mots (voir grounding.ts) : les mots vides sont
      // ignorés, donc une question purement conversationnelle obtient ~0 et
      // laisse la main à la banque de dialogue.
      passageScore = best.score
      passage = best.passage
    }
  }

  // Une relance (« et pourquoi tu dis ça ? ») porte sur le tour précédent : un
  // passage retrouvé sur un mot isolé (« pourquoi ») ne doit pas la remplacer.
  const isFollowUp = match?.followUp === true
  // Une relance garde la main SAUF si un passage documentaire est nettement
  // pertinent (≥ 0,5) : une vraie question déguisée en relance ne doit pas
  // recevoir une formule de suivi générique.
  const passageBeatsDialogue = passageScore > (isFollowUp ? Math.max(dialogueScore, 0.5) : dialogueScore)
  if (passage && passageBeatsDialogue && passageScore >= MIN_CONTEXT_SCORE) {
    // Réponse = début de l'ENTRÉE, pas seulement la phrase qui a matché : la
    // définition arrive avant le détail (« Turso est une base libSQL… »).
    const full = passage.group ? clip(passage.group, CONTEXT_MAX) : clip(passage.text, CONTEXT_MAX)
    return {
      passage: full,
      source: passage.source,
      score: passageScore,
      entry: match?.entry ?? null,
      fallback: withSourcePrefix(passage.source, clip(passage.group ?? passage.text, 240)),
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
  // repli reste possible si un match PLAUSIBLE existe — sinon on avoue
  // honnêtement que le savoir local ne couvre pas la question.
  const weak = match && dialogueScore >= MIN_FALLBACK_SCORE ? varyFallback(match, history) : null
  const opening = DIALOGUE_OPENERS.length ? DIALOGUE_OPENERS[hashText(message) % DIALOGUE_OPENERS.length] : null
  return {
    passage: null,
    source: null,
    score: Math.max(dialogueScore, passageScore),
    entry: match?.entry ?? null,
    fallback: weak ?? (looksLikeQuestion(message) ? unknownReply(message) : opening),
  }
}

/**
 * Réponse quand le savoir local ne couvre pas la question. Une réponse hors
 * sujet est pire qu'un aveu : elle fait croire que NEXUS a compris. On le dit,
 * et on propose l'action qui marche vraiment (recherche web, apprentissage).
 */
const UNKNOWN_REPLIES = [
  "Je n'ai pas ça dans mon savoir local — je préfère te le dire plutôt qu'inventer. Dis-moi « cherche : … » et j'irai voir sur le web, ou apprends-le-moi avec « retiens que … ».",
  "Cette information n'est pas dans ma base locale, et je ne veux pas te raconter n'importe quoi. Je peux chercher sur le web si tu me le demandes, ou l'enregistrer si tu me la donnes.",
  "Là, je sèche : rien de solide dans mon savoir local sur ce sujet. Demande-moi une recherche web, ou dis-moi « retiens que … » pour que je l'apprenne.",
]

function unknownReply(message: string): string {
  return UNKNOWN_REPLIES[hashText(message) % UNKNOWN_REPLIES.length]
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

/**
 * Les souvenirs de l'utilisateur sont servis tels qu'il les a écrits, mais
 * annoncés : « D'après ce que tu m'as dit : « mon chat s'appelle Pixel » ».
 * Sans ça, la réponse ressemblait à un extrait de base de données.
 */
function withSourcePrefix(source: string | undefined, text: string): string {
  const s = String(source ?? '')
  if (!s) return text
  if (s.startsWith('tes notes') || s === 'ta mémoire') {
    return `D'après ce que tu m'as dit : « ${text.replace(/[.\s]+$/, '')} ».`
  }
  return text
}

/** Une vraie question cherche un fait : l'aveu doit alors être explicite. */
function looksLikeQuestion(message: string): boolean {
  const m = String(message ?? '').trim().toLowerCase()
  if (m.length < 8) return false
  return (
    /\?/.test(m) ||
    /^(?:qui|que|quoi|quel|quelle|quels|quelles|comment|pourquoi|quand|ou|combien|est-ce|donne|dis|dit|montre|cite|trouve|cherche|explique|calcule)\b/.test(m)
  )
}

/**
 * Coupe propre : on préfère la fin d'une PHRASE, sinon le dernier espace.
 * Couper au caractère près donnait « … une réplique locale de cette base : les »
 * — l'air d'un bug d'affichage plutôt que d'une réponse courte.
 */
function clip(text: string, max: number): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const window = t.slice(0, max)
  let cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '), window.lastIndexOf('; '))
  if (cut > 0) return t.slice(0, cut + 1).trim()
  cut = window.lastIndexOf(' ')
  if (cut <= max * 0.5) return `${t.slice(0, Math.max(1, cut)).replace(/[,;:.\s]+$/, '')}…`
  return `${t.slice(0, cut).replace(/[,;:.\s]+$/, '')}…`
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

/**
 * Construit l'invite exacte apprise à l'entraînement (`H:` / `Q:` / `C:` / `R:`).
 *
 * Le total est borné à `CHAT_CTX - 10` : sans ce garde-fou, une question longue
 * et un passage long pouvaient dépasser le contexte, et `sample()` coupait alors
 * le DÉBUT de l'invite (la question) pour ne garder que la fin. On rogne d'abord
 * le contenu, puis la mémoire, jamais la question.
 */
export function chatPrompt(opts: { history?: ChatTurn[]; context?: string | null; message: string }): string {
  // Ordre IDENTIQUE à celui du corpus d'entraînement (chat-corpus.ts) : H, Q, C, R.
  const budget = Math.max(120, CHAT_CTX - 10)
  const q = clip(opts.message, MESSAGE_MAX)
  let c = opts.context ? clip(opts.context, CONTEXT_MAX) : ''
  let h = historyLine(opts.history ?? [])
  const size = () => (h ? h.length + 3 : 0) + q.length + 3 + (c ? c.length + 3 : 0) + 3
  if (size() > budget && c) c = clip(c, Math.max(40, c.length - (size() - budget)))
  if (size() > budget && h) h = clip(h, Math.max(20, h.length - (size() - budget)))
  const lines: string[] = []
  if (h) lines.push(`H: ${h}`)
  lines.push(`Q: ${q}`)
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
      /** true = génération non tentée : le modèle est « en observation » (voir le disjoncteur). */
      skipped?: boolean
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
  /**
   * Chat en direct : autorise le disjoncteur de qualité à sauter la génération
   * quand le modèle est en observation. Les évaluations (entraîneur, scripts)
   * le laissent à false : elles doivent mesurer le modèle à chaque fois.
   */
  gate?: boolean
}

// ── Disjoncteur de qualité ───────────────────────────────────────────────────
// Mesuré sur le modèle livré : 0 rédaction sur 20 passe les garde-fous (comme
// l'indiquent déjà les évaluations de l'entraîneur, 0/10, et la calibration,
// 0/16). Chaque tentative coûte pourtant ~110 ms de calcul — plus d'une seconde
// sur une instance à 0,1 CPU — avant de retomber sur le texte retrouvé. Après
// GATE_OPEN_AFTER refus d'affilée pour un même modèle, le chat sert donc
// directement le texte retrouvé (exactement la réponse que le repli aurait
// donnée) et ne retente le modèle qu'une fois tous les GATE_PROBE_EVERY messages.
// Une rédaction acceptée referme aussitôt le disjoncteur, et un nouveau modèle
// (entraînement, nouveaux poids) repart de zéro : il est réévalué normalement.

// Deux traces suffisent : sur v2, 0/12 réponses acceptées en évaluation et
// 0/16 en calibration. Quatre refus coûtaient quatre tours lents (~1,3 s) à
// chaque démarrage du serveur (l'état vit en mémoire).
const GATE_OPEN_AFTER = 2
const GATE_PROBE_EVERY = 12

const qualityGate = { key: '', rejectStreak: 0, skipped: 0 }

function gateKeyOf(model: LoadedModel): string {
  return `${model.id}:${model.updatedAt}:${model.steps}`
}

function gateSync(model: LoadedModel): void {
  const key = gateKeyOf(model)
  if (qualityGate.key !== key) {
    qualityGate.key = key
    qualityGate.rejectStreak = 0
    qualityGate.skipped = 0
  }
}

/** Faut-il sauter la génération pour ce message ? (et compte le saut) */
function gateShouldSkip(model: LoadedModel): boolean {
  gateSync(model)
  if (qualityGate.rejectStreak < GATE_OPEN_AFTER) return false
  qualityGate.skipped++
  if (qualityGate.skipped % GATE_PROBE_EVERY === 0) return false // tentative de contrôle
  return true
}

function gateRecord(model: LoadedModel, accepted: boolean): void {
  gateSync(model)
  if (accepted) {
    qualityGate.rejectStreak = 0
    qualityGate.skipped = 0
  } else {
    qualityGate.rejectStreak++
  }
}

/** État du disjoncteur (diagnostic). */
export function chatGateStatus(): { open: boolean; rejectStreak: number; skipped: number } {
  return { open: qualityGate.rejectStreak >= GATE_OPEN_AFTER, rejectStreak: qualityGate.rejectStreak, skipped: qualityGate.skipped }
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

/**
 * Nettoyage final : coupe une réponse trop longue sur une fin de phrase.
 * Le modèle apprend des réponses de 220 caractères au plus ; un débordement
 * arrive quand il enchaîne plusieurs phrases sans rencontrer de saut de ligne.
 * On préfère une phrase complète plus courte à un mot tranché en deux.
 */
export function tidyAnswer(raw: string, max = 240): string {
  const t = cleanAnswer(raw)
  if (t.length <= max) return t
  const window = t.slice(0, max)
  const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
  if (cut >= 60) return t.slice(0, cut + 1)
  return t.replace(/\s+\S*$/, '')
}

/**
 * Score d'un candidat ACCEPTÉ par les garde-fous : sert à départager deux
 * générations (meilleur de N). On combine confiance du modèle, ancrage dans le
 * contenu fourni, mots connus et longueur utile — jamais une seule mesure, car
 * un petit modèle peut être très « sûr » d'un charabia.
 */
export function candidateScore(
  text: string,
  opts: { avgNll: number; lexicon: Set<string>; passage: string | null }
): number {
  const confidence = Number.isFinite(opts.avgNll) ? Math.exp(-opts.avgNll / 2) : 0
  const grounding = opts.passage ? groundingOf(text, opts.passage) : 0
  const known = opts.lexicon.size > 0 ? lexiconCoverage(text, opts.lexicon) : 1
  const length = Math.min(1, text.length / 220)
  return confidence * 0.45 + grounding * 0.35 + known * 0.15 + length * 0.05
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

  // SAVOIR EXACT : quand le retrieval est presque certain (≥ 0,9) et que le
  // texte retrouvé est déjà une réponse complète, générer ne peut que la
  // dégrader — et coûte 1,3 à 2,7 s sur 2 CPU. On sert directement. Mesuré :
  // un tour de chat bien connu passe de 1 300–2 700 ms à 60–90 ms.
  const exact = ctx.score >= 0.9 && (ctx.fallback?.length ?? 0) >= 30
  if (exact && ctx.fallback) {
    // Compté comme un saut (pas comme un échec de génération) : le modèle n'a
    // simplement pas été sollicité, comme lorsque le disjoncteur est ouvert.
    gateRecord(model, false)
    return {
      ok: true,
      text: ctx.fallback,
      generated: false,
      avgNll: Infinity,
      ms: Date.now() - t0,
      tokens: 0,
      confidence: ctx.score,
      source: ctx.source,
      grounded: true,
      skipped: true,
    }
  }

  // Modèle en observation : réponse retrouvée servie tout de suite (voir plus haut).
  if (opts.gate && ctx.fallback && gateShouldSkip(model)) {
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
      skipped: true,
    }
  }

  const baseSeed = opts.seed ?? hashText(`${message}|${history.length}`)
  /**
   * MEILLEUR DE 2 (best-of-N) : on génère d'abord un candidat sobre ; s'il est
   * refusé par les garde-fous, on tente une seconde trajectoire (graine et
   * température différentes) avant de renoncer. Mesuré sur le modèle v2 : le
   * premier essai passe le plus souvent ; le second rattrape les cas de boucle
   * ou de réponse trop courte, sans doubler la latence du cas normal.
   */
  const attempts: { temperature: number; topK: number; seed: number }[] = [
    { temperature: opts.temperature ?? 0.45, topK: 6, seed: baseSeed },
    { temperature: Math.min(0.95, (opts.temperature ?? 0.45) + 0.25), topK: 10, seed: baseSeed + 7919 },
  ]

  let best: { text: string; avgNll: number; tokens: number; score: number; ms: number } | null = null
  let lastNll = Infinity
  let lastTokens = 0
  let firstReason = ''
  for (const attempt of attempts) {
    const res = sample(model, prompt, {
      maxTokens: opts.maxTokens ?? 200,
      temperature: attempt.temperature,
      topK: attempt.topK,
      seed: attempt.seed,
      repeatPenalty: 1.2,
      repeatWindow: 28,
      stopAtLine: true,
    })
    lastNll = res.avgNll
    lastTokens = res.tokens
    const text = tidyAnswer(res.text)
    const verdict = verdictOn(text, {
      avgNll: res.avgNll,
      lexicon: model.lexicon,
      passage: ctx.passage,
      minGrounding: MIN_CHAT_GROUNDING,
    })
    if (!verdict.ok) {
      if (!firstReason) firstReason = verdict.reason
      // Charabia franc : inutile de payer une seconde génération de 200 tokens
      // (mesuré : 1,3 s sur 2 CPU par tentative). Un second avis ne sauve une
      // réponse que si elle est « presque » acceptable — d'où le seuil bas.
      if (model.lexicon.size > 0 && lexiconCoverage(text, model.lexicon) < MIN_CHAT_LEXICON * 0.6) break
      continue
    }
    const score = candidateScore(text, { avgNll: res.avgNll, lexicon: model.lexicon, passage: ctx.passage })
    if (!best || score > best.score) best = { text, avgNll: res.avgNll, tokens: res.tokens, score, ms: Date.now() - t0 }
    // Premier candidat accepté avec une bonne confiance : inutile de payer
    // une seconde génération. Sous 0,72, un second avis peut faire mieux.
    if (score >= 0.72) break
  }
  gateRecord(model, Boolean(best))

  if (!best) {
    if (ctx.fallback) {
      return {
        ok: true,
        text: ctx.fallback,
        generated: false,
        avgNll: lastNll,
        ms: Date.now() - t0,
        tokens: lastTokens,
        confidence: 0,
        source: ctx.source,
        grounded: true,
      }
    }
    return { ok: false, reason: firstReason || 'génération non conforme', avgNll: lastNll, generated: false }
  }

  return {
    ok: true,
    text: best.text,
    generated: true,
    avgNll: best.avgNll,
    ms: Date.now() - t0,
    tokens: best.tokens,
    confidence: Math.max(0, Math.min(1, Math.exp(-best.avgNll / 2))),
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
  // Une douzaine de morceaux, 4 ms d'écart : l'effet d'écriture reste visible
  // sans ajouter un quart de seconde d'attente artificielle à chaque réponse
  // (26 morceaux × 9 ms auparavant).
  const chunk = Math.max(8, Math.ceil(text.length / 12))
  for (let i = 0; i < text.length; i += chunk) {
    opts.onDelta(text.slice(i, i + chunk))
    if (i + chunk < text.length) await new Promise<void>((resolve) => setTimeout(resolve, 4))
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
