// Notifications in-app du compte (surveillances de sites, points des assistants).
// GET  → 30 dernières (et le nombre non lues)
// POST → { action: 'read-all' } marque tout comme lu

import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.', notifications: [], unread: 0 }, { status: 401 })
  const rows = (await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 30 })) as Record<string, unknown>[]
  const notifications = rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    body: String(r.body ?? ''),
    source: String(r.source ?? ''),
    read: r.read === true || r.read === 1,
    createdAt: r.createdAt ? new Date(r.createdAt as number | string | Date).toISOString() : null,
  }))
  return Response.json({ notifications, unread: notifications.filter((n) => !n.read).length })
}

export async function POST() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })
  const unread = (await db.notification.findMany({ where: { userId: user.id, read: false }, take: 200 })) as Record<string, unknown>[]
  for (const n of unread) await db.notification.update({ where: { id: String(n.id) }, data: { read: true } })
  return Response.json({ ok: true, marked: unread.length })
}
