// ─── NEXUS Brain — Synthèse extractive locale ─────────────────────────────────
// Compose des réponses RICHES à partir des pages réellement lues : découpage
// en phrases, scoring par recouvrement sémantique avec la requête, sélection
// des meilleures, déduplication. Zéro API — de l'extraction intelligente.

import type { SearchResult } from './search'
import { stems } from './text'

export interface PageContent {
  title: string
  url: string
  domain: string
  text: string
}

/** Découpe un texte en phrases propres (40–320 caractères). */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-ÿ«"])|\n+/)
    .map((s) => s.trim().replace(/^[-•*\d.)\s]+/, ''))
    .filter((s) => s.length >= 40 && s.length <= 320)
    .filter((s) => /[a-zà-ÿ]{3}/.test(s)) // ignore les fragments sans lettres
    .filter((s) => !/(cookie|cookies|javascript|abonnez?|subscribe|newsletter|publicité|advertis)/i.test(s))
}

/** Score d'une phrase vs la requête : recouvrement de radicaux + bonus position. */
function scoreSentence(sentence: string, queryStems: Set<string>, position: number): number {
  const words = stems(sentence)
  if (words.length === 0) return 0
  const uniq = new Set(words)
  let hits = 0
  for (const w of uniq) if (queryStems.has(w)) hits++
  // Densité de pertinence + léger bonus pour les phrases précoces (définitions)
  const density = hits / Math.sqrt(uniq.size)
  const positionBonus = Math.max(0, 0.25 - position * 0.01)
  // Bonus si la phrase contient des marqueurs de définition/fait
  const markerBonus = /\b(est|sont|signifie|désigne|permet|consiste|fonctionne|correspond|définition|exemple|conseil|étape|meilleur|résultat)\b/i.test(sentence) ? 0.12 : 0
  return density + positionBonus + markerBonus
}

/** Sélectionne les meilleures phrases d'un contenu vs une requête. */
export function extractKeySentences(content: string, query: string, max: number): string[] {
  const queryStems = new Set(stems(query))
  if (queryStems.size === 0) return []
  const sentences = splitSentences(content)
  const scored = sentences
    .map((s, i) => ({ s, score: scoreSentence(s, queryStems, i) }))
    .filter((r) => r.score > 0.15)
    .sort((a, b) => b.score - a.score)
  // Déduplication par recouvrement de radicaux (évite les redites)
  const kept: string[] = []
  const keptStems: Set<string>[] = []
  for (const { s } of scored) {
    const st = new Set(stems(s))
    const redundant = keptStems.some((prev) => {
      let inter = 0
      for (const w of st) if (prev.has(w)) inter++
      return inter / Math.min(st.size, prev.size) > 0.55
    })
    if (redundant) continue
    kept.push(s)
    keptStems.push(st)
    if (kept.length >= max) break
  }
  return kept
}

/**
 * Synthèse multi-pages : extrait les phrases clés de chaque page lue,
 * les fusionne en une réponse structurée avec attributions [Domaine].
 */
export function synthesizePages(query: string, pages: PageContent[], maxPer = 3, maxTotal = 8): string {
  const queryStems = new Set(stems(query))
  if (pages.length === 0) return ''
  const perPage = pages.map((p) => ({
    page: p,
    sentences: extractKeySentences(p.text, query, maxPer),
  }))
  const useful = perPage.filter((r) => r.sentences.length > 0)
  if (useful.length === 0) return ''

  // Interclassement : alterne entre les pages pour la diversité des sources
  const merged: { sentence: string; domain: string; score: number }[] = []
  const maxLen = Math.max(...useful.map((u) => u.sentences.length))
  for (let i = 0; i < maxLen; i++) {
    for (const u of useful) {
      if (u.sentences[i]) merged.push({ sentence: u.sentences[i], domain: u.page.domain, score: scoreSentence(u.sentences[i], queryStems, i) })
    }
  }
  const top = merged.slice(0, maxTotal)
  const byDomain = new Map<string, string[]>()
  for (const m of top) {
    const arr = byDomain.get(m.domain) ?? []
    arr.push(m.sentence)
    byDomain.set(m.domain, arr)
  }
  const parts = [...byDomain.entries()].map(([domain, sentences]) =>
    sentences.map((s) => `- ${s} *[${domain}]*`).join('\n')
  )
  return parts.join('\n\n')
}

/**
 * Reformule une demande en requête de recherche efficace : retire le bruit
 * conversationnel, ajoute des termes de qualité quand le sujet est flou.
 */
export function buildSearchQuery(topic: string): string {
  const cleaned = topic
    .replace(/^(cherche|recherche|trouve|dis moi|parle moi|explique)( moi)?( sur| sur internet| sur le web)?\s*/i, '')
    .replace(/\?(.*)$/s, '')
    .trim()
  return cleaned.slice(0, 140)
}

/** Identifie si un résultat est pertinent pour la requête (rapide). */
export function resultRelevant(r: SearchResult, query: string): boolean {
  const qStems = new Set(stems(query))
  const hay = stems(`${r.title} ${r.snippet}`)
  if (qStems.size === 0 || hay.length === 0) return true
  let hits = 0
  for (const w of hay) if (qStems.has(w)) hits++
  return hits >= Math.min(2, Math.ceil(qStems.size / 2))
}
