// ─── NEXUS — Moteur de synthèse textuelle 100 % local (Zéro API externe) ─────
// NEXUS est une IA entièrement codée de A à Z, sans clé API ni service LLM
// externe. Ce module fournit les utilitaires d'extraction JSON et de synthèse
// locale utilisés par le runner de missions et le pipeline interne.

import { extractKeySentences } from './brain/synthesize'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CompleteOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  thinking?: boolean
}

export function llmBlockedFor(): number {
  return 0
}

export function llmStatus(): {
  available: boolean
  provider: string
  blockedMs: number
  lastError: string
} {
  return {
    available: true,
    provider: 'nexus-local-engine',
    blockedMs: 0,
    lastError: '',
  }
}

export function resetLlmCircuit(): void {
  // No-op : le moteur est 100 % local et toujours disponible
}

/**
 * Synthèse locale autonome pour les rapports de missions lorsqu'un corpus
 * de sources est fourni dans les messages, sinon renvoie `null` pour laisser
 * le cerveau neuronal et analytique local (`brain.ts`) piloter directement.
 */
export async function llmComplete(
  messages: LlmMessage[],
  _opts: CompleteOptions = {}
): Promise<string | null> {
  const userMsg = messages.findLast((m) => m.role === 'user')?.content ?? ''

  // Si c'est une synthèse de rapport de mission (CONTENUS COLLECTÉS présents)
  if (userMsg.includes('CONTENUS COLLECTÉS') && userMsg.includes('Mission :')) {
    return synthesizeMissionReportLocal(userMsg)
  }

  return null
}

/**
 * Le streaming passe directement par le cerveau neuronal & analytique local
 * (`brain.ts` / `deep-reasoner.ts` / `ensemble.ts`).
 */
export async function llmStream(
  _messages: LlmMessage[],
  _onDelta: (chunk: string) => void,
  _opts: CompleteOptions = {}
): Promise<string | null> {
  return null
}

/**
 * Synthétise localement un rapport de mission structuré à partir du corpus collecté.
 */
function synthesizeMissionReportLocal(prompt: string): string | null {
  const missionMatch = prompt.match(/Mission\s*:\s*«\s*([^»]+)\s*»/)
  const topicMatch = prompt.match(/Sujet\s*:\s*([^\n]+)/)
  const missionName = missionMatch?.[1]?.trim() || 'Mission NEXUS'
  const topic = topicMatch?.[1]?.trim() || missionName

  const corpusIdx = prompt.indexOf('CONTENUS COLLECTÉS')
  if (corpusIdx < 0) return null
  const corpus = prompt.slice(corpusIdx)

  // Découpe les blocs [1] (page — domaine) Titre \n Contenu
  const blocks = corpus.split(/\n(?=\[\d+\]\s+\()/).filter((b) => /^\[\d+\]/.test(b.trim()))
  if (blocks.length === 0) return null

  const sources: { idx: string; kind: string; domain: string; title: string; body: string }[] = []
  for (const b of blocks) {
    const m = b.match(/^\[(\d+)\]\s+\(([^—)]+)—\s*([^)]+)\)\s*([^\n]+)\n([\s\S]*)$/)
    if (m) {
      sources.push({
        idx: m[1],
        kind: m[2].trim(),
        domain: m[3].trim(),
        title: m[4].trim(),
        body: m[5].trim(),
      })
    }
  }
  if (sources.length === 0) return null

  const summarySentences: string[] = []
  const keyBullets: string[] = []

  for (const src of sources) {
    const best = extractKeySentences(src.body, topic, 2)
    if (best.length > 0) {
      if (summarySentences.length < 4) {
        summarySentences.push(`${best[0]} **[${src.domain}]**`)
      }
      for (const s of best) {
        if (keyBullets.length < 8) {
          keyBullets.push(`- **${src.title.slice(0, 75)}** : ${s} *[${src.domain}]*`)
        }
      }
    } else if (src.body.length > 40 && keyBullets.length < 8) {
      const clean = src.body.replace(/\s+/g, ' ').slice(0, 220)
      keyBullets.push(`- **${src.title.slice(0, 75)}** : ${clean}… *[${src.domain}]*`)
    }
  }

  const out: string[] = []
  out.push(`## Ce que j'ai compris — ${missionName}`)
  if (summarySentences.length > 0) {
    out.push(summarySentences.join(' '))
  } else {
    out.push(
      `L'analyse croisée des ${sources.length} sources collectées sur **${topic}** met en évidence les éléments factuels détaillés ci-dessous.`
    )
  }

  out.push(`\n## Points clés`)
  if (keyBullets.length > 0) {
    out.push(keyBullets.join('\n'))
  } else {
    out.push(`- ${sources.length} source(s) analysée(s) sur « ${topic} ».`)
  }

  out.push(`\n## Sources consultées`)
  out.push(
    sources
      .map((s) => `- **[${s.domain}]** ${s.title} *(${s.kind})*`)
      .join('\n')
  )

  return out.join('\n\n')
}

/** Extrait le premier objet JSON d'un texte (tolère les fences ```json). */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
