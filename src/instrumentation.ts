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

    // Préchauffage du cerveau : le gros module est chargé DÈS le boot au lieu
    // de la 1re requête de chat (sinon > 20 s d'attente au premier message
    // après chaque démarrage à froid — typique sur Render plan gratuit).
    import('@/lib/brain/brain').catch(() => {})
  }
}
