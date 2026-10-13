import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ownerFilter, ownerGuard } from '@/lib/auth'
import { parseAgentRow } from '@/lib/nexus-types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_TEAM = [
  {
    name: 'Scout',
    emoji: '🔎',
    role: 'chercheur',
    description: "Chercheur web rapide : trouve les meilleures sources sur Google, YouTube et TikTok.",
    specialties: JSON.stringify(['google', 'youtube', 'recherche']),
    color: '#38bdf8',
  },
  {
    name: 'Analyste',
    emoji: '🧠',
    role: 'analyste',
    description: "Lit les sources, comprend et retient les informations essentielles en mémoire.",
    specialties: JSON.stringify(['analyse', 'comprehension', 'memoire']),
    color: '#a78bfa',
  },
  {
    name: 'Rédacteur',
    emoji: '✍️',
    role: 'redacteur',
    description: "Rédige la synthèse finale de chaque mission : le rapport lisible et concret.",
    specialties: JSON.stringify(['redaction', 'synthese', 'rapport']),
    color: '#34d399',
  },
]

/**
 * Sème l'équipe par défaut de CE compte (idempotent). Chaque nouvel utilisateur
 * démarre donc avec une équipe prête, sans jamais voir celle des autres.
 */
async function ensureDefaultTeam(userId: string | null): Promise<void> {
  try {
    const count = await db.agentProfile.count({ where: ownerFilter(userId) })
    if (count > 0) return
    for (const agent of DEFAULT_TEAM) {
      await db.agentProfile.create({ data: { ...agent, ...(userId ? { userId } : {}) } })
    }
  } catch {
    /* base indisponible : on retentera au prochain appel */
  }
}

/**
 * Équipe multi-agents (créée et gérée par l'utilisateur, cloisonnée par compte) :
 * - GET                → liste (+ semis de l'équipe par défaut du compte)
 * - POST               → création { name, emoji?, role?, description?, specialties?, color?, prompt?, writer?, blueprintId? }
 * - PATCH { id, ... }  → modification
 * - DELETE ?id         → suppression
 */
export async function GET() {
  try {
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    await ensureDefaultTeam(userId)
    const rows = await db.agentProfile.findMany({ where: ownerFilter(userId), orderBy: { createdAt: 'asc' } })
    return Response.json({ agents: rows.map(parseAgentRow) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur de lecture de l\u2019équipe', agents: [] },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 60)
  if (!name) return Response.json({ error: 'Le nom de l\u2019agent est requis' }, { status: 400 })

  const emoji = String(body?.emoji ?? '🤖').trim().slice(0, 8) || '🤖'
  const roleRaw = String(body?.role ?? 'specialiste')
  const role = ['chercheur', 'analyste', 'redacteur', 'specialiste', 'codeur'].includes(roleRaw) ? roleRaw : 'specialiste'
  const description = String(body?.description ?? '').trim().slice(0, 400)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 4000)
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body?.color ?? '')) ? String(body.color) : '#a78bfa'
  const blueprintId = String(body?.blueprintId ?? '').trim().slice(0, 60)
  const specialties = Array.isArray(body?.specialties)
    ? body.specialties.map((s: unknown) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8)
    : []

  try {
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    const owned = userId ? { userId } : {}
    const created = await db.agentProfile.create({
      data: {
        name,
        emoji,
        role,
        description,
        prompt,
        color,
        blueprintId,
        writer: Boolean(body?.writer),
        specialties: JSON.stringify(specialties),
        ...owned,
      },
    })
    return Response.json({ agent: parseAgentRow(created) }, { status: 201 })
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
  if (typeof body?.role === 'string' && ['chercheur', 'analyste', 'redacteur', 'specialiste', 'codeur'].includes(body.role)) {
    data.role = body.role
  }
  if (typeof body?.description === 'string') data.description = body.description.trim().slice(0, 400)
  if (typeof body?.prompt === 'string') data.prompt = body.prompt.trim().slice(0, 4000)
  if (typeof body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) data.color = body.color
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body?.writer === 'boolean') data.writer = body.writer
  if (typeof body?.blueprintId === 'string') data.blueprintId = body.blueprintId.trim().slice(0, 60)
  if (Array.isArray(body?.specialties)) {
    data.specialties = JSON.stringify(
      body.specialties.map((s: unknown) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8)
    )
  }
  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    const updated = await db.agentProfile.update({ where: { id, ...(scope ?? {}) }, data })
    if (!updated) return Response.json({ error: 'Agent introuvable' }, { status: 404 })
    return Response.json({ agent: parseAgentRow(updated) })
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
    const guard = await ownerGuard()
    if (!guard.ok) return guard.response
    const { scope, userId } = guard
    const existing = await db.agentProfile.findUnique({ where: { id, ...(scope ?? {}) } })
    if (!existing) return Response.json({ error: 'Agent introuvable' }, { status: 404 })
    // L'agent système (Dev) fait partie de NEXUS : on ne le supprime pas.
    if (String((existing as { systemKey?: unknown }).systemKey ?? '')) {
      return Response.json({ error: 'Cet agent système fait partie de NEXUS et ne peut pas être supprimé.' }, { status: 403 })
    }
    await db.agentProfile.delete({ where: { id, ...(scope ?? {}) } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
