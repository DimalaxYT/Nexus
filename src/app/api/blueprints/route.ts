// ─── NEXUS — Blueprints : schémas d'utilisation d'agent ──────────────────────
// Un blueprint appartient à UN compte et peut être branché sur un agent.
// Le graphe (nœuds + liens) est stocké tel quel en JSON et exécuté par
// src/lib/blueprint.ts — aucun appel externe, tout est local.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'
import { parseBlueprintRow, parseGraph } from '@/lib/nexus-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/blueprints?agentId=… → les schémas du compte (ou d'un agent). */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.', blueprints: [] }, { status: 401 })
  const agentId = (req.nextUrl.searchParams.get('agentId') ?? '').trim()

  try {
    const rows = await db.blueprint.findMany({
      where: { ...(ownerFilter(user.id) ?? {}), ...(agentId ? { agentId } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    })
    return Response.json({ blueprints: rows.map(parseBlueprintRow) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible', blueprints: [] },
      { status: 500 }
    )
  }
}

/** POST /api/blueprints { name, agentId?, description?, graph? } */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 80) || 'Mon schéma'
  const agentId = String(body?.agentId ?? '').trim().slice(0, 60)
  const description = String(body?.description ?? '').trim().slice(0, 300)
  const graph = parseGraph(body?.graph ? JSON.stringify(body.graph) : '{}')

  try {
    const created = await db.blueprint.create({
      data: { userId: user.id, agentId, name, description, graph: JSON.stringify(graph), enabled: true },
    })
    // Branchement automatique sur l'agent ciblé
    if (agentId) {
      await db.agentProfile.update({ where: { id: agentId, ...(ownerFilter(user.id) ?? {}) }, data: { blueprintId: String(created?.id ?? '') } })
    }
    return Response.json({ blueprint: parseBlueprintRow(created) }, { status: 201 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Création impossible' },
      { status: 500 }
    )
  }
}

/** PATCH /api/blueprints { id, name?, description?, graph?, enabled?, agentId? } */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '').trim()
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 80)
  if (typeof body?.description === 'string') data.description = body.description.trim().slice(0, 300)
  if (typeof body?.agentId === 'string') data.agentId = body.agentId.trim().slice(0, 60)
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  if (body?.graph !== undefined) data.graph = JSON.stringify(parseGraph(JSON.stringify(body.graph)))

  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const updated = await db.blueprint.update({ where: { id, ...(ownerFilter(user.id) ?? {}) }, data })
    if (!updated) return Response.json({ error: 'Schéma introuvable' }, { status: 404 })
    return Response.json({ blueprint: parseBlueprintRow(updated) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Mise à jour impossible' },
      { status: 500 }
    )
  }
}

/** DELETE /api/blueprints?id=… */
export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })

  try {
    const bp = await db.blueprint.findUnique({ where: { id, ...(ownerFilter(user.id) ?? {}) } })
    if (!bp) return Response.json({ error: 'Schéma introuvable' }, { status: 404 })
    // Détache le schéma des agents qui l'utilisaient
    const agents = await db.agentProfile.findMany({ where: ownerFilter(user.id) })
    for (const a of agents) {
      if (String(a.blueprintId ?? '') === id) {
        await db.agentProfile.update({ where: { id: String(a.id) }, data: { blueprintId: '' } })
      }
    }
    await db.blueprint.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
