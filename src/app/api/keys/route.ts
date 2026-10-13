// ─── NEXUS — Gestion des clés API du compte ──────────────────────────────────
// GET    → la liste des clés (secrète masquée : seul le préfixe est renvoyé)
// POST   → crée une clé (le secret est affiché UNE SEULE FOIS, à la création)

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'
import { mintApiKey, normalizeConfig, toApiKeyInfo } from '@/lib/api-keys'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.', keys: [] }, { status: 401 })
  try {
    const rows = await db.apiKey.findMany({ where: ownerFilter(user.id), orderBy: { createdAt: 'desc' }, take: 100 })
    return Response.json({ keys: rows.map((r) => toApiKeyInfo(r)) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible', keys: [] },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 60) || 'Clé API'
  const agentId = String(body?.agentId ?? '').trim().slice(0, 60)
  const blueprintId = String(body?.blueprintId ?? '').trim().slice(0, 60)
  const config = normalizeConfig(body?.config ?? {})

  // L'agent lié doit appartenir au compte
  if (agentId) {
    const agent = await db.agentProfile.findUnique({ where: { id: agentId, ...(ownerFilter(user.id) ?? {}) } })
    if (!agent) return Response.json({ error: 'Agent introuvable.' }, { status: 404 })
  }
  // Idem pour le blueprint
  if (blueprintId) {
    const bp = await db.blueprint.findUnique({ where: { id: blueprintId, ...(ownerFilter(user.id) ?? {}) } })
    if (!bp) return Response.json({ error: 'Schéma introuvable.' }, { status: 404 })
  }

  try {
    const minted = mintApiKey()
    const created = await db.apiKey.create({
      data: {
        userId: user.id,
        name,
        prefix: minted.prefix,
        hash: minted.hash,
        last4: minted.last4,
        agentId,
        blueprintId,
        config: JSON.stringify(config),
        enabled: true,
        totalCalls: 0,
      },
    })
    return Response.json(
      {
        key: toApiKeyInfo(created),
        // ⚠️ Affiché UNE seule fois : il est impossible de le relire ensuite.
        secret: minted.raw,
      },
      { status: 201 }
    )
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Création impossible' },
      { status: 500 }
    )
  }
}
