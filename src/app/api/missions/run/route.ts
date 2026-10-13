import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { ownerGuard } from '@/lib/auth'
import { startMissionRun, startMissionWorker } from '@/lib/mission-runner'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Déclenche l'exécution autonome d'une mission en arrière-plan.
 * POST { id } → { started: true } (fire-and-forget : la mission tourne
 * côté serveur, l'utilisateur peut fermer l'application).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '').trim()
  if (!id) return Response.json({ error: 'id de mission requis' }, { status: 400 })

  // Une mission n'est lançable que par son propriétaire.
  const guard = await ownerGuard()
  if (!guard.ok) return guard.response
  const { scope, userId } = guard
  const task = await db.task.findUnique({ where: { id, ...(scope ?? {}) } })
  if (!task) return Response.json({ error: 'Mission introuvable' }, { status: 404 })

  // S'assure que le worker de la file est vivant (dev / redémarrage)
  startMissionWorker()
  startMissionRun(id)
  return Response.json({ started: true })
}

/** État du moteur LLM (diagnostic : disponible / en coupure circuit-breaker). */
export async function GET() {
  const { llmStatus } = await import('@/lib/llm')
  return Response.json({ llm: llmStatus() })
}
