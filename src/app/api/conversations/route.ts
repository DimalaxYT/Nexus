import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ownerGuard } from '@/lib/auth'
import type { ChatMessage } from '@/lib/nexus-types'

export const runtime = 'nodejs'

const MAX_CONVERSATIONS = 200

/** Nettoie les messages avant stockage : retire les dataUrl d'images (registre thumbnails côté client). */
function sanitizeMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return []
  const out: ChatMessage[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const msg = m as Partial<ChatMessage>
    if ((msg.role !== 'user' && msg.role !== 'assistant') || typeof msg.content !== 'string') continue
    out.push({
      id: String(msg.id ?? Math.random().toString(36).slice(2)),
      role: msg.role,
      content: msg.content.slice(0, 20000),
      steps: Array.isArray(msg.steps) ? msg.steps.slice(0, 12) : [],
      sources: Array.isArray(msg.sources) ? msg.sources.slice(0, 20) : [],
      images: Array.isArray(msg.images)
        ? msg.images.slice(0, 12).map((img) => ({
            id: String(img?.id ?? ''),
            dataUrl: '', // jamais de base64 en base : résolu via le registre client
            prompt: String(img?.prompt ?? '').slice(0, 300),
          }))
        : [],
      scene: (msg.scene as ChatMessage['scene']) ?? null,
      code: (msg.code as ChatMessage['code']) ?? null,
      videos: Array.isArray(msg.videos)
        ? msg.videos.slice(0, 6).map((v) => ({
            id: String(v?.id ?? ''),
            url: String(v?.url ?? '').slice(0, 600),
            prompt: String(v?.prompt ?? '').slice(0, 300),
          }))
        : [],
      thought: typeof msg.thought === 'string' ? msg.thought.slice(0, 600) : '',
      expiredImages: Boolean(msg.expiredImages),
      createdAt: Number(msg.createdAt) || Date.now(),
    })
  }
  return out
}

/** Ligne en base → conversation complète renvoyée au client. */
function toConversation(conv: any) {
  let messages: ChatMessage[] = []
  try {
    messages = sanitizeMessages(JSON.parse(conv.data))
  } catch {
    messages = []
  }
  return { id: conv.id, title: conv.title, messages, createdAt: conv.createdAt, updatedAt: conv.updatedAt }
}

/**
 * Liste les conversations (métadonnées seulement), renvoie une conversation
 * complète (?id=) ou plusieurs d'un coup (?ids=a,b,c — 50 au plus) : le
 * rapatriement de l'historique à la connexion ne fait plus une requête par
 * conversation.
 */
export async function GET(req: NextRequest) {
  try {
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard

    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      const conv = await db.conversation.findUnique({ where: { id, ...(scope ?? {}) } })
      if (!conv) return Response.json({ error: 'Introuvable' }, { status: 404 })
      return Response.json({ conversation: toConversation(conv) })
    }

    const idsParam = req.nextUrl.searchParams.get('ids')
    if (idsParam !== null) {
      const ids = [...new Set(idsParam.split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 50)
      if (ids.length === 0) return Response.json({ conversations: [] })
      const rows = await db.conversation.findMany({ where: { ...(scope ?? {}), id: { in: ids } } })
      return Response.json({ conversations: rows.map(toConversation) })
    }

    const conversations = await db.conversation.findMany({
      where: scope,
      orderBy: { updatedAt: 'desc' },
      take: MAX_CONVERSATIONS,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    })
    return Response.json({ conversations })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}

/** Upsert d'une conversation complète (id, title, messages). */
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const id = String(body?.id ?? '').trim()
    if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
    const title = String(body?.title ?? 'Conversation').slice(0, 120)
    const messages = sanitizeMessages(body?.messages)

    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    const owned = userId ? { userId } : {}

    // Une conversation appartenant à un AUTRE compte n'est jamais écrasée.
    // (lecture du seul propriétaire : inutile de relire tout l'historique)
    const existing = await db.conversation.findUnique({ where: { id }, select: { id: true, userId: true } })
    if (existing && userId && String(existing.userId ?? '')) {
      if (String(existing.userId) !== userId) return Response.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const data = JSON.stringify(messages)
    if (existing) {
      await db.conversation.update({ where: { id }, data: { title, data, ...owned } })
    } else {
      // Deux sauvegardes simultanées d'une conversation neuve : la seconde met à jour.
      await db.conversation
        .create({ data: { id, title, data, ...owned } })
        .catch(() => db.conversation.update({ where: { id, ...(userId ? { userId } : {}) }, data: { title, data } }))
    }
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}

/** Supprime une conversation (?id=) ou tout l'historique (?all=1). */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    const all = req.nextUrl.searchParams.get('all')
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    if (all === '1') {
      await db.conversation.deleteMany({ where: scope })
      return Response.json({ ok: true })
    }
    if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
    await db.conversation.delete({ where: { id, ...(scope ?? {}) } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}
