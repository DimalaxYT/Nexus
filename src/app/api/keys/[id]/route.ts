// Modification / suppression d'une clé API du compte.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'
import { normalizeConfig, toApiKeyInfo } from '@/lib/api-keys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })
  const { id } = await params

  const body = await req.json().catch(() => null)
  const data: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60)
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body?.agentId === 'string') data.agentId = body.agentId.trim().slice(0, 60)
  if (typeof body?.blueprintId === 'string') data.blueprintId = body.blueprintId.trim().slice(0, 60)
  if (body?.config !== undefined) data.config = JSON.stringify(normalizeConfig(body.config))
  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const updated = await db.apiKey.update({ where: { id, ...(ownerFilter(user.id) ?? {}) }, data })
    if (!updated) return Response.json({ error: 'Clé introuvable' }, { status: 404 })
    return Response.json({ key: toApiKeyInfo(updated) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Mise à jour impossible' },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })
  const { id } = await params
  try {
    await db.apiKey.delete({ where: { id, ...(ownerFilter(user.id) ?? {}) } })
    await db.apiKeyLog.deleteMany({ where: { keyId: id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
