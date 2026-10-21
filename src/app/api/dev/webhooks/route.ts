// ─── Espace Dev — Webhooks & confirmations ────────────────────────────────────
// GET  → configuration, journal des livraisons, confirmations en attente,
//        catalogue d'événements et URL publique suggérée.
// POST → { action: 'save' | 'delete' | 'toggle' | 'test' }
//        Les webhooks sont propres au compte Dev (devGuard).

import { devGuard } from '@/lib/auth'
import {
  DEV_EVENTS,
  listApprovals,
  listWebhookLogs,
  listWebhooks,
  resolveBaseUrl,
  saveWebhook,
  deleteWebhook,
  toggleWebhook,
  testWebhook,
} from '@/lib/devwebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    const origin = new URL(req.url).origin
    const [webhooks, logs, approvals, decided] = await Promise.all([
      listWebhooks(guard.userId),
      listWebhookLogs(guard.userId, 30),
      listApprovals(guard.userId, 'pending', 20),
      listApprovals(guard.userId, 'all', 20),
    ])
    return Response.json({
      webhooks,
      logs,
      approvals,
      decided,
      events: DEV_EVENTS,
      suggestedBaseUrl: resolveBaseUrl(origin),
    })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lecture impossible' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')

  try {
    if (action === 'save') {
      const input = (body?.webhook ?? {}) as Record<string, unknown>
      const result = await saveWebhook(guard.userId, {
        id: input.id ? String(input.id) : undefined,
        name: typeof input.name === 'string' ? input.name : undefined,
        url: String(input.url ?? ''),
        format: typeof input.format === 'string' ? input.format : 'auto',
        events: Array.isArray(input.events) ? input.events.map(String) : undefined,
        secret: typeof input.secret === 'string' ? input.secret : undefined,
        clearSecret: input.clearSecret === true,
        baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
        enabled: input.enabled !== false,
      })
      if (!result.ok) return Response.json({ error: result.error ?? 'Enregistrement impossible.' }, { status: 400 })
      return Response.json({ ok: true, webhook: result.webhook })
    }

    if (action === 'delete') {
      const id = String(body?.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      const ok = await deleteWebhook(guard.userId, id)
      if (!ok) return Response.json({ error: 'Webhook introuvable.' }, { status: 404 })
      return Response.json({ ok: true })
    }

    if (action === 'toggle') {
      const id = String(body?.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      const ok = await toggleWebhook(guard.userId, id, body?.enabled !== false)
      if (!ok) return Response.json({ error: 'Webhook introuvable.' }, { status: 404 })
      return Response.json({ ok: true })
    }

    if (action === 'test') {
      const id = String(body?.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      const result = await testWebhook(guard.userId, id)
      return Response.json({ ok: result.ok, result })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Action impossible' }, { status: 500 })
  }
}
