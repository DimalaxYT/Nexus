// ─── NEXUS — Routeur LLM Multi-Fournisseurs (Claude, OpenAI, Groq, Gemini…) ──
// Ordre de priorité automatique :
// 1. Connexion « Moteur IA » enregistrée dans le panneau Connexions (AES-256-GCM)
// 2. Variables d'environnement : ANTHROPIC_API_KEY, OPENROUTER_API_KEY,
//    GROQ_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OLLAMA_BASE_URL
// 3. SDK Z-AI si un fichier .z-ai-config est présent sur la machine
// 4. Si aucun fournisseur externe n'est configuré (ou en cas de 429/timeout),
//    le disjoncteur bascule instantanément sur le Moteur de Raisonnement Local.

import fs from 'fs'
import os from 'os'
import path from 'path'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { decryptSecret } from '@/lib/security'

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

type ProviderKind = 'anthropic' | 'openai-compat' | 'zai'

interface ResolvedProvider {
  kind: ProviderKind
  label: string
  apiKey: string
  baseUrl: string
  model: string
}

interface BreakerState {
  client: Awaited<ReturnType<typeof ZAI.create>> | null
  creating: Promise<Awaited<ReturnType<typeof ZAI.create>> | null> | null
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

const FAILURE_THRESHOLD = 2
const BLOCK_MS = 3 * 60 * 1000
const DEFAULT_TIMEOUT_MS = 35_000

export function resetLlmCircuit(): void {
  const s = state()
  s.consecutiveFailures = 0
  s.blockedUntil = 0
  s.lastError = ''
}

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

function hasZaiConfigFile(): boolean {
  const candidates = [
    path.join(process.cwd(), '.z-ai-config'),
    path.join(os.homedir(), '.z-ai-config'),
    '/etc/.z-ai-config',
  ]
  return candidates.some((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
}

function providerFromKeyAndHint(apiKey: string, handleHint = ''): ResolvedProvider {
  const key = apiKey.trim()
  const modelPart = handleHint.includes(':') ? handleHint.split(':').slice(1).join(':').trim() : handleHint.trim()

  if (key.startsWith('sk-ant-') || handleHint.startsWith('anthropic:')) {
    return {
      kind: 'anthropic',
      label: 'Anthropic Claude',
      apiKey: key,
      baseUrl: 'https://api.anthropic.com/v1',
      model: modelPart || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    }
  }
  if (key.startsWith('gsk_') || handleHint.startsWith('groq:')) {
    return {
      kind: 'openai-compat',
      label: 'Groq',
      apiKey: key,
      baseUrl: 'https://api.groq.com/openai/v1',
      model: modelPart || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    }
  }
  if (key.startsWith('sk-or-') || handleHint.startsWith('openrouter:')) {
    return {
      kind: 'openai-compat',
      label: 'OpenRouter',
      apiKey: key,
      baseUrl: 'https://openrouter.ai/api/v1',
      model: modelPart || process.env.OPENROUTER_MODEL || 'anthropic/claude-3.7-sonnet',
    }
  }
  if (key.startsWith('AIza') || handleHint.startsWith('gemini:')) {
    return {
      kind: 'openai-compat',
      label: 'Google Gemini',
      apiKey: key,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: modelPart || process.env.GEMINI_MODEL || 'gemini-2.5-pro',
    }
  }
  return {
    kind: 'openai-compat',
    label: 'OpenAI',
    apiKey: key,
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: modelPart || process.env.OPENAI_MODEL || 'gpt-4o',
  }
}

async function resolveActiveProvider(): Promise<ResolvedProvider | null> {
  // 1) Connexion configurée dans l'interface (table AccountConnection, provider='ai')
  try {
    const row = await db.accountConnection.findFirst({ where: { provider: 'ai', status: 'connected' } })
    if (row && row.secret) {
      const secret = decryptSecret(row.secret)
      if (secret) return providerFromKeyAndHint(secret, row.handle)
    }
  } catch {
    /* ignore */
  }

  // 2) Variables d'environnement
  if (process.env.ANTHROPIC_API_KEY?.trim()) {
    return providerFromKeyAndHint(process.env.ANTHROPIC_API_KEY.trim(), `anthropic:${process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5'}`)
  }
  if (process.env.OPENROUTER_API_KEY?.trim()) {
    return providerFromKeyAndHint(process.env.OPENROUTER_API_KEY.trim(), `openrouter:${process.env.OPENROUTER_MODEL || 'anthropic/claude-3.7-sonnet'}`)
  }
  if (process.env.GROQ_API_KEY?.trim()) {
    return providerFromKeyAndHint(process.env.GROQ_API_KEY.trim(), `groq:${process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'}`)
  }
  if (process.env.OPENAI_API_KEY?.trim()) {
    return providerFromKeyAndHint(process.env.OPENAI_API_KEY.trim(), `openai:${process.env.OPENAI_MODEL || 'gpt-4o'}`)
  }
  if (process.env.GEMINI_API_KEY?.trim()) {
    return providerFromKeyAndHint(process.env.GEMINI_API_KEY.trim(), `gemini:${process.env.GEMINI_MODEL || 'gemini-2.5-pro'}`)
  }
  if (process.env.OLLAMA_BASE_URL?.trim()) {
    return {
      kind: 'openai-compat',
      label: 'Ollama Local',
      apiKey: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL.trim().replace(/\/$/, ''),
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:14b',
    }
  }

  // 3) SDK Z-AI uniquement si le fichier .z-ai-config existe réellement
  if (hasZaiConfigFile()) {
    return { kind: 'zai', label: 'Z-AI SDK', apiKey: '', baseUrl: '', model: '' }
  }

  return null
}

async function getZaiClient(): Promise<Awaited<ReturnType<typeof ZAI.create>> | null> {
  const s = state()
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

// ── Anthropic Claude (/v1/messages) ──────────────────────────────────────────

function splitSystemMessages(messages: LlmMessage[]): { system: string; chat: { role: 'user' | 'assistant'; content: string }[] } {
  const sysParts: string[] = []
  const chat: { role: 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    if (m.role === 'system') sysParts.push(m.content)
    else if (m.content.trim()) chat.push({ role: m.role, content: m.content })
  }
  if (chat.length === 0 || chat[0].role !== 'user') {
    chat.unshift({ role: 'user', content: 'Bonjour' })
  }
  return { system: sysParts.join('\n\n'), chat }
}

async function anthropicComplete(provider: ResolvedProvider, messages: LlmMessage[], opts: CompleteOptions): Promise<string | null> {
  const { system, chat } = splitSystemMessages(messages)
  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      ...(system ? { system } : {}),
      messages: chat,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}`)
  const data = (await res.json()) as { content?: { type?: string; text?: string }[] }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
  return text.trim() ? text : null
}

async function anthropicStream(
  provider: ResolvedProvider,
  messages: LlmMessage[],
  onDelta: (chunk: string) => void,
  opts: CompleteOptions
): Promise<string | null> {
  const { system, chat } = splitSystemMessages(messages)
  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.4,
      stream: true,
      ...(system ? { system } : {}),
      messages: chat,
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok || !res.body) throw new Error(`Anthropic stream ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
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
        const evt = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } }
        if (evt.type === 'content_block_delta' && evt.delta?.text) {
          full += evt.delta.text
          onDelta(evt.delta.text)
        }
      } catch {
        /* fragment SSE partiel */
      }
    }
  }
  return full.trim() ? full : null
}

// ── OpenAI / Groq / OpenRouter / Gemini / Ollama (/chat/completions) ─────────

async function openAiCompatComplete(provider: ResolvedProvider, messages: LlmMessage[], opts: CompleteOptions): Promise<string | null> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${provider.label} ${res.status}`)
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content ?? ''
  return text.trim() ? text : null
}

async function openAiCompatStream(
  provider: ResolvedProvider,
  messages: LlmMessage[],
  onDelta: (chunk: string) => void,
  opts: CompleteOptions
): Promise<string | null> {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  })
  if (!res.ok || !res.body) throw new Error(`${provider.label} stream ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''
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
          full += delta
          onDelta(delta)
        }
      } catch {
        /* fragment partiel */
      }
    }
  }
  return full.trim() ? full : null
}

// ── API publique ─────────────────────────────────────────────────────────────

export async function llmComplete(
  messages: LlmMessage[],
  opts: CompleteOptions = {}
): Promise<string | null> {
  const s = state()
  if (Date.now() < s.blockedUntil) return null

  const provider = await resolveActiveProvider()
  if (!provider) return null

  try {
    let text: string | null = null
    if (provider.kind === 'anthropic') {
      text = await anthropicComplete(provider, messages, opts)
    } else if (provider.kind === 'openai-compat') {
      text = await openAiCompatComplete(provider, messages, opts)
    } else {
      const client = await getZaiClient()
      if (!client) return null
      const completion = (await withTimeout(
        client.chat.completions.create({
          messages,
          thinking: { type: opts.thinking === false ? 'disabled' : 'enabled' },
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        }) as Promise<unknown>,
        opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        'llmComplete'
      )) as { choices?: { message?: { content?: string } }[] }
      text = completion.choices?.[0]?.message?.content ?? ''
    }
    if (!text || !text.trim()) {
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

export async function llmStream(
  messages: LlmMessage[],
  onDelta: (chunk: string) => void,
  opts: CompleteOptions = {}
): Promise<string | null> {
  const s = state()
  if (Date.now() < s.blockedUntil) return null

  const provider = await resolveActiveProvider()
  if (!provider) return null

  try {
    let text: string | null = null
    if (provider.kind === 'anthropic') {
      text = await anthropicStream(provider, messages, onDelta, opts)
    } else if (provider.kind === 'openai-compat') {
      text = await openAiCompatStream(provider, messages, onDelta, opts)
    } else {
      const client = await getZaiClient()
      if (!client) return null
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
        const maybe = body as unknown as { choices?: { message?: { content?: string } }[] }
        const fallbackText = maybe?.choices?.[0]?.message?.content ?? ''
        if (fallbackText.trim()) {
          noteSuccess()
          onDelta(fallbackText)
          return fallbackText
        }
        noteFailure(new Error('Flux non streamable'))
        return null
      }
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let full = ''
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
              full += delta
              onDelta(delta)
            }
          } catch {
            /* fragment partiel */
          }
        }
      }
      text = full
    }
    if (!text || !text.trim()) {
      noteFailure(new Error('Flux vide'))
      return null
    }
    noteSuccess()
    return text
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
