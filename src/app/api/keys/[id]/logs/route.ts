// Derniers appels d'une clé API (diagnostic : voir ce qu'ont demandé vos clients).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.', logs: [] }, { status: 401 })
  const { id } = await params
  const take = Math.min(Number(req.nextUrl.searchParams.get('take') ?? 20) || 20, 100)

  try {
    const key = await db.apiKey.findUnique({ where: { id, ...(ownerFilter(user.id) ?? {}) } })
    if (!key) return Response.json({ error: 'Clé introuvable', logs: [] }, { status: 404 })
    const rows = await db.apiKeyLog.findMany({ where: { keyId: id }, orderBy: { createdAt: 'desc' }, take })
    return Response.json({
      logs: rows.map((r) => ({
        id: String(r.id),
        at: r.createdAt,
        ok: Boolean(r.ok),
        ms: Number(r.ms ?? 0),
        message: String(r.message ?? ''),
        reply: String(r.reply ?? ''),
      })),
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible', logs: [] },
      { status: 500 }
    )
  }
}
