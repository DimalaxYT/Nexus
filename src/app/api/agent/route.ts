// ─── NEXUS Agent — Route SSE 100 % locale ─────────────────────────────────────
// Le cerveau (src/lib/brain) fait TOUT le travail : classification neuronale,
// compétences locales, synthèse des réponses. AUCUN appel API/LLM externe.
// Les événements SSE restent identiques (contrat v1) → le client est inchangé.

import { NextRequest } from 'next/server'
import { processTurn } from '@/lib/brain/brain'
import type { AgentEvent, ChatTarget, CodeFiles } from '@/lib/nexus-types'

export const runtime = 'nodejs'
export const maxDuration = 300

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Valide la cible de discussion envoyée par le sélecteur du chat. */
function parseTarget(raw: unknown): ChatTarget {
  if (!raw || typeof raw !== 'object') return { kind: 'nexus' }
  const t = raw as { kind?: unknown; agentId?: unknown; groupId?: unknown }
  if (t.kind === 'agent' && typeof t.agentId === 'string' && t.agentId.trim()) {
    return { kind: 'agent', agentId: t.agentId.trim() }
  }
  if (t.kind === 'group' && typeof t.groupId === 'string' && t.groupId.trim()) {
    return { kind: 'group', groupId: t.groupId.trim() }
  }
  if (t.kind === 'all') return { kind: 'all' }
  // Bureau : délibération de l'équipe (ou d'un groupe) + réponse unique de NEXUS
  if (t.kind === 'bureau') {
    return typeof t.groupId === 'string' && t.groupId.trim()
      ? { kind: 'bureau', groupId: t.groupId.trim() }
      : { kind: 'bureau' }
  }
  return { kind: 'nexus' }
}

/** Valide le code actuel du Studio Code envoyé par le client (mode PROPOSITION). */
function parseCurrentCode(raw: unknown): CodeFiles | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as { html?: unknown; css?: unknown; js?: unknown; language?: unknown; filename?: unknown }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  const html = str(c.html, 30_000)
  const css = str(c.css, 30_000)
  const js = str(c.js, 60_000)
  if (!html.trim() && !css.trim() && !js.trim()) return undefined
  return {
    html,
    css,
    js,
    ...(typeof c.language === 'string' ? { language: c.language.slice(0, 20) } : {}),
    ...(typeof c.filename === 'string' ? { filename: c.filename.slice(0, 80) } : {}),
  }
}

// ── Garde-fous SSE (identiques aux versions précédentes) ───────────────────────
// Le gateway ne renvoie les headers HTTP qu'au premier octet du corps : un ping
// immédiat + un heartbeat maintiennent la connexion pendant les phases
// légèrement plus longues (recherche web, capture d'écran).

const HEARTBEAT_MS = 12_000

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const history: ApiMessage[] = Array.isArray(body?.messages)
    ? (body.messages as ApiMessage[]).filter(
        (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
    : []

  if (history.length === 0) {
    return Response.json({ error: 'Messages requis' }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      let heartbeat: ReturnType<typeof setInterval> | null = null

      const send = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }
      const close = () => {
        if (heartbeat) {
          clearInterval(heartbeat)
          heartbeat = null
        }
        if (!closed) {
          closed = true
          try {
            controller.close()
          } catch {
            /* déjà fermé */
          }
        }
      }

      // Ping immédiat : les headers partent tout de suite (anti-502)
      send({ type: 'ping' })
      heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch {
            closed = true
          }
        }
      }, HEARTBEAT_MS)

      try {
        await processTurn({ messages: history, target: parseTarget(body?.target), currentCode: parseCurrentCode(body?.currentCode) }, send)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue'
        send({ type: 'error', message: `Un imprévu est survenu : ${message}. Réessaie — mes compétences de repli prennent le relais automatiquement.` })
      } finally {
        close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
