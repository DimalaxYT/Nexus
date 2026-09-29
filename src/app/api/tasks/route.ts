import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseTaskRow } from '@/lib/nexus-types'

export const runtime = 'nodejs'

/**
 * Gestion des missions (bouton Task) :
 * - GET              → liste complète (avec rapport final)
 * - POST { name, duration?, objectives?, description?, agents? } → création
 * - PATCH { id, status?, note? } → statut + point d'avancement
 * - DELETE ?id | ?all → suppression
 */
export async function GET() {
  try {
    const rows = await db.task.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 })
    return Response.json({ tasks: rows.map(parseTaskRow) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur de lecture des missions' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const name = String(body?.name ?? '').trim().slice(0, 160)
  if (!name) {
    return Response.json({ error: 'Le nom de la mission est requis' }, { status: 400 })
  }
  const duration = String(body?.duration ?? '').trim().slice(0, 80)
  const description = String(body?.description ?? '').trim().slice(0, 4000)
  const objectives = Array.isArray(body?.objectives)
    ? body.objectives
        .map((o: unknown) => String(o).trim().slice(0, 300))
        .filter(Boolean)
        .slice(0, 20)
    : []
  const agents = Array.isArray(body?.agents)
    ? body.agents.map((a: unknown) => String(a).trim()).filter(Boolean).slice(0, 10)
    : []

  try {
    const created = await db.task.create({
      data: {
        name,
        duration,
        description,
        objectives: JSON.stringify(objectives),
        status: 'todo',
        progress: '[]',
        agents: JSON.stringify(agents),
      },
    })
    return Response.json({ task: parseTaskRow(created) }, { status: 201 })
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

  const statusRaw = String(body?.status ?? '').toLowerCase()
  const status = ['todo', 'running', 'done', 'blocked'].includes(statusRaw) ? statusRaw : null
  const note = String(body?.note ?? '').trim().slice(0, 600)

  try {
    const existing = await db.task.findUnique({ where: { id } })
    if (!existing) return Response.json({ error: 'Mission introuvable' }, { status: 404 })

    const progress = (() => {
      try {
        const arr = JSON.parse(existing.progress) as unknown
        return Array.isArray(arr) ? arr : []
      } catch {
        return []
      }
    })() as { at: string; note: string }[]
    if (note) progress.push({ at: new Date().toISOString(), note })

    const updated = await db.task.update({
      where: { id },
      data: {
        ...(status ? { status } : {}),
        ...(note ? { progress: JSON.stringify(progress.slice(-20)) } : {}),
      },
    })
    return Response.json({ task: parseTaskRow(updated) })
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
  const all = searchParams.get('all')
  try {
    if (all) {
      await db.task.deleteMany({})
      return Response.json({ ok: true })
    }
    if (id) {
      await db.task.delete({ where: { id } })
      return Response.json({ ok: true })
    }
    return Response.json({ error: 'id requis' }, { status: 400 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
