// ─── NEXUS — Réponses ancrées : le modèle s'appuie sur un passage vérifié ────
// Un petit modèle n'a pas assez de paramètres pour retenir des faits. Plutôt que
// de les inventer, il reçoit un passage pertinent (issu de la banque, des
// apprentissages validés ou des notes de l'utilisateur) et rédige sa réponse
// À PARTIR de ce passage. Chaque réponse garde donc sa source, et une réponse
// qui ne reprend pas le passage est refusée.

import { NEXUS_KNOWLEDGE } from '@/lib/brain/knowledge-bank'
import { PROJECT_KNOWLEDGE } from '@/lib/brain/project-knowledge'
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
/**
 * Part minimale des mots les plus spécifiques de la question (2 plus rares) que
 * le passage doit contenir. En dessous, on considère que le passage ne répond
 * pas : mieux vaut dire « je ne sais pas » que servir un hors-sujet.
 */
export const KEY_COVERAGE_MIN = 0.5

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
  /**
   * Réponse complète de l'entrée, nettoyée (markdown retiré) et bornée à ses
   * premiers passages. Le retrieval choisit UNE phrase ; la réponse servie
   * gagne à commencer par le début de l'entrée (« Turso est une base… ») plutôt
   * que par la phrase qui a matché, parfois au milieu de l'explication.
   */
  group?: string
  /**
   * Mots-clés déclencheurs de l'entrée (radicaux). Un mot-clé retrouvé dans la
   * question est un signal FORT : il a été écrit à la main pour ça. C'est ce qui
   * permet à « protéger mon site des injections » de trouver l'entrée sécurité,
   * alors que « protéger » et « site » n'existent nulle part dans le corpus.
   */
  keys?: string[][]
}

/** Découpe un texte (markdown compris) en passages courts et propres. */
export function passagesOf(raw: string): string[] {
  const text = String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    // Les underscores sont CONSERVÉS : ils font partie des identifiants
    // (`TURSO_DATABASE_URL`, `joueur_`, `epee_legendaire`) et les banques
    // n'utilisent pas l'italique markdown `_…_`.
    .replace(/[`*#>|\\]/g, '')
  const out: string[] = []
  for (const block of text.split(/\n+/)) {
    // On ne coupe une phrase que si la suivante COMMENCE par une majuscule ou
    // un chiffre : sans cette condition, « 753 av. J.-C. : fondation légendaire »
    // produisait un passage commençant par « : », illisible une fois servi.
    // Et on recolle les coupures après une abréviation (« av. » + « J.-C. »).
    const chunks = block.split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"“])/)
    const sentences: string[] = []
    for (const chunk of chunks) {
      const prev = sentences[sentences.length - 1]
      if (prev && /\s[A-Za-zÀ-ÿ]{1,2}\.$/.test(prev)) sentences[sentences.length - 1] = `${prev} ${chunk}`
      else sentences.push(chunk)
    }
    for (const sentence of sentences) {
      let s = sentence.replace(/^\s*(?:[-•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim()
      while (s.length > PASSAGE_MAX) {
        const cut = s.lastIndexOf(' ', PASSAGE_MAX)
        const at = cut > 30 ? cut : PASSAGE_MAX
        const head = s.slice(0, at).trim()
        if (head.length >= 20) out.push(head)
        s = s.slice(at).trim()
      }
      if (s.length >= 20 && !/^[,;:!?…»)]/.test(s)) out.push(s)
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

/**
 * Petits alias de radicaux : le stemmeur ne rapproche pas les synonymes, et
 * « Quel est le nom de mon chat ? » ne trouvait pas « mon chat s'appelle
 * Pixel ». Volontairement minuscule — chaque alias est une dette de sens.
 */
const STEM_ALIASES: Record<string, string> = { nom: 'appel', prenom: 'appel' }

/** Radicaux pour la recherche : les traits d'union séparent les mots
 *  (« sais-tu », « clé-valeur ») au lieu de créer un pseudo-mot unique. */
function retrievalStems(text: string): string[] {
  return stems(String(text ?? '').replace(/[\u2010-\u2015-]/g, ' ')).map((s) => STEM_ALIASES[s] ?? s)
}

/**
 * Radicaux d'un TEXTE comparé à la question. Il DOIT passer par
 * `retrievalStems` : mélanger les deux découpages faisait échouer la porte de
 * pertinence sur les mots à trait d'union (« Pourquoi dort-on ? » : la question
 * donne « dort », le titre donnait « dort-on » — aucun passage ne répondait).
 */
function hayOf(text: string): Set<string> {
  return new Set(retrievalStems(text))
}

/**
 * ENTITÉS de la question : les mots capitalisés au milieu de la phrase
 * (« NEXUS », « Roblox », « DataStore », « Turso »). C'est le seul signal
 * typographique fiable dont on dispose, et il vaut de l'or : « Qui a créé
 * NEXUS ? » tombait sur l'entrée « Comment créer un jeu Roblox ? » parce que
 * « créé » et « créer » partagent le radical « cre » — l'entité, elle, ne
 * mentait pas. Règle : si la question nomme une entité, l'entrée doit en citer
 * au moins une.
 */
export function entitiesOf(question: string): Set<string> {
  const out = new Set<string>()
  const words = String(question ?? '').split(/\s+/)
  for (let i = 1; i < words.length; i++) {
    const raw = words[i].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    if (raw.length < 3) continue
    const first = raw[0]
    if (first !== first.toUpperCase() || first === first.toLowerCase()) continue
    const stemmed = retrievalStems(raw)[0]
    if (stemmed && stemmed.length > 2) out.add(stemmed)
  }
  return out
}

/**
 * Le passage (ou le titre) parle-t-il des entités nommées par la question ?
 *
 * Deux régimes, parce que les deux cas ne veulent pas dire la même chose :
 *  · entité ABSENTE du corpus (« Tesla », « Kazakhstan ») : c'est un nom propre
 *    inconnu, il doit être cité — sinon « Combien coûte une Tesla Model 3 ? »
 *    se rabattait sur l'entrée « Quel modèle de langue… » à cause du mot
 *    « Model » ;
 *  · entité connue (« NEXUS », « Roblox ») : au moins une doit être citée.
 */
export function sameStem(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 4 || b.length < 4) return false
  return a.startsWith(b) || b.startsWith(a)
}

function mentionsEntity(entities: Set<string>, hay: Set<string>, idf: Map<string, number>): boolean {
  if (entities.size === 0) return true
  const has = (e: string) => [...hay].some((h) => sameStem(h, e))
  const unknown = [...entities].filter((e) => !idf.has(e))
  if (unknown.length > 0) return unknown.every(has)
  for (const e of entities) if (has(e)) return true
  return false
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
  const hay = hayOf(passage)
  let hits = 0
  for (const s of qs) if (hay.has(s)) hits++
  return hits / qs.size
}

/** Part des radicaux d'un texte présents dans un passage (ancrage). */
export function groundingOf(text: string, passage: string): number {
  const own = retrievalStems(text).filter((s) => s.length > 2)
  if (own.length === 0) return 0
  const hay = hayOf(passage)
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

/** Poids d'un radical absent du corpus : le plus spécifique possible. */
const UNKNOWN_IDF = 8

export function passageIdf(passages: Passage[]): Map<string, number> {
  return idfOf(passages)
}

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

/**
 * Poids d'un radical. Un radical ABSENT du corpus est le plus spécifique qui
 * soit (df = 0) : le compter à 1 — comme le faisait `idf.get(s) ?? 1` — le
 * classait parmi les mots les plus banals, si bien qu'une question sur une
 * entité inconnue (« Kazakhstan », « Tesla ») se rabattait sur ses mots
 * génériques et recevait un passage hors sujet.
 */
function idfWeight(idf: Map<string, number>, s: string): number {
  return idf.get(s) ?? UNKNOWN_IDF
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
/**
 * Diagnostic de la porte de pertinence : le passage contient-il le mot le plus
 * spécifique de la question, et quelle part des deux plus spécifiques ?
 * Exporté pour que `scripts/check-retrieval.ts` puisse mesurer la porte au lieu
 * de la supposer.
 */
export function relevanceOf(
  question: string,
  passage: string,
  idf: Map<string, number>
): { keyCoverage: number; top1: boolean } {
  const qStems = searchStems(question)
  if (qStems.length === 0) return { keyCoverage: 0, top1: false }
  const weight = (s: string) => idfWeight(idf, s)
  const key = [...qStems].sort((a, b) => weight(b) - weight(a)).slice(0, 2)
  const hay = hayOf(passage)
  let hit = 0
  let total = 0
  for (const s of key) {
    const w = weight(s)
    total += w
    if (hay.has(s)) hit += w
  }
  return { keyCoverage: total > 0 ? hit / total : 0, top1: hay.has(key[0]) }
}

export function rankPassage(question: string, passage: string, idf: Map<string, number>, title = ''): number {
  const qStems = searchStems(question)
  if (qStems.length === 0) return 0

  const weight = (s: string) => idfWeight(idf, s)

  // PORTE DE PERTINENCE : les mots les PLUS SPÉCIFIQUES de la question doivent
  // être retrouvés, sinon le passage ne répond pas à la question posée.
  // Mesuré sans cette porte : « capitale du Kazakhstan » recevait une phrase sur
  // le Japon, « recette du couscous » une définition d'algorithme, et « quel
  // temps fera-t-il demain ? » un conseil d'organisation (« temps » !). Une
  // réponse hors sujet est pire qu'un « je ne sais pas » : on préfère refuser.
  const key = [...qStems].sort((a, b) => weight(b) - weight(a)).slice(0, 2)
  // Le TITRE compte : l'entrée « Comment installer et lancer NEXUS ? » ne répète
  // pas « installer » dans son corps de texte, et la porte refusait alors la
  // bonne entrée. Le titre est l'identité de la source, pas une phrase.
  const keyHay = new Set([...hayOf(passage), ...hayOf(title)])
  let keyHit = 0
  let keyTotal = 0
  for (const s of key) {
    const w = weight(s)
    keyTotal += w
    if ([...keyHay].some((h) => sameStem(h, s))) keyHit += w
  }
  if (keyTotal > 0 && keyHit / keyTotal < KEY_COVERAGE_MIN) return 0
  // …et une entité nommée dans la question doit être citée.
  if (!mentionsEntity(entitiesOf(question), keyHay, idf)) return 0
  let total = 0
  for (const s of qStems) total += weight(s)
  if (total <= 0) return 0

  const hay = retrievalStems(passage)
  const haySet = new Set(hay)
  let textHit = 0
  for (const s of qStems) if ([...haySet].some((h) => sameStem(h, s))) textHit += weight(s)
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

/**
 * Score d'une ENTRÉE (titre + mots-clés) pour la question : couverture IDF de
 * ce que la question a de plus spécifique, plus un bonus quand la question de
 * l'entrée apparaît telle quelle dans le message.
 */
export function rankEntry(
  question: string,
  title: string,
  idf: Map<string, number>,
  keys: string[][] = [],
  body: Set<string> = new Set()
): number {
  const qStems = searchStems(question)
  if (qStems.length === 0) return 0
  const weight = (s: string) => idfWeight(idf, s)
  const titleSet = new Set(retrievalStems(title))
  let hit = 0
  let total = 0
  for (const s of qStems) {
    const w = weight(s)
    total += w
    if ([...titleSet].some((t) => sameStem(t, s))) hit += w
  }
  if (total <= 0) return 0
  const coverage = hit / total
  // Le mot le plus spécifique de la question doit figurer dans le titre :
  // c'est ce qui distingue « Turso » de « base de données ». Il pèse la moitié
  // du score : sans cela, « Comment faire un jeu Roblox avec des DataStore ? »
  // choisissait l'entrée « Comment créer un jeu Roblox ? » (deux mots génériques
  // couverts) plutôt que l'entrée DataStore (le mot qui décide, non couvert).
  const key = [...qStems].sort((a, b) => weight(b) - weight(a))[0]
  const keyCovered = titleSet.has(key)
  // Entité nommée : sans elle, l'entrée n'est pas celle qu'on cherche.
  if (!mentionsEntity(entitiesOf(question), titleSet, idf)) return 0
  // Mot-clé déclencheur présent dans la question ET dans le titre de l'entrée.
  const qSet = new Set(qStems)
  const matches = sameStem
  // Un mot-clé ne compte que s'il est SPÉCIFIQUE (idf ≥ 3, soit ≈ 30 passages
  // sur 300) : « programmation » est un mot-clé de plusieurs entrées et ne doit
  // pas faire gagner « Les bases de la programmation » sur une question qui
  // parle de langage ; « injection » n'apparaît que dans l'entrée sécurité.
  const specific = (k: string[]) => k.some((s) => weight(s) >= 3)
  // Le mot-clé doit être déclenché par la question et présent soit dans la
  // question de l'entrée, soit dans son texte : sans le corps, « apprendre à
  // coder débutant » ne trouvait pas « Les bases de la programmation » (dont
  // les mots-clés décrivent le contenu, pas le titre).
  const keywordHit = keys.some(
    (k) =>
      k.length > 0 &&
      specific(k) &&
      k.every((s) => [...qSet].some((q) => matches(q, s))) &&
      [...titleSet, ...body].some((t) => k.some((s) => matches(t, s)))
  )
  const base = Math.min(1, coverage * 0.5 + (keyCovered ? 0.5 : 0) + (keywordHit ? 0.45 : 0))
  // Départage : la question posée apparaît-elle TELLE QUELLE dans le titre ?
  // (« Quel langage de programmation apprendre ? » égalait l'entrée dédiée et
  // « Les bases de la programmation » ; l'ordre exact des mots tranche.)
  const exact = containsSequence(retrievalStems(title), searchStems(question))
  return base + (exact ? 0.02 : 0)
}

/** Score du meilleur passage D'UNE entrée (sa phrase la plus proche), ou 0. */
function bestInEntry(question: string, group: Passage[], idf: Map<string, number>): { passage: Passage; score: number } | null {
  let best: { passage: Passage; score: number } | null = null
  for (const p of group) {
    const score = rankPassage(question, p.text, idf, '')
    if (!best || score > best.score) best = { passage: p, score }
  }
  return best
}

/** Meilleure phrase sans entrée (souvenirs, mémoires longues). */
function bestUntitled(question: string, passages: Passage[], idf: Map<string, number>): { passage: Passage; score: number } | null {
  let best: { passage: Passage; score: number } | null = null
  for (const p of passages) {
    if (p.title) continue
    const score = rankPassage(question, p.text, idf, '')
    if (!best || score > best.score) best = { passage: p, score }
  }
  return best && best.score > 0 ? best : null
}

/**
 * Meilleur passage, en DEUX TEMPS : d'abord l'ENTRÉE (titre + mots-clés), puis
 * la phrase la plus proche DANS cette entrée.
 *
 * Pourquoi : classer les phrases directement faisait gagner la phrase d'une
 * AUTRE entrée qui partageait un mot (« Un peu de motivation » tombait sur
 * « ce qui te motive » d'un conseil de programmation, 0,56 contre 0,35). Une
 * entrée est identifiée par sa question ; une fois l'entrée choisie, la phrase
 * utile est presque toujours la première (la définition), même si elle ne
 * répète pas les mots de la question — « Pourquoi dort-on ? » n'a pas « dort »
 * dans sa réponse.
 */
export function bestPassage(question: string, passages: Passage[]): { passage: Passage; score: number } | null {
  if (passages.length === 0) return null
  const idf = idfOf(passages)

  // 1. Entrées groupées par titre (les souvenirs sans titre vont au texte seul).
  const entries = new Map<string, Passage[]>()
  for (const p of passages) {
    if (!p.title) continue
    const list = entries.get(p.title)
    if (list) list.push(p)
    else entries.set(p.title, [p])
  }

  let bestEntry: { title: string; score: number; group: Passage[] } | null = null
  for (const [title, group] of entries) {
    const body = new Set(group.flatMap((p) => retrievalStems(p.text)))
    const score = rankEntry(question, title, idf, group[0]?.keys ?? [], body)
    if (!bestEntry || score > bestEntry.score) bestEntry = { title, score, group }
  }

  let entryBest: { passage: Passage; score: number } | null = null
  if (bestEntry) {
    const inner = bestInEntry(question, bestEntry.group, idf)
    // La phrase d'ouverture de l'entrée est la réponse par défaut : c'est la
    // définition, alors qu'une phrase trouvée au hasard au milieu suppose le
    // contexte précédent.
    const passage = inner && inner.score > 0.3 ? inner.passage : bestEntry.group[0]
    const innerScore = inner ? inner.score : 0
    entryBest = { passage, score: bestEntry.score * 0.75 + innerScore * 0.25 }
  }

  // Les SOUVENIRS n'ont pas de titre (ce sont des faits sur l'utilisateur, pas
  // des fiches) : sans cette comparaison, « Comment s'appelle mon chat ? »
  // tombait sur l'entrée « Comment tu t'appelles ? » alors que la mémoire
  // contenait « mon chat s'appelle Pixel ».
  const loose = bestUntitled(question, passages, idf)

  // `bestPassage` classe, il ne décide pas : un score faible est renvoyé tel
  // quel, les seuils (MIN_CONTEXT_SCORE, MIN_FALLBACK_SCORE) appartiennent aux
  // appelants. Avant, une entrée à 0,498 (« Les bases de la programmation »)
  // était ramenée à 0 parce qu'elle passait sous un seuil interne.
  if (entryBest && loose) return loose.score > entryBest.score ? loose : entryBest
  const best = entryBest ?? loose
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
  const pushEntry = (answer: string, source: string, title: string, keywords: string[]) => {
    const parts = passagesOf(answer)
    const group = parts.join(' ')
    const keys = keywords.map((k) => retrievalStems(k)).filter((k) => k.length > 0)
    for (const p of parts) out.push({ text: p, source, title, group, keys })
  }
  // Le TITRE est la question de l'entrée, rien de plus : y coller les mots-clés
  // faisait que « Les bases de la programmation » (mot-clé `programmation`)
  // égalait l'entrée « Quel langage de programmation apprendre ? » sur sa
  // propre question. Les mots-clés restent des déclencheurs, pas des titres.
  for (const entry of NEXUS_KNOWLEDGE) {
    pushEntry(entry.answer, 'banque de connaissances NEXUS', entry.question, entry.keywords)
  }
  // Documentation du projet : mêmes passages interrogeables, mais hors du
  // corpus d'entraînement (voir project-knowledge.ts).
  for (const entry of PROJECT_KNOWLEDGE) {
    pushEntry(entry.answer, 'documentation du projet NEXUS', entry.question, entry.keywords)
  }
  const items = await db.trainingItem
    .findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 500 })
    .catch(() => [])
  for (const it of items ?? []) {
    const parts = passagesOf(String(it.answer ?? ''))
    const group = parts.join(' ')
    for (const p of parts) {
      out.push({ text: p, source: 'apprentissage Dev', title: String(it.question ?? ''), group })
    }
  }
  if (userId) {
    const notes = await db.knowledge.findMany({ where: { userId }, take: 300 }).catch(() => [])
    for (const n of notes ?? []) {
      const title = String(n.title ?? '').slice(0, 40).replace(/^que\s+/i, '')
      const parts = passagesOf(String(n.content ?? '').replace(/^que\s+/i, ''))
      const group = parts.join(' ')
      for (const p of parts) out.push({ text: p, source: `tes notes : ${title}`, title, group })
    }
    // Mémoires longues (prénom, projets, préférences) : c'est ce qui permet au
    // modèle de répondre « comme il te connaît » sans rien inventer.
    const memories = await db.memory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 120 }).catch(() => [])
    for (const m of memories ?? []) {
      const parts = passagesOf(String(m.content ?? '').replace(/^Retenu par l'utilisateur\s*:\s*/i, ''))
      const group = parts.join(' ')
      for (const p of parts) out.push({ text: p, source: 'ta mémoire', group })
    }
  }
  cache = { key, at: Date.now(), passages: out }
  return out
}

export function invalidatePassageCache(): void {
  cache = null
}
