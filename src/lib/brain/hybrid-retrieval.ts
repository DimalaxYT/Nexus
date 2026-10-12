// ─── NEXUS Brain — Récupération locale hybride (lexicale + neurale) ─────────
// Réordonne les notes sans service distant : recouvrement de radicaux +
// similarité cosinus du vectoriseur local (radicaux et n-grammes).

import { overlap } from './classifier'
import { semanticSimilarity } from './neural'

export interface LocalKnowledgeDocument {
  id: string
  title: string
  content: string
  category: string
  tags: string
}

export interface RankedLocalKnowledge<T extends LocalKnowledgeDocument> {
  document: T
  score: number
}

/** Classe les notes par correspondance hybride et écarte les faux positifs faibles. */
export function rankLocalKnowledge<T extends LocalKnowledgeDocument>(
  query: string,
  documents: T[],
  max = 4
): RankedLocalKnowledge<T>[] {
  const cleanQuery = query.trim()
  if (!cleanQuery || documents.length === 0 || max <= 0) return []

  return documents
    .map((document) => {
      const heading = `${document.title} ${document.category} ${document.tags}`
      const lexicalTitle = overlap(cleanQuery, heading)
      const lexicalBody = overlap(cleanQuery, document.content.slice(0, 3_000))
      const lexical = Math.max(lexicalTitle * 0.72 + lexicalBody * 0.28, 0)
      const semantic = semanticSimilarity(
        cleanQuery,
        `${heading} ${document.content.slice(0, 1_500)}`
      )
      const score = lexical * 0.72 + semantic * 0.28
      return { document, lexical, semantic, score }
    })
    .filter(({ lexical, semantic, score }) => (lexical > 0 ? score >= 0.16 : semantic >= 0.38 && score >= 0.1))
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ document, score }) => ({ document, score }))
}
