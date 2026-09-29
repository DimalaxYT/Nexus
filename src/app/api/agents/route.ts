import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseAgentRow } from '@/lib/nexus-types'

export const runtime = 'nodejs'

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

/** Sème l'équipe par défaut au premier appel (idempotent). */
async function ensureDefaultTeam(): Promise<void> {
  try {
    const count = await db.agentProfile.count()
    if (count > 0) return
    for (const agent of DEFAULT_TEAM) {
      await db.agentProfile.create({ data: agent })
    }
  } catch {
    /* base indisponible : on retentera au prochain appel */
  }
}

/**
 * Équipe multi-agents (créée et gérée par l'utilisateur) :
 * - GET                → liste (+ semis de l'équipe par défaut au premier lancement)
 * - POST               → création { name, emoji?, role?, description?, specialties?, color? }
 * - PATCH { id, ... }  → modification (name, emoji, role, description, specialties, color, enabled)
 * - DELETE ?id         → suppression
 */
export async function GET() {
  try {
    await ensureDefaultTeam()
    const rows = await db.agentProfile.findMany({ orderBy: { createdAt: 'asc' } })
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
  const prompt = String(body?.prompt ?? '').trim().slice(0, 2000)
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body?.color ?? '')) ? String(body.color) : '#a78bfa'
  const specialties = Array.isArray(body?.specialties)
    ? body.specialties.map((s: unknown) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8)
    : []

  try {
    const created = await db.agentProfile.create({
      data: { name, emoji, role, description, prompt, color, writer: Boolean(body?.writer), specialties: JSON.stringify(specialties) },
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
  if (typeof body?.prompt === 'string') data.prompt = body.prompt.trim().slice(0, 2000)
  if (typeof body?.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(body.color)) data.color = body.color
  if (typeof body?.enabled === 'boolean') data.enabled = body.enabled
  if (typeof body?.writer === 'boolean') data.writer = body.writer
  if (Array.isArray(body?.specialties)) {
    data.specialties = JSON.stringify(
      body.specialties.map((s: unknown) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8)
    )
  }
  if (Object.keys(data).length === 0) return Response.json({ error: 'Rien à mettre à jour' }, { status: 400 })

  try {
    const updated = await db.agentProfile.update({ where: { id }, data })
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
    await db.agentProfile.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
