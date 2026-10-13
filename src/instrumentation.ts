// ─── NEXUS — Initialisation serveur (Next.js instrumentation) ────────────────
// Démarre le worker de missions autonomes au boot : les missions « todo »
// en base sont exécutées en arrière-plan, même quand personne ne regarde.

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startMissionWorker } = await import('@/lib/mission-runner')
    startMissionWorker()

    // L'agent Dev ne dort jamais : son daemon d'entraînement prend le relais
    // pour que NEXUS continue d'apprendre quand personne ne regarde.
    const { startDevDaemon } = await import('@/lib/devdaemon')
    startDevDaemon()
  }
}
