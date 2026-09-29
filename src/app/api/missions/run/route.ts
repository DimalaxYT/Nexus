import { NextRequest } from 'next/server'
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
