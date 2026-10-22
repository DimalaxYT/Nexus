// ─── NEXUS — Réponses ancrées : le modèle s'appuie sur un passage vérifié ────
// Un petit modèle n'a pas assez de paramètres pour retenir des faits. Plutôt que
// de les inventer, il reçoit un passage pertinent (issu de la banque, des
// apprentissages validés ou des notes de l'utilisateur) et rédige sa réponse
// À PARTIR de ce passage. Chaque réponse garde donc sa source, et une réponse
// qui ne reprend pas le passage est refusée.

import { NEXUS_KNOWLEDGE } from '@/lib/brain/knowledge-bank'
import { stem, stems } from '@/lib/brain/text'
import { db } from '@/lib/db'
import { GROUNDED_FORMAT, GROUNDED_CTX } from './model'

export { GROUNDED_FORMAT, GROUNDED_CTX }

/**
 * Longueur maximale d'un passage : assez court pour tenir dans le contexte, assez
 * long pour porter un fait complet. Passé de 90 à 180 caractères avec le modèle
 * v2 (contexte 704) : à 90, une réponse de connaissance était tronquée avant
 * même d'être formulée, alors que le modèle a appris sur des passages de 220.
 */
export const PASSAGE_MAX = 180
/** Longueur maximale d'une question dans le format ancré. */
export const QUESTION_MAX = 60
/** Passages retenus par réponse source (évite de noyer le corpus). */
const MAX_PASSAGES_PER_ANSWER = 8
/** Part des mots de la question que le meilleur passage doit couvrir. */
export const MIN_PASSAGE_SCORE = 0.6
/** Part des mots de la réponse qui doit venir du passage (anti-hallucination). */
export const MIN_GROUNDING = 0.8

export interface Passage {
  text: string
  source: string
  /**
   * Titre / question d'origine, utilisé UNIQUEMENT pour la recherche.
   * Sans lui, une question comme « que sais-tu faire ? » ne pouvait pas trouver
   * une réponse qui ne répète pas ses mots (« je peux chercher, coder… ») :
   * mesuré, 4/12 requêtes retrouvaient le bon passage avant ce correctif.
   */
  title?: string
}

/** Découpe un texte (markdown compris) en passages courts et propres. */
export function passagesOf(raw: string): string[] {
  const text = String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_#>|\\]/g, '')
  const out: string[] = []
  for (const block of text.split(/\n+/)) {
    for (const sentence of block.split(/(?<=[.!?])\s+/)) {
      let s = sentence.replace(/^\s*(?:[-•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
      while (s.length > PASSAGE_MAX) {
        const cut = s.lastIndexOf(' ', PASSAGE_MAX)
        const at = cut > 30 ? cut : PASSAGE_MAX
        const head = s.slice(0, at).trim()
        if (head.length >= 20) out.push(head)
        s = s.slice(at).trim()
      }
      if (s.length >= 20) out.push(s)
    }
  }
  return [...new Set(out)].slice(0, MAX_PASSAGES_PER_ANSWER)
}

export function cleanQuestion(question: string): string {
  return String(question ?? '').replace(/\s+/g, ' ').trim().slice(0, QUESTION_MAX)
}

/** Exemple d'entraînement : le passage sert de contexte ET de réponse à copier. */
export function groundedDoc(question: string, passage: string): string {
  return `C: ${passage}\nQ: ${cleanQuestion(question)}\nR: ${passage}`
}

/** Exemples d'entraînement pour une question et sa réponse source. */
export function groundedDocsFor(question: string, answer: string): string[] {
  const q = cleanQuestion(question)
  if (q.length < 3) return []
  return passagesOf(answer).map((p) => groundedDoc(q, p))
}

/** Invite envoyée au modèle : il doit écrire la réponse après « R: ». */
export function groundedPrompt(question: string, passage: string): string {
  return `C: ${passage}\nQ: ${cleanQuestion(question)}\nR: `
}

/** Radicaux pour la recherche : les traits d'union séparent les mots
 *  (« sais-tu », « clé-valeur ») au lieu de créer un pseudo-mot unique. */
function retrievalStems(text: string): string[] {
  return stems(String(text ?? '').replace(/[\u2010-\u2015-]/g, ' '))
}

/**
 * Mots de la QUESTION qui ne désignent aucun sujet : formules de politesse,
 * verbes de demande, verbes génériques. Les garder faisait gagner des passages
 * hors sujet par simple collision (« comment se PASSE le sommeil » → « mot de
 * PASSE »). Ils sont retirés UNIQUEMENT de la requête, jamais des passages.
 */
const QUERY_NOISE = new Set([
  'comment', 'pourquoi', 'quoi', 'que', 'qui', 'quel', 'quelle', 'quels', 'quelles',
  'combien', 'quand', 'ou', 'est', 'sont', 'peut', 'peux', 'pouvoir', 'veux', 'veut',
  'voudrais', 'aimerais', 'sais', 'savoir', 'connais', 'connaitre', 'faire', 'fait',
  'dis', 'dire', 'explique', 'expliquer', 'parle', 'parler', 'raconte', 'raconter',
  'donne', 'donner', 'montre', 'montrer', 'passe', 'passer', 'fonctionne', 'fonctionner',
  'marche', 'marcher', 'sert', 'servir', 'stp', 'svp', 'merci', 'peux-tu', 'sais-tu',
  'aide', 'aider', 'besoin', 'veux-tu', 'quelqu', 'chose', 'truc', 'genre', 'sorte',
  // Adverbes de degré/fréquence : ils ne désignent aucun sujet et pèsent lourd
  // dans une question courte (« Un peu de motivation » → « peu » gagnait un
  // passage sur la programmation).
  'peu', 'beaucoup', 'vraiment', 'juste', 'aussi', 'encore', 'toujours', 'jamais',
  'trop', 'assez', 'plus', 'moins', 'deja', 'souvent', 'parfois', 'maintenant',
])

/**
 * Mots vides de requête, STEMMÉS. QUERY_NOISE est écrit en français lisible
 * (« fonctionne », « explique ») alors que la recherche travaille sur des
 * radicaux (« fonctionn », « expliqu ») : comparer les deux laissait passer
 * exactement les mots qu'on voulait retirer — « Comment fonctionne l'IA ? »
 * gardait « comment » + « fonctionne » et gagnait un passage sur le SEL.
 */
const QUERY_NOISE_STEMS = new Set([...QUERY_NOISE].map((w) => stem(w)))

function queryStems(question: string): Set<string> {
  return new Set(
    retrievalStems(question).filter((s) => s.length > 2 && !QUERY_NOISE_STEMS.has(s))
  )
}

/**
 * Radicaux de la requête pour la RECHERCHE : si le filtrage ne laisse rien
 * (« Qui es-tu ? » ne contient que des mots-outils), on retombe sur les
 * radicaux bruts — sinon la requête ne trouvait AUCUN passage (mesuré).
 */
function searchStems(question: string): string[] {
  const clean = [...queryStems(question)]
  if (clean.length > 0) return clean
  return [...new Set(retrievalStems(question).filter((s) => s.length > 2))]
}

/** Part des radicaux de la question présents dans le passage (0 → 1). */
export function scorePassage(question: string, passage: string): number {
  const qs = queryStems(question)
  if (qs.size === 0) return 0
  const hay = new Set(stems(passage))
  let hits = 0
  for (const s of qs) if (hay.has(s)) hits++
  return hits / qs.size
}

/** Part des radicaux d'un texte présents dans un passage (ancrage). */
export function groundingOf(text: string, passage: string): number {
  const own = stems(text).filter((s) => s.length > 2)
  if (own.length === 0) return 0
  const hay = new Set(stems(passage))
  return own.filter((s) => hay.has(s)).length / own.length
}

// ── Recherche du meilleur passage (IDF + ordre des mots + trigrammes) ───────
// La couverture brute de `scorePassage` favorise les passages LONGS et les mots
// fréquents : « que sais-tu faire ? » trouve un passage sur la base SQLite parce
// qu'il contient « faire ». Trois correctifs, tous mesurables :
//   · IDF — un radical rare (« turso », « photosynthesis ») pèse plus qu'un
//     radical présent dans tous les passages ;
//   · bigrammes — l'ORDRE des mots compte (« mémoire longue » ≠ « long terme ») ;
//   · trigrammes de caractères — tolère les fautes de frappe et les variantes.

const IDF_CACHE = new WeakMap<Passage[], Map<string, number>>()

function idfOf(passages: Passage[]): Map<string, number> {
  const hit = IDF_CACHE.get(passages)
  if (hit) return hit
  const df = new Map<string, number>()
  for (const p of passages) {
    for (const s of new Set(retrievalStems(p.text))) df.set(s, (df.get(s) ?? 0) + 1)
  }
  const n = passages.length
  const idf = new Map<string, number>()
  for (const [s, d] of df) idf.set(s, Math.log((n + 1) / (d + 1)) + 1)
  IDF_CACHE.set(passages, idf)
  return idf
}

/** Trigrammes de caractères d'un texte normalisé (ponctuation/espaces retirés). */
function trigrams(text: string): Set<string> {
  const t = ` ${String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
  const out = new Set<string>()
  for (let i = 0; i + 3 <= t.length; i++) out.add(t.slice(i, i + 3))
  return out
}

function trigramJaccard(a: string, b: string): number {
  const ta = trigrams(a)
  const tb = trigrams(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const x of ta) if (tb.has(x)) inter++
  return inter / (ta.size + tb.size - inter)
}

function containsSequence(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || hay.length < needle.length) return false
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}

/**
 * Score d'un passage (0→1) : le TEXTE fait foi, le TITRE sert à retrouver
 * l'entrée. Sans cette séparation, toutes les phrases d'une même entrée
 * héritaient du score de la question et la mauvaise phrase gagnait
 * (« Pourquoi le ciel est bleu ? » renvoyait « Et le coucher de soleil ? »).
 */
export function rankPassage(question: string, passage: string, idf: Map<string, number>, title = ''): number {
  const qStems = searchStems(question)
  if (qStems.length === 0) return 0

  const weight = (s: string) => idf.get(s) ?? 1
  let total = 0
  for (const s of qStems) total += weight(s)
  if (total <= 0) return 0

  const hay = retrievalStems(passage)
  const haySet = new Set(hay)
  let textHit = 0
  for (const s of qStems) if (haySet.has(s)) textHit += weight(s)
  const textCoverage = textHit / total

  // Couverture du titre (question d'origine de l'entrée), plafonnée : elle
  // aiguille vers la bonne entrée mais ne doit pas décider de la phrase.
  const titleSet = new Set(retrievalStems(title))
  let titleHit = 0
  for (const s of qStems) if (titleSet.has(s)) titleHit += weight(s)
  const titleCoverage = titleHit / total

  let bigrams = 0
  let found = 0
  for (let i = 0; i + 1 < qStems.length; i++) {
    bigrams++
    if (containsSequence(hay, [qStems[i], qStems[i + 1]])) found++
  }
  const phrase = bigrams > 0 ? found / bigrams : 0
  const fuzzy = trigramJaccard(question, passage)
  // Poids mesurés sur l'auto-retrieval des 35 entrées de la banque : une
  // couverture de TITRE vaut plus qu'un mot isolé trouvé dans une phrase
  // (« Un peu de motivation » tombait sur un passage qui disait juste
  // « ce qui te motive »). 0,60/0,25 donnait 32/34 ; 0,55/0,35 donne 33/34.
  return textCoverage * 0.55 + Math.min(1, titleCoverage) * 0.35 + phrase * 0.05 + fuzzy * 0.05
}

export function bestPassage(question: string, passages: Passage[]): { passage: Passage; score: number } | null {
  const idf = idfOf(passages)
  let best: { passage: Passage; score: number } | null = null
  for (const p of passages) {
    const score = rankPassage(question, p.text, idf, p.title ?? '')
    if (!best || score > best.score) best = { passage: p, score }
  }
  return best && best.score > 0 ? best : null
}

// ── Sources de passages ──────────────────────────────────────────────────────

const CACHE_MS = 60_000
let cache: { key: string; at: number; passages: Passage[] } | null = null

/** Tous les passages disponibles pour cet utilisateur (cache court). */
export async function gatherPassages(userId?: string | null): Promise<Passage[]> {
  const key = userId ?? ''
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.passages
  const out: Passage[] = []
  for (const entry of NEXUS_KNOWLEDGE) {
    for (const p of passagesOf(entry.answer)) {
      out.push({
        text: p,
        source: 'banque de connaissances NEXUS',
        title: `${entry.question} ${entry.keywords.join(' ')}`,
      })
    }
  }
  const items = await db.trainingItem
    .findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 500 })
    .catch(() => [])
  for (const it of items ?? []) {
    for (const p of passagesOf(String(it.answer ?? ''))) {
      out.push({ text: p, source: 'apprentissage Dev', title: String(it.question ?? '') })
    }
  }
  if (userId) {
    const notes = await db.knowledge.findMany({ where: { userId }, take: 300 }).catch(() => [])
    for (const n of notes ?? []) {
      const title = String(n.title ?? '').slice(0, 40)
      for (const p of passagesOf(String(n.content ?? ''))) out.push({ text: p, source: `tes notes : ${title}`, title })
    }
    // Mémoires longues (prénom, projets, préférences) : c'est ce qui permet au
    // modèle de répondre « comme il te connaît » sans rien inventer.
    const memories = await db.memory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 120 }).catch(() => [])
    for (const m of memories ?? []) {
      for (const p of passagesOf(String(m.content ?? ''))) out.push({ text: p, source: 'ta mémoire' })
    }
  }
  cache = { key, at: Date.now(), passages: out }
  return out
}

export function invalidatePassageCache(): void {
  cache = null
}
