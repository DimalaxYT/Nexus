// ─── NEXUS — Corpus de conversation (format `chat-v1`, tokenizer BPE) ────────
// Ce que le modèle de conversation apprend, et dans quelle forme. Chaque
// exemple est un bloc terminé par le token de fin :
//
//   H: <dernier échange>        (facultatif — mémoire courte de la conversation)
//   C: <contenu retrouvé>       (facultatif — le fond, fourni par le retrieval)
//   Q: <message de l'utilisateur>
//   R: <réponse de NEXUS>
//
// Sources, par ordre d'importance pour une conversation naturelle :
//   1. la banque de dialogue (178 échanges français écrits à la main),
//   2. la banque de connaissances de NEXUS (faits, capacités, fonctionnement),
//   3. les notes / apprentissages / mémoires / conversations de la base.
//
// Le modèle voit chaque échange sous plusieurs formes (avec et sans contexte,
// question canonique / minuscule / reformulée) pour que l'invite réelle — qui
// contient le message exact de l'utilisateur — reste dans la distribution apprise.

import { db } from '@/lib/db'
import { DIALOGUE_BANK, type DialogueEntry } from '@/lib/brain/dialogue-bank'
import { NEXUS_KNOWLEDGE, NEXUS_PRESENTATION } from '@/lib/brain/knowledge-bank'
import { evaluateConversation, loadFilterRules, parseMessages } from '@/lib/conversation-filters'
import { groundedDocsFor, cleanQuestion } from './grounding'
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
  /** Un exemple = un bloc `H:/C:/Q:/R:` (le token de fin est ajouté à l'encodage). */
  examples: string[]
  /** Concaténation des exemples (lexique, statistiques, journal). */
  text: string
  chars: number
  sources: ChatCorpusSources
}

/** Longueurs cibles : un exemple complet doit tenir dans le contexte du modèle
 *  (CHAT_CTX = 352 caractères). */
const ANSWER_MAX = 130
/** Passages conservés par entrée de connaissance (le corpus doit rester dense). */
const MAX_PASSAGES_PER_ENTRY = 3

/**
 * Coupe une réponse sur une FIN DE PHRASE : un modèle qui apprend à rédiger doit
 * voir des phrases complètes, pas des bouts coupés en plein milieu. À défaut de
 * point, on coupe sur un mot.
 */
function clipAnswer(text: string): string {
  const t = cleanForCorpus(text).replace(/\n+/g, ' ').trim()
  if (t.length <= ANSWER_MAX) return t
  const window = t.slice(0, ANSWER_MAX)
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
  if (sentence >= ANSWER_MAX * 0.45) return window.slice(0, sentence + 1)
  const cut = window.lastIndexOf(' ')
  return (cut > ANSWER_MAX * 0.6 ? window.slice(0, cut) : window).replace(/[,;:.\s]+$/, '') + '.'
}

function clipMessage(text: string): string {
  return cleanForCorpus(text).replace(/\n+/g, ' ').trim().slice(0, MESSAGE_MAX)
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
  if (opts.history) lines.push(`H: ${opts.history.slice(0, HISTORY_MAX)}`)
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
  if (lower.startsWith('qu\'est-ce que ')) out.add(lower.replace('qu\'est-ce que ', 'c\'est quoi '))
  if (lower.startsWith('est-ce que ')) out.add(lower.replace('est-ce que ', ''))
  if (lower.startsWith('tu ')) out.add(`est-ce que ${lower}`)
  if (lower.startsWith('pourquoi ')) out.add(`et ${lower}`)
  return [...out].slice(0, 4)
}

/**
 * Exemples d'une entrée de la banque de dialogue — CORPUS DENSE.
 *
 * Pourquoi peu d'exemples par entrée : l'entraînement est limité en temps de
 * calcul (~410 caractères/seconde sur ce serveur). Le nombre d'époques vaut
 * (débit × durée) / taille du corpus : avec 210 ko de corpus on tombait à 6
 * époques et la tâche de copie n'émergeait pas (mesuré : 52 % des caractères
 * attendus dans le top-3, décodage glouton « de de : : le : »). En passant à
 * ~75 ko, on monte à ~20 époques à durée égale.
 *
 * Deux formes par entrée, les deux ANCRÉES (c'est le cas réel en inférence : le
 * retrieval fournit toujours un contenu) :
 *   · question canonique  → réponse,
 *   · question reformulée → même réponse (une entrée sur deux), pour que le
 *     modèle ne dépende pas du libellé exact de la question.
 * Plus la forme avec mémoire courte (`H:`) pour les relances.
 */
function dialogueExamples(entry: DialogueEntry, previous: DialogueEntry | null, index: number): string[] {
  const out: string[] = []
  const answer = clipAnswer(entry.a)
  const variants = questionVariants(entry.q)

  const grounded = example({ context: answer, question: variants[0], answer })
  if (grounded) out.push(grounded)

  if (index % 2 === 1) {
    const alt = variants.find((v) => v !== variants[0])
    if (alt) {
      const varied = example({ context: answer, question: alt, answer })
      if (varied) out.push(varied)
    }
  }

  // Relances : une réponse précédente est en mémoire, la question est courte.
  if (previous && entry.t === 'suivi') {
    const h = `${clipMessage(previous.q).slice(0, 14)} > ${clipAnswer(previous.a).slice(0, 16)}`
    const withHistory = example({ history: h, context: answer, question: entry.q, answer })
    if (withHistory) out.push(withHistory)
  }
  return out
}

/** Construit le corpus de conversation complet. */
export async function buildChatCorpus(opts: { includeDb?: boolean } = {}): Promise<ChatCorpusReport> {
  const includeDb = opts.includeDb !== false
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
  for (let i = 0; i < DIALOGUE_BANK.length; i++) {
    const entry = DIALOGUE_BANK[i]
    const previous = DIALOGUE_BANK[(i + DIALOGUE_BANK.length - 1) % DIALOGUE_BANK.length]
    const made = dialogueExamples(entry, previous, i)
    if (made.length) {
      examples.push(...made)
      sources.dialogue++
    }
  }

  // 2. Banque de connaissances : faits et fonctionnement (format ancré).
  for (const e of NEXUS_KNOWLEDGE) {
    const docs = groundedDocsFor(e.question, e.answer).slice(0, MAX_PASSAGES_PER_ENTRY)
    if (docs.length) {
      examples.push(...docs)
      sources.nexusKnowledge++
    }
  }
  const presentation = groundedDocsFor('Qui es-tu, NEXUS ?', NEXUS_PRESENTATION).slice(0, MAX_PASSAGES_PER_ENTRY)
  if (presentation.length) {
    examples.push(...presentation)
    sources.nexusKnowledge++
  }

  if (includeDb) {
    // 3. Notes de la base de connaissances (tous comptes).
    const notes = await db.knowledge.findMany({ take: 1000 }).catch(() => [])
    for (const n of notes ?? []) {
      const docs = groundedDocsFor(String(n.title ?? ''), String(n.content ?? '')).slice(0, MAX_PASSAGES_PER_ENTRY)
      if (docs.length) {
        examples.push(...docs)
        sources.knowledge++
      }
    }

    // 4. Apprentissages validés de l'entraîneur Dev.
    const items = await db.trainingItem.findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 1000 }).catch(() => [])
    for (const it of items ?? []) {
      const q = cleanQuestion(String(it.question ?? ''))
      const a = clipAnswer(String(it.answer ?? ''))
      const made = example({ context: a.slice(0, CONTEXT_MAX), question: q, answer: a })
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
      const made = example({ context: c.slice(0, CONTEXT_MAX), question: "Qu'est-ce que tu retiens à propos de cela ?", answer: c.slice(0, ANSWER_MAX) })
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
          history: previous ? clipMessage(previous.content).slice(0, 34) : null,
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

  // Séparateur : une ligne vide entre les exemples (le tokenizer caractère n'a
  // pas de token de fin — c'est le saut de ligne qui marque la fin d'une réponse).
  const text = examples.join('\n\n') + '\n\n'
  return { examples, text, chars: text.length, sources }
}
