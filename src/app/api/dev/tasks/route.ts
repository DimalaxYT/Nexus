// ─── Dashboard Dev — file d'améliorations ────────────────────────────────────
// GET    → liste
// POST   → crée une tâche
// PATCH  → { id, status | priority }
// DELETE → ?id=

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['a_faire', 'en_cours', 'fait', 'refuse']
const PRIORITIES = ['basse', 'normale', 'haute']
const CATEGORIES = ['intelligence', 'code', 'performance', 'securite', 'interface']

function shape(row: any) {
  return {
    id: String(row?.id ?? ''),
    title: String(row?.title ?? ''),
    detail: String(row?.detail ?? ''),
    category: String(row?.category ?? 'code'),
    priority: String(row?.priority ?? 'normale'),
    status: String(row?.status ?? 'a_faire'),
    filePath: String(row?.filePath ?? ''),
    createdAt: row?.createdAt,
    updatedAt: row?.updatedAt,
  }
}

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const rows = await db.devTask.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
  return Response.json({ tasks: (rows ?? []).map(shape) })
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const title = String(body?.title ?? '').trim().slice(0, 200)
  if (!title) return Response.json({ error: 'Titre requis.' }, { status: 400 })
  const row = await db.devTask.create({
    data: {
      userId: guard.userId,
      title,
      detail: String(body?.detail ?? '').slice(0, 4000),
      category: CATEGORIES.includes(String(body?.category)) ? String(body.category) : 'code',
      priority: PRIORITIES.includes(String(body?.priority)) ? String(body.priority) : 'normale',
      status: 'a_faire',
      filePath: String(body?.filePath ?? '').slice(0, 300),
    },
  })
  return Response.json({ ok: true, task: shape(row) })
}

export async function PATCH(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })

    const data: Record<string, any> = {}
  if (STATUSES.includes(String(body?.status))) data.status = String(body.status)
  if (PRIORITIES.includes(String(body?.priority))) data.priority = String(body.priority)
  if (typeof body?.detail === 'string') data.detail = body.detail.slice(0, 4000)
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'Rien à modifier.' }, { status: 400 })
  }
  const row = await db.devTask.update({ where: { id }, data })
  return Response.json({ ok: true, task: shape(row) })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
  await db.devTask.delete({ where: { id } })
  return Response.json({ ok: true })
}
