// ─── Entraînement de NEXUS — pilotage ────────────────────────────────────────
// GET  → instantané complet (config, score, cycles, objectifs, entrées, leçons)
//        + état du daemon
// POST → { action: 'config' | 'run' | 'objective' | 'reset' }

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { getDaemonState, reschedule, runNow } from '@/lib/devdaemon'
import {
  addObjective,
  getTrainerConfig,
  saveTrainerConfig,
  trainerSnapshot,
} from '@/lib/devtrainer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    const [snapshot, daemon, config] = await Promise.all([
      trainerSnapshot(guard.userId),
      Promise.resolve(getDaemonState()),
      getTrainerConfig(),
    ])
    return Response.json({ ...snapshot, daemon, config })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible' },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')

  try {
    if (action === 'config') {
      const patch = (body?.config ?? {}) as Record<string, unknown>
      const config = await saveTrainerConfig({
        ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
        ...(Number(patch.intervalMin) > 0 ? { intervalMin: Math.min(720, Math.max(5, Number(patch.intervalMin))) } : {}),
        ...(patch.autonomy === 'auto' || patch.autonomy === 'valide' ? { autonomy: patch.autonomy } : {}),
        ...(Number(patch.pagesPerCycle) > 0 ? { pagesPerCycle: Math.min(8, Math.max(1, Number(patch.pagesPerCycle))) } : {}),
        ...(Number(patch.minScore) >= 0 ? { minScore: Math.min(1, Math.max(0, Number(patch.minScore))) } : {}),
        ...(Number(patch.maxCyclesPerDay) > 0 ? { maxCyclesPerDay: Math.min(200, Math.max(1, Number(patch.maxCyclesPerDay))) } : {}),
        ...(Number.isInteger(Number(patch.quietFrom)) ? { quietFrom: Math.min(23, Math.max(0, Number(patch.quietFrom))) } : {}),
        ...(Number.isInteger(Number(patch.quietTo)) ? { quietTo: Math.min(23, Math.max(0, Number(patch.quietTo))) } : {}),
        // Booléen explicite : `llmTraining` pilote le ré-entraînement du modèle
        // de langue pendant les cycles (désactivé par défaut, voir TrainerConfig).
        ...(typeof patch.llmTraining === 'boolean' ? { llmTraining: patch.llmTraining } : {}),
        ...(patch.sources && typeof patch.sources === 'object'
          ? {
              sources: {
                web: (patch.sources as Record<string, unknown>).web !== false,
                local: (patch.sources as Record<string, unknown>).local !== false,
              },
            }
          : {}),
      })
      await reschedule()
      return Response.json({ ok: true, config })
    }

    if (action === 'run') {
      const objectiveId = typeof body?.objectiveId === 'string' ? body.objectiveId : undefined
      const report = await runNow(objectiveId)
      return Response.json({ ok: true, report, daemon: getDaemonState() })
    }

    if (action === 'objective') {
      const label = String(body?.label ?? '').trim()
      const query = String(body?.query ?? '').trim() || label
      if (!label) return Response.json({ error: 'Libellé requis.' }, { status: 400 })
      const row = await addObjective(guard.userId, label, query, String(body?.category ?? 'culture'))
      return Response.json({ ok: true, objective: row })
    }

    if (action === 'reset') {
      const what = String(body?.what ?? 'tout')
      if (what === 'cycles' || what === 'tout') {
        await db.trainingRun.deleteMany({ where: { userId: guard.userId } }).catch(() => ({}))
      }
      if (what === 'entrees' || what === 'tout') {
        await db.trainingItem.deleteMany({ where: { userId: guard.userId } }).catch(() => ({}))
        // Réinitialiser doit aussi défaire ce que l'entraînement a injecté dans
        // le cerveau de NEXUS, sinon les connaissances survivent au reset.
        await db.knowledge
          .deleteMany({ where: { userId: guard.userId, source: 'dev-trainer' } })
          .catch(() => ({}))
        await db.devPatch
          .deleteMany({ where: { userId: guard.userId, origin: 'entrainement' } })
          .catch(() => ({}))
      }
      if (what === 'objectifs' || what === 'tout') {
        await db.trainingObjective.deleteMany({ where: { userId: guard.userId } }).catch(() => ({}))
      }
      if (what === 'pages' || what === 'tout') {
        await db.devPage.deleteMany({ where: { userId: guard.userId } }).catch(() => ({}))
      }
      if (what === 'lecons' || what === 'tout') {
        await db.trainingLesson.deleteMany({ where: { userId: guard.userId } }).catch(() => ({}))
      }
      return Response.json({ ok: true })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Action impossible' },
      { status: 500 }
    )
  }
}
