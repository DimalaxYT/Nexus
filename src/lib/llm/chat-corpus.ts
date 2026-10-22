// ─── NEXUS — Corpus de conversation (format `chat-v1`, tokenizer caractère) ──
// Ce que le modèle de conversation apprend, et dans quelle forme. Chaque
// exemple est un bloc :
//
//   H: <dernier échange>        (facultatif — mémoire courte de la conversation)
//   Q: <message de l'utilisateur>
//   C: <contenu retrouvé>       (facultatif — le fond, fourni par le retrieval)
//   R: <réponse de NEXUS>
//
// Le contenu est placé JUSTE AVANT la réponse : la tâche apprise est une copie
// à courte portée (« lis C:, réponds avec ce qu'il contient »), la seule que
// puisse vraiment réussir un modèle de cette taille. `Q:` reste devant pour que
// le modèle apprenne aussi à répondre sans contenu (petite conversation).
//
// Sources, par ordre d'importance pour une conversation naturelle :
//   1. la banque de dialogue (186 échanges français écrits à la main),
//   2. la banque de connaissances de NEXUS (faits, capacités, fonctionnement),
//   3. les notes / apprentissages / mémoires / conversations de la base.
//
// v2 (2026-10) : corpus densifié. Chaque entrée de dialogue est vue sous
// plusieurs formes (ancrée, libre, avec mémoire), chaque réponse de
// connaissance est découpée en phrases entières (et non plus tronquée à
// 130 caractères), et les questions sont reformulées. Objectif mesuré :
// ~400 k caractères au lieu de 84 k, pour un modèle de ~900 k paramètres.

import { db } from '@/lib/db'
import { DIALOGUE_BANK, type DialogueEntry } from '@/lib/brain/dialogue-bank'
import { NEXUS_KNOWLEDGE, NEXUS_PRESENTATION } from '@/lib/brain/knowledge-bank'
import { evaluateConversation, loadFilterRules, parseMessages } from '@/lib/conversation-filters'
import { cleanForCorpus } from './corpus'
import { CONTEXT_MAX, MESSAGE_MAX, HISTORY_MAX, type ChatTurn } from './dialogue'

export interface ChatCorpusSources {
  dialogue: number
  nexusKnowledge: number
  knowledge: number
  trainingItems: number
  memories: number
  conversations: number
  conversationsExcluded: number
}

export interface ChatCorpusReport {
  /** Un exemple = un bloc `H:/Q:/C:/R:` (les exemples sont séparés par une ligne vide). */
  examples: string[]
  /** Concaténation des exemples (lexique, statistiques, journal). */
  text: string
  chars: number
  sources: ChatCorpusSources
}

/** Longueur maximale d'une réponse apprise (doit tenir dans `CHAT_CTX`). */
export const ANSWER_MAX = 220
/** Passages conservés par entrée de connaissance (le corpus doit rester dense). */
const MAX_PASSAGES_PER_ENTRY = 8
/** Nombre de reformulations de question par entrée (au-delà, le corpus gonfle). */
const MAX_QUESTIONS_PER_ENTRY = 3

/**
 * Coupe une réponse sur une FIN DE PHRASE : un modèle qui apprend à rédiger doit
 * voir des phrases complètes, pas des bouts coupés en plein milieu. À défaut de
 * point, on coupe sur un mot.
 */
function clipAnswer(text: string, max = ANSWER_MAX): string {
  const t = cleanForCorpus(text).replace(/\n+/g, ' ').trim()
  if (t.length <= max) return t
  const window = t.slice(0, max)
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
  if (sentence >= max * 0.45) return window.slice(0, sentence + 1)
  const cut = window.lastIndexOf(' ')
  return (cut > max * 0.6 ? window.slice(0, cut) : window).replace(/[,;:.\s]+$/, '') + '.'
}

function clipMessage(text: string): string {
  return cleanForCorpus(text).replace(/\n+/g, ' ').trim().slice(0, MESSAGE_MAX)
}

/** Coupe sur un mot (jamais au milieu) — utilisé pour la ligne `H:`. */
function clipWords(text: string, max: number): string {
  const t = clipMessage(text)
  if (t.length <= max) return t
  const cut = t.lastIndexOf(' ', max)
  return t.slice(0, cut > max * 0.5 ? cut : max).replace(/[,;:.\s]+$/, '')
}

/**
 * Découpe un texte long en passages de phrases ENTIÈRES (≤ `max` caractères).
 * C'est ce qui permet d'utiliser les réponses de 600–1 100 caractères de la
 * banque de connaissances sans les mutiler : le modèle voit une ou deux
 * phrases complètes, pas un fragment qui s'arrête au milieu d'un mot.
 */
export function longPassages(text: string, max = ANSWER_MAX): string[] {
  const clean = cleanForCorpus(text).replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean)
  const out: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const s = sentence.trim()
    if (!s) continue
    if (s.length > max) {
      if (current) {
        out.push(current)
        current = ''
      }
      out.push(clipAnswer(s, max))
      continue
    }
    if (!current) {
      current = s
    } else if (current.length + 1 + s.length <= max) {
      current += ` ${s}`
    } else {
      out.push(current)
      current = s
    }
  }
  if (current) out.push(current)
  return [...new Set(out.filter((p) => p.length >= 20))]
}

/** Bloc au format appris (mêmes longueurs qu'à l'inférence). */
function example(opts: { history?: string | null; context?: string | null; question: string; answer: string }): string | null {
  const q = clipMessage(opts.question)
  const a = clipAnswer(opts.answer)
  if (q.length < 2 || a.length < 6) return null
  // Ordre H, Q, C, R — le contenu est placé JUSTE AVANT la réponse. Voir le
  // commentaire de `CHAT_FORMAT` dans model.ts : la distance de copie est le
  // facteur décisif pour un modèle de cette taille.
  const lines: string[] = []
  if (opts.history) lines.push(`H: ${cleanForCorpus(opts.history).replace(/\n+/g, ' ').trim().slice(0, HISTORY_MAX)}`)
  lines.push(`Q: ${q}`)
  if (opts.context) lines.push(`C: ${cleanForCorpus(opts.context).replace(/\n+/g, ' ').trim().slice(0, CONTEXT_MAX)}`)
  lines.push(`R: ${a}`)
  return lines.join('\n')
}

/** Variantes de la question : l'utilisateur réel n'écrit jamais exactement la forme canonique. */
function questionVariants(q: string): string[] {
  const out = new Set<string>()
  const base = q.trim()
  out.add(base)
  const lower = base.toLowerCase()
  out.add(lower)
  const noPunct = lower.replace(/[?.!]+$/, '')
  if (noPunct.length > 3) out.add(noPunct)
  if (lower.startsWith('comment ')) out.add(lower.replace('comment ', 'comment est-ce que '))
  if (lower.startsWith("qu'est-ce que ")) out.add(lower.replace("qu'est-ce que ", "c'est quoi "))
  if (lower.startsWith('est-ce que ')) out.add(lower.replace('est-ce que ', ''))
  if (lower.startsWith('tu ')) out.add(`est-ce que ${lower}`)
  if (lower.startsWith('pourquoi ')) out.add(`et ${lower}`)
  // Reformulations de politesse : « tu peux me dire … » est une tournure très
  // fréquente en conversation réelle et n'était jamais vue à l'entraînement.
  if (noPunct.length <= MESSAGE_MAX - 22 && !/^(bonjour|bonsoir|salut|coucou|hey|merci|au revoir)\b/i.test(lower)) {
    out.add(`tu peux me dire : ${noPunct} ?`)
    out.add(`dis-moi : ${noPunct} ?`)
  }
  // Sans accent : beaucoup d'utilisateurs tapent vite. Le retrieval normalise
  // déjà les accents ; le modèle doit pouvoir lire ces messages aussi.
  const plain = noPunct.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (plain !== noPunct && plain.length > 3) out.add(plain)
  return [...out].slice(0, 7)
}

/**
 * Exemples d'une entrée de la banque de dialogue — CORPUS DENSE.
 *
 * Trois formes par entrée :
 *   · ANCRÉE (Q + C = réponse + R) : le cas réel en inférence, où le retrieval
 *     fournit toujours un contenu ; c'est la tâche de copie courte portée,
 *   · LIBRE (Q + R) : répondre sans contenu — indispensable pour que le modèle
 *     sache saluer ou relancer sans dépendre d'un passage,
 *   · AVEC MÉMOIRE (`H:`) pour les relances et un échantillon d'entrées.
 * Plus une ou deux reformulations de la question, pour ne pas dépendre du
 * libellé exact.
 */
function dialogueExamples(
  entry: DialogueEntry,
  previous: DialogueEntry | null,
  index: number,
  opts: { contextMode: 'copy' | 'generate'; partner: DialogueEntry | null }
): string[] {
  const out: string[] = []
  const answer = clipAnswer(entry.a)
  const variants = questionVariants(entry.q)
  // MODE COPIE (corpus v2) : C = la réponse → le modèle apprend à recopier.
  // MODE GÉNÉRATION (corpus v3) : C = la réponse d'une AUTRE entrée du même
  // thème → impossible de recopier, le modèle doit produire la sienne. C'est la
  // situation réelle du retrieval, qui ne renvoie pas toujours le texte exact.
  const context = opts.contextMode === 'copy' ? answer : clipAnswer(opts.partner?.a ?? '') || null

  // 1. Formes ancrées : la question canonique, puis jusqu'à deux reformulations.
  const grounded = example({ context, question: variants[0], answer })
  if (grounded) out.push(grounded)
  for (const alt of variants.slice(1, MAX_QUESTIONS_PER_ENTRY)) {
    const made = example({ context, question: alt, answer })
    if (made) out.push(made)
  }

  // 2. Forme libre : une entrée sur deux (l'autre moitié garde le corpus dense).
  if (index % 2 === 0) {
    const free = example({ question: entry.q, answer })
    if (free) out.push(free)
  }

  // 3. Mémoire courte : une réponse précédente puis une relance.
  if (previous && (entry.t === 'suivi' || index % 5 === 0)) {
    const h = `${clipWords(previous.q, 34)} > ${clipWords(clipAnswer(previous.a), 46)}`
    const withHistory = example({ history: h, context, question: entry.q, answer })
    if (withHistory) out.push(withHistory)
  }
  return out
}

/** Exemples ancrés d'une réponse de connaissance (découpée en phrases entières). */
function knowledgeExamples(question: string, answer: string, contextMode: 'copy' | 'generate' = 'copy'): string[] {
  const passages = longPassages(answer)
  const variants = questionVariants(question)
  const out: string[] = []
  for (let i = 0; i < passages.length && i < MAX_PASSAGES_PER_ENTRY; i++) {
    const passage = passages[i]
    // Le contenu fourni peut contenir le passage ET le suivant (≤ CONTEXT_MAX) :
    // le modèle apprend à choisir la bonne phrase dans un contexte plus large.
    const next = passages[i + 1] && passage.length + 1 + passages[i + 1].length <= CONTEXT_MAX ? passages[i + 1] : null
    const context = next ? `${passage} ${next}` : passage
    const q = variants[i % Math.min(variants.length, MAX_QUESTIONS_PER_ENTRY)]
    // Mode génération : la documentation n'est PAS recopiée, la réponse vient
    // des poids du modèle (la forme libre enseigne exactement cela).
    const made = example({ context: contextMode === 'copy' ? context : null, question: q, answer: passage })
    if (made) out.push(made)
  }
  // Une forme libre par entrée : la première phrase, sans contenu.
  if (passages[0]) {
    const free = example({ question: question, answer: passages[0] })
    if (free) out.push(free)
  }
  return out
}

/** Construit le corpus de conversation complet. */
export async function buildChatCorpus(
  opts: { includeDb?: boolean; contextMode?: 'copy' | 'generate' } = {}
): Promise<ChatCorpusReport> {
  const includeDb = opts.includeDb !== false
  const contextMode = opts.contextMode ?? 'generate'
  const examples: string[] = []
  const sources: ChatCorpusSources = {
    dialogue: 0,
    nexusKnowledge: 0,
    knowledge: 0,
    trainingItems: 0,
    memories: 0,
    conversations: 0,
    conversationsExcluded: 0,
  }

  // 1. Banque de dialogue — le cœur conversationnel.
  // Partenaire de contexte : l'entrée SUIVANTE du même thème (jamais la même).
  const partnerOf = (entry: DialogueEntry): DialogueEntry | null => {
    const same = DIALOGUE_BANK.filter((e) => e.t === entry.t && e !== entry)
    if (!same.length) return null
    const at = DIALOGUE_BANK.indexOf(entry)
    return same[at % same.length]
  }
  for (let i = 0; i < DIALOGUE_BANK.length; i++) {
    const entry = DIALOGUE_BANK[i]
    const previous = DIALOGUE_BANK[(DIALOGUE_BANK.length + i - 1) % DIALOGUE_BANK.length]
    const made = dialogueExamples(entry, previous, i, { contextMode, partner: partnerOf(entry) })
    if (made.length) {
      examples.push(...made)
      sources.dialogue++
    }
  }

  // 2. Banque de connaissances : faits et fonctionnement (format ancré).
  for (const e of NEXUS_KNOWLEDGE) {
    const docs = knowledgeExamples(e.question, e.answer, contextMode)
    if (docs.length) {
      examples.push(...docs)
      sources.nexusKnowledge++
    }
  }
  const presentation = knowledgeExamples('Qui es-tu, NEXUS ?', NEXUS_PRESENTATION)
  if (presentation.length) {
    examples.push(...presentation)
    sources.nexusKnowledge++
  }

  if (includeDb) {
    // 3. Notes de la base de connaissances (tous comptes).
    const notes = await db.knowledge.findMany({ take: 1000 }).catch(() => [])
    for (const n of notes ?? []) {
      const docs = knowledgeExamples(String(n.title ?? ''), String(n.content ?? ''))
      if (docs.length) {
        examples.push(...docs)
        sources.knowledge++
      }
    }

    // 4. Apprentissages validés de l'entraîneur Dev.
    const items = await db.trainingItem.findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 1000 }).catch(() => [])
    for (const it of items ?? []) {
      const q = clipMessage(String(it.question ?? ''))
      const a = clipAnswer(String(it.answer ?? ''))
      const made = contextMode === 'copy' ? example({ context: a.slice(0, CONTEXT_MAX), question: q, answer: a }) : null
      const free = example({ question: q, answer: a })
      if (made) examples.push(made)
      if (free) examples.push(free)
      if (made || free) sources.trainingItems++
    }

    // 5. Mémoires longues.
    const memories = await db.memory.findMany({ take: 400 }).catch(() => [])
    for (const m of memories ?? []) {
      const c = cleanForCorpus(String(m.content ?? '')).replace(/\n+/g, ' ')
      if (c.length < 12) continue
      const made = contextMode === 'copy' ? example({ context: c.slice(0, CONTEXT_MAX), question: "Qu'est-ce que tu retiens à propos de cela ?", answer: c.slice(0, ANSWER_MAX) }) : null
      if (made) {
        examples.push(made)
        sources.memories++
      }
    }

    // 6. Conversations réelles (hors filtres « exclure ») : échanges à deux tours.
    const rules = await loadFilterRules().catch(() => [])
    const convs = await db.conversation.findMany({ orderBy: { updatedAt: 'desc' }, take: 500 }).catch(() => [])
    for (const c of convs ?? []) {
      const conv = { id: String(c.id), userId: c.userId ? String(c.userId) : null, title: String(c.title ?? ''), data: String(c.data ?? '[]') }
      if (rules.length > 0 && evaluateConversation(conv, rules).excluded) {
        sources.conversationsExcluded++
        continue
      }
      const msgs = parseMessages(conv.data)
      let used = false
      for (let i = 0; i < msgs.length - 1; i++) {
        if (msgs[i].role !== 'user' || msgs[i + 1].role !== 'assistant') continue
        const previous: ChatTurn | null = i >= 1 ? { role: msgs[i - 1].role === 'assistant' ? 'assistant' : 'user', content: msgs[i - 1].content } : null
        const made = example({
          history: previous ? clipWords(previous.content, HISTORY_MAX) : null,
          question: msgs[i].content,
          answer: msgs[i + 1].content,
        })
        if (made) {
          examples.push(made)
          used = true
        }
        i++
      }
      if (used) sources.conversations++
    }
  }

  // Déduplication : les variantes de politesse de deux entrées proches peuvent
  // produire le même bloc. Un doublon exact n'apprend rien de plus et biaise les
  // statistiques du corpus.
  const unique = [...new Set(examples)]

  // Séparateur : une ligne vide entre les exemples (le tokenizer caractère n'a
  // pas de token de fin — c'est le saut de ligne qui marque la fin d'une réponse).
  const text = unique.join('\n\n') + '\n\n'
  return { examples: unique, text, chars: text.length, sources }
}
