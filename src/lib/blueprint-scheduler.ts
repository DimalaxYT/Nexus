// ─── NEXUS — Planificateur des blueprints (assistants qui tournent seuls) ───
// Chaque minute (boucle interne et ping du Gardien), exécute les planifications
// arrivées à échéance : un blueprint peut ainsi surveiller un site, vérifier des
// informations et prévenir l'utilisateur sans que personne n'ouvre NEXUS.

import { db } from '@/lib/db'
import { runBlueprintGraph } from '@/lib/blueprint'
import { parseGraph } from '@/lib/nexus-types'

export const SCHEDULE_MIN_EVERY_MIN = 5
export const SCHEDULE_MAX_EVERY_MIN = 10080 // une semaine

let running = false

/** Exécute les planifications dues. Jamais deux passes en même temps. */
export async function runDueSchedules(): Promise<{ ran: number; skipped: boolean }> {
  if (running) return { ran: 0, skipped: true }
  running = true
  try {
    const now = Date.now()
    const due = (await db.blueprintSchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: new Date(now) } },
      take: 5,
    })) as Record<string, unknown>[]
    let ran = 0
    for (const s of due) {
      const everyMin = Math.min(SCHEDULE_MAX_EVERY_MIN, Math.max(SCHEDULE_MIN_EVERY_MIN, Number(s.everyMin) || 60))
      let status = 'ok'
      let reply = ''
      try {
        const bp = (await db.blueprint.findUnique({ where: { id: String(s.blueprintId) } })) as Record<string, unknown> | null
        if (!bp) {
          status = 'erreur : blueprint supprimé'
        } else {
          const graph = parseGraph(String(bp.graph ?? '{}'))
          const res = await runBlueprintGraph(graph, {
            message: String(s.message || 'Exécution planifiée'),
            userId: String(s.userId || '') || null,
            blueprintId: String(bp.id),
            timeoutMs: 60_000,
          })
          status = res.error ? `erreur : ${res.error}` : 'ok'
          reply = res.reply.slice(0, 2000)
        }
      } catch (err) {
        status = `erreur : ${err instanceof Error ? err.message : 'inconnue'}`
      }
      await db.blueprintSchedule.update({
        where: { id: String(s.id) },
        data: {
          lastRunAt: new Date(now),
          nextRunAt: new Date(now + everyMin * 60_000),
          lastStatus: status.slice(0, 200),
          lastReply: reply,
        },
      })
      ran++
    }
    return { ran, skipped: false }
  } finally {
    running = false
  }
}
