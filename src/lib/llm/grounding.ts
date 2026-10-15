// ─── NEXUS — Réponses ancrées : le modèle s'appuie sur un passage vérifié ────
// Un petit modèle n'a pas assez de paramètres pour retenir des faits. Plutôt que
// de les inventer, il reçoit un passage pertinent (issu de la banque, des
// apprentissages validés ou des notes de l'utilisateur) et rédige sa réponse
// À PARTIR de ce passage. Chaque réponse garde donc sa source, et une réponse
// qui ne reprend pas le passage est refusée.

import { NEXUS_KNOWLEDGE } from '@/lib/brain/knowledge-bank'
import { stems } from '@/lib/brain/text'
import { db } from '@/lib/db'
import { GROUNDED_FORMAT, GROUNDED_CTX } from './model'

export { GROUNDED_FORMAT, GROUNDED_CTX }

/** Longueur maximale d'un passage : assez court pour tenir dans le contexte. */
export const PASSAGE_MAX = 90
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

function queryStems(question: string): Set<string> {
  return new Set(stems(question).filter((s) => s.length > 2))
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

export function bestPassage(question: string, passages: Passage[]): { passage: Passage; score: number } | null {
  let best: { passage: Passage; score: number } | null = null
  for (const p of passages) {
    const score = scorePassage(question, p.text)
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
    for (const p of passagesOf(entry.answer)) out.push({ text: p, source: 'banque de connaissances NEXUS' })
  }
  const items = await db.trainingItem
    .findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 500 })
    .catch(() => [])
  for (const it of items ?? []) {
    for (const p of passagesOf(String(it.answer ?? ''))) out.push({ text: p, source: 'apprentissage Dev' })
  }
  if (userId) {
    const notes = await db.knowledge.findMany({ where: { userId }, take: 300 }).catch(() => [])
    for (const n of notes ?? []) {
      const title = String(n.title ?? '').slice(0, 40)
      for (const p of passagesOf(String(n.content ?? ''))) out.push({ text: p, source: `tes notes : ${title}` })
    }
  }
  cache = { key, at: Date.now(), passages: out }
  return out
}

export function invalidatePassageCache(): void {
  cache = null
}
