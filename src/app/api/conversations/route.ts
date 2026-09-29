import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
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

/** Liste les conversations (?list=1) ou renvoie une conversation complète (?id=). */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      const conv = await db.conversation.findUnique({ where: { id } })
      if (!conv) return Response.json({ error: 'Introuvable' }, { status: 404 })
      let messages: ChatMessage[] = []
      try {
        messages = sanitizeMessages(JSON.parse(conv.data))
      } catch {
        messages = []
      }
      return Response.json({
        conversation: { id: conv.id, title: conv.title, messages, createdAt: conv.createdAt, updatedAt: conv.updatedAt },
      })
    }

    const conversations = await db.conversation.findMany({
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

    await db.conversation.upsert({
      where: { id },
      create: { id, title, data: JSON.stringify(messages) },
      update: { title, data: JSON.stringify(messages) },
    })
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
    if (all === '1') {
      await db.conversation.deleteMany({})
      return Response.json({ ok: true })
    }
    if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
    await db.conversation.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}
