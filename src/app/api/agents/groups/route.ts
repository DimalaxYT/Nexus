// ─── NEXUS — Groupes d'agents (créés et gérés par l'utilisateur) ─────────────
// Un groupe rassemble plusieurs agents : on peut lui adresser une discussion
// entière (table ronde suivie d'une synthèse) depuis le sélecteur du chat.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseAgentGroupRow } from '@/lib/nexus-types'

export const runtime = 'nodejs'

/** Normalise une liste d'ids de membres : strings non vides, uniques, max 24. */
function normalizeMembers(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const m of raw) {
    const id = String(m).trim()
    if (id && !seen.has(id)) seen.add(id)
  }
  return Array.from(seen).slice(0, 24)
}

/**
 * Groupes d'agents :
 * - GET                 → liste complète
 * - POST                → création { name, emoji?, color?, members? : string[] }
 * - PATCH { id, ... }   → modification (name, emoji, color, members)
 * - DELETE ?id          → suppression
 */
export async function GET() {
  try {
    const rows = await db.agentGroup.findMany({ orderBy: { createdAt: 'asc' } })
    return Response.json({ groups: rows.map(parseAgentGroupRow) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur de lecture des groupes', groups: [] },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) return Response.json({ error: 'Le nom du groupe est requis' }, { status: 400 })

  const emoji = String(body?.emoji ?? '👥').trim().slice(0, 8) || '👥'
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body?.color ?? '')) ? String(body.color) : '#38bdf8'
  const members = normalizeMembers(body?.members)

  try {
    const created = await db.agentGroup.create({
      data: { name, emoji, color, members: JSON.stringify(members) },
    })
    return Response.json({ group: parseAgentGroupRow(created) }, { status: 201 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Création impossible' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '').trim()
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60)
  if (typeof body?.emoji === 'string' && body.emoji.trim()) data.emoji = body.emoji.trim().slice(0, 8)
  if (typeof body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) data.color = body.color
  if (body?.members !== undefined) data.members = JSON.stringify(normalizeMembers(body.members))
  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const updated = await db.agentGroup.update({ where: { id }, data })
    return Response.json({ group: parseAgentGroupRow(updated) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Mise à jour impossible' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
  try {
    await db.agentGroup.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
