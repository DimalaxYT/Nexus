// ─── NEXUS — Corpus d'entraînement du LLM maison ─────────────────────────────
// Le modèle apprend sur :
//   1. la banque de connaissances intégrée de NEXUS (questions / réponses),
//   2. les notes de la base de connaissances (tous comptes),
//   3. les apprentissages validés de l'entraîneur Dev (statut valide / appliqué),
//   4. les mémoires longues,
//   5. les conversations — SAUF celles exclues par les filtres du dashboard Dev.
// Format : blocs « Q: … \nR: … » séparés par une ligne vide, ce qui permet au
// modèle d'apprendre à répondre à une question dans le même style.

import { db } from '@/lib/db'
import { NEXUS_KNOWLEDGE, NEXUS_PRESENTATION } from '@/lib/brain/knowledge-bank'
import { evaluateConversation, loadFilterRules, parseMessages } from '@/lib/conversation-filters'
import { groundedDocsFor } from './grounding'

export interface CorpusSources {
  nexusKnowledge: number
  knowledge: number
  trainingItems: number
  memories: number
  conversations: number
  conversationsExcluded: number
}

export interface CorpusReport {
  text: string
  chars: number
  sources: CorpusSources
}

const MAX_DOC = 1400

/** Nettoyage : pas de blocs de code, pas d'URL, pas de markdown lourd, espaces normalisés. */
export function cleanForCorpus(raw: string): string {
  return String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[`*_#>|]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_DOC)
}

/** Exemples ancrés (passage source + question + réponse) pour une paire question/réponse. */
function qa(question: string, answer: string): string[] {
  const q = cleanForCorpus(question)
  const a = cleanForCorpus(answer)
  if (q.length < 3 || a.length < 3) return []
  return groundedDocsFor(q, a)
}

/** Construit le corpus complet (texte + répartition par source). */
export async function buildCorpus(): Promise<CorpusReport> {
  const docs: string[] = []
  const sources: CorpusSources = {
    nexusKnowledge: 0,
    knowledge: 0,
    trainingItems: 0,
    memories: 0,
    conversations: 0,
    conversationsExcluded: 0,
  }

  // 1. Banque de connaissances intégrée
  for (const e of NEXUS_KNOWLEDGE) {
    const d = qa(e.question, e.answer)
    if (d.length) {
      docs.push(...d)
      sources.nexusKnowledge++
    }
  }
  const presentation = qa('Qui es-tu, NEXUS ?', NEXUS_PRESENTATION)
  if (presentation.length) {
    docs.push(...presentation)
    sources.nexusKnowledge++
  }

  // 2. Notes de la base de connaissances
  const notes = await db.knowledge.findMany({ take: 2000 }).catch(() => [])
  for (const n of notes ?? []) {
    const d = qa(String(n.title ?? ''), String(n.content ?? ''))
    if (d.length) {
      docs.push(...d)
      sources.knowledge++
    }
  }

  // 3. Apprentissages validés de l'entraîneur Dev
  const items = await db.trainingItem.findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 2000 }).catch(() => [])
  for (const it of items ?? []) {
    const d = qa(String(it.question ?? ''), String(it.answer ?? ''))
    if (d.length) {
      docs.push(...d)
      sources.trainingItems++
    }
  }

  // 4. Mémoires longues (phrases utiles, pas de données de session)
  const memories = await db.memory.findMany({ take: 500 }).catch(() => [])
  for (const m of memories ?? []) {
    const c = cleanForCorpus(String(m.content ?? ''))
    if (c.length >= 12) {
      docs.push(...groundedDocsFor("Qu'est-ce que tu retiens à propos de cela ?", c))
      sources.memories++
    }
  }

  // 5. Conversations, hors filtres « exclure »
  const rules = await loadFilterRules().catch(() => [])
  const convs = await db.conversation.findMany({ orderBy: { updatedAt: 'desc' }, take: 1000 }).catch(() => [])
  for (const c of convs ?? []) {
    const conv = { id: String(c.id), userId: c.userId ? String(c.userId) : null, title: String(c.title ?? ''), data: String(c.data ?? '[]') }
    if (rules.length > 0 && evaluateConversation(conv, rules).excluded) {
      sources.conversationsExcluded++
      continue
    }
    const msgs = parseMessages(conv.data)
    let used = false
    for (let i = 0; i < msgs.length - 1; i++) {
      if (msgs[i].role === 'user' && msgs[i + 1].role === 'assistant') {
        const d = qa(msgs[i].content, msgs[i + 1].content)
        if (d.length) {
          docs.push(...d)
          used = true
        }
        i++
      }
    }
    if (used) sources.conversations++
  }

  const text = docs.join('\n\n') + '\n\n'
  return { text, chars: text.length, sources }
}
