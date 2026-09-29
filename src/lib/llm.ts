// ─── NEXUS — Client LLM opportuniste (circuit-breaker anti-429) ──────────────
// Le SDK apporte l'intelligence quand il est disponible. Quand il est
// limité (429), le disjoncteur coupe IMMÉDIATEMENT (sans attente visible)
// et le cerveau local prend le relais. Jamais d'exception remontée :
// toutes les fonctions retournent null en cas d'indisponibilité.

import ZAI from 'z-ai-web-dev-sdk'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface BreakerState {
  client: Awaited<ReturnType<typeof ZAI.create>> | null
  creating: Promise<Awaited<ReturnType<typeof ZAI.create>>> | null
  consecutiveFailures: number
  blockedUntil: number
  lastError: string
  lastSuccessAt: number
}

const g = globalThis as unknown as { __nexusLlm?: BreakerState }

function state(): BreakerState {
  if (!g.__nexusLlm) {
    g.__nexusLlm = {
      client: null,
      creating: null,
      consecutiveFailures: 0,
      blockedUntil: 0,
      lastError: '',
      lastSuccessAt: 0,
    }
  }
  return g.__nexusLlm
}

// ── Réglages du disjoncteur ───────────────────────────────────────────────────

const FAILURE_THRESHOLD = 2 // 2 échecs consécutifs → coupure
const BLOCK_MS = 4 * 60 * 1000 // coupure 4 minutes (les quotas se libèrent)
const DEFAULT_TIMEOUT_MS = 30_000

export function llmBlockedFor(): number {
  const s = state()
  return Math.max(0, s.blockedUntil - Date.now())
}

export function llmStatus(): { available: boolean; blockedMs: number; lastError: string } {
  const s = state()
  return {
    available: Date.now() >= s.blockedUntil,
    blockedMs: llmBlockedFor(),
    lastError: s.lastError,
  }
}

function noteSuccess(): void {
  const s = state()
  s.consecutiveFailures = 0
  s.lastError = ''
  s.lastSuccessAt = Date.now()
}

function noteFailure(err: unknown): void {
  const s = state()
  s.consecutiveFailures++
  s.lastError = err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200)
  if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
    s.blockedUntil = Date.now() + BLOCK_MS
  }
}

async function getClient(): Promise<Awaited<ReturnType<typeof ZAI.create>> | null> {
  const s = state()
  if (Date.now() < s.blockedUntil) return null
  if (s.client) return s.client
  if (!s.creating) {
    s.creating = ZAI.create()
      .then((c) => {
        s.client = c
        return c
      })
      .catch((err) => {
        noteFailure(err)
        return null
      })
      .finally(() => {
        s.creating = null
      })
  }
  return s.creating
}

/** Promesse avec timeout — annule l'attente sans casser le process. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout ${label} (${ms}ms)`)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

// ── Appel complété (non streamé) ─────────────────────────────────────────────

export interface CompleteOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  thinking?: boolean
}

/** Réponse LLM complète. null = indisponible (429, timeout, réseau…). */
export async function llmComplete(
  messages: LlmMessage[],
  opts: CompleteOptions = {}
): Promise<string | null> {
  const s = state()
  if (Date.now() < s.blockedUntil) return null
  const client = await getClient()
  if (!client) return null
  try {
    const completion = (await withTimeout(
      client.chat.completions.create({
        messages,
        thinking: { type: opts.thinking === false ? 'disabled' : 'enabled' },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }) as Promise<unknown>,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'llmComplete'
    )) as { choices?: { message?: { content?: string } }[] }
    const text = completion.choices?.[0]?.message?.content ?? ''
    if (!text.trim()) {
      noteFailure(new Error('Réponse vide'))
      return null
    }
    noteSuccess()
    return text
  } catch (err) {
    noteFailure(err)
    return null
  }
}

// ── Appel streamé (vrai streaming, token par token) ──────────────────────────

/**
 * Stream la réponse LLM delta par delta. `onDelta` reçoit chaque morceau de
 * texte. Retourne le texte complet, ou null si indisponible. Ne jette jamais.
 */
export async function llmStream(
  messages: LlmMessage[],
  onDelta: (chunk: string) => void,
  opts: CompleteOptions = {}
): Promise<string | null> {
  const s = state()
  if (Date.now() < s.blockedUntil) return null
  const client = await getClient()
  if (!client) return null
  try {
    const body = (await withTimeout(
      client.chat.completions.create({
        messages,
        stream: true,
        thinking: { type: opts.thinking === false ? 'disabled' : 'enabled' },
        ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
      }) as Promise<unknown>,
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      'llmStream(début)'
    )) as ReadableStream<Uint8Array>
    if (!body || typeof body.getReader !== 'function') {
      // Certains environnements renvoient un objet non streamable → repli complet
      const maybe = body as unknown as { choices?: { message?: { content?: string } }[] }
      const text = maybe?.choices?.[0]?.message?.content ?? ''
      if (text.trim()) {
        noteSuccess()
        onDelta(text)
        return text
      }
      noteFailure(new Error('Flux non streamable'))
      return null
    }

    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    let sawContent = false
    // Le timeout de début est passé ; on donne ensuite largement le temps
    // au corps du flux (pas de coupure brutale en pleine génération).
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string }; message?: { content?: string } }[]
          }
          const delta = json.choices?.[0]?.delta?.content ?? json.choices?.[0]?.message?.content ?? ''
          if (delta) {
            sawContent = true
            full += delta
            onDelta(delta)
          }
        } catch {
          /* fragment SSE partiel : ignoré */
        }
      }
    }
    if (!sawContent) {
      noteFailure(new Error('Flux vide'))
      return null
    }
    noteSuccess()
    return full
  } catch (err) {
    noteFailure(err)
    return null
  }
}

/** Extrait le premier objet JSON d'un texte (tolère les fences ```json). */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  // Balance les accolades en respectant les chaînes
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
