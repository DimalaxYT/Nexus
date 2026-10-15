// Modification / suppression d'une clé API du compte.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'
import { PERSONAL_KEY_POLICY, normalizeConfig, parseConfig, toApiKeyInfo } from '@/lib/api-keys'

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
  const owned = ownerFilter(user.id) ?? {}
  const needsCurrent = body?.config !== undefined || body?.renewDays !== undefined
  // Les champs de conformité (déclaration d'usage, échéance) ne sont JAMAIS modifiables ici.
  const current = needsCurrent ? await db.apiKey.findUnique({ where: { id, ...owned } }) : null
  if (needsCurrent && !current) return Response.json({ error: 'Clé introuvable' }, { status: 404 })
  if (current && (body?.config !== undefined || body?.renewDays !== undefined)) {
    const prev = parseConfig(current.config)
    let next = body?.config !== undefined ? normalizeConfig(body.config) : prev
    next = { ...next, personalUseAcceptedAt: prev.personalUseAcceptedAt, expiresAt: prev.expiresAt }
    if (body?.renewDays !== undefined) {
      const days = Number(body.renewDays)
      if (!(PERSONAL_KEY_POLICY.lifetimesDays as readonly number[]).includes(days)) {
        return Response.json({ error: 'Durée de renouvellement non autorisée.' }, { status: 400 })
      }
      next = { ...next, expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() }
    }
    data.config = JSON.stringify(next)
  }
  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const updated = await db.apiKey.update({ where: { id, ...owned }, data })
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
