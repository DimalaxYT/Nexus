// Planifications des blueprints (assistants qui tournent seuls).
// GET  → planifications du compte
// POST → { action: 'create' | 'update' | 'run' | 'delete', … }

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, ownerFilter } from '@/lib/auth'
import { SCHEDULE_MAX_EVERY_MIN, SCHEDULE_MIN_EVERY_MIN, runDueSchedules } from '@/lib/blueprint-scheduler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const iso = (v: unknown) => (v ? new Date(v as number | string | Date).toISOString() : null)

function shape(row: Record<string, unknown>, blueprintName = '') {
  return {
    id: String(row.id),
    blueprintId: String(row.blueprintId ?? ''),
    blueprintName,
    everyMin: Number(row.everyMin ?? 60),
    message: String(row.message ?? ''),
    enabled: row.enabled !== false,
    lastRunAt: iso(row.lastRunAt),
    nextRunAt: iso(row.nextRunAt),
    lastStatus: String(row.lastStatus ?? ''),
    lastReply: String(row.lastReply ?? ''),
  }
}

function cleanEvery(value: unknown): number | null {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n) || n < SCHEDULE_MIN_EVERY_MIN || n > SCHEDULE_MAX_EVERY_MIN) return null
  return n
}

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.', schedules: [] }, { status: 401 })
  const rows = (await db.blueprintSchedule.findMany({ where: ownerFilter(user.id) ?? {}, orderBy: { createdAt: 'desc' }, take: 100 })) as Record<string, unknown>[]
  const names = new Map(((await db.blueprint.findMany({ where: ownerFilter(user.id) ?? {}, take: 200 })) as Record<string, unknown>[]).map((b) => [String(b.id), String(b.name ?? '')]))
  return Response.json({ schedules: rows.map((r) => shape(r, names.get(String(r.blueprintId)) ?? '')) })
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const owned = ownerFilter(user.id) ?? {}
  const action = String(body.action ?? '')
  try {
    if (action === 'create') {
      const blueprintId = String(body.blueprintId ?? '')
      const bp = blueprintId ? await db.blueprint.findUnique({ where: { id: blueprintId, ...owned } }) : null
      if (!bp) return Response.json({ error: 'Schéma introuvable.' }, { status: 404 })
      const everyMin = cleanEvery(body.everyMin ?? 60)
      if (!everyMin) return Response.json({ error: `Fréquence entre ${SCHEDULE_MIN_EVERY_MIN} min et ${SCHEDULE_MAX_EVERY_MIN} min.` }, { status: 400 })
      const message = String(body.message ?? '').trim().slice(0, 500)
      await db.blueprintSchedule.create({
        data: { userId: user.id, blueprintId, everyMin, message, enabled: true, nextRunAt: Date.now() + 60_000, lastStatus: '', lastReply: '' },
      })
      return Response.json({ ok: true })
    }

    const id = String(body.id ?? '')
    const existing = id ? ((await db.blueprintSchedule.findUnique({ where: { id, ...owned } })) as Record<string, unknown> | null) : null
    if (!existing) return Response.json({ error: 'Planification introuvable.' }, { status: 404 })

    if (action === 'update') {
      const data: Record<string, unknown> = {}
      if (typeof body.enabled === 'boolean') data.enabled = body.enabled
      if (body.everyMin !== undefined) {
        const every = cleanEvery(body.everyMin)
        if (!every) return Response.json({ error: `Fréquence entre ${SCHEDULE_MIN_EVERY_MIN} min et ${SCHEDULE_MAX_EVERY_MIN} min.` }, { status: 400 })
        data.everyMin = every
      }
      if (typeof body.message === 'string') data.message = body.message.slice(0, 500)
      if (data.enabled === true) data.nextRunAt = Date.now() + 60_000
      await db.blueprintSchedule.update({ where: { id, ...owned }, data })
      return Response.json({ ok: true })
    }

    if (action === 'run') {
      // Exécution immédiate : la planification devient « due » et la passe la prend.
      await db.blueprintSchedule.update({ where: { id, ...owned }, data: { nextRunAt: Date.now() - 1 } })
      const res = await runDueSchedules()
      return Response.json({ ok: true, ...res })
    }

    if (action === 'delete') {
      await db.blueprintSchedule.delete({ where: { id, ...owned } })
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Opération impossible' }, { status: 500 })
  }
}
