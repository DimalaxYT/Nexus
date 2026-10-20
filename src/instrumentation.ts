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

    // Le Gardien : auto-ping toutes les 10 min (anti-sommeil Render plan
    // gratuit) + entretien de la base. Production uniquement.
    if (process.env.NODE_ENV === 'production') {
      const { startKeepAlive } = await import('@/lib/keep-alive')
      startKeepAlive()
    }

    // Préchauffage du cerveau : le gros module est chargé DÈS le boot au lieu
    // de la 1re requête de chat (sinon > 20 s d'attente au premier message
    // après chaque démarrage à froid — typique sur Render plan gratuit).
    import('@/lib/brain/brain').catch(() => {})

    // Préchauffage du CLASSIFIEUR : importer le module ne suffit pas, car le
    // réseau neuronal s'entraîne au premier APPEL de classify() (85 époques).
    // Mesuré : 28,2 s pour le premier appel, 3 ms pour les suivants — c'était
    // donc le premier message de l'utilisateur qui payait l'entraînement, et le
    // préchauffage ci-dessus (import seul) ne changeait rien. On entraîne ici, au
    // démarrage, pendant que personne n'attend.
    // Note honnête : cet entraînement est synchrone, la boucle d'événements est
    // occupée pendant sa durée ; c'est un moindre mal face à un premier message
    // à 37 s. Suivi d'un préchauffage du retrieval de dialogue (stemmes de la
    // banque) pour que la première réponse soit servie immédiatement.
    import('@/lib/brain/classifier')
      .then(({ classify }) => {
        const t0 = Date.now()
        classify('Bonjour !')
        classify("Qu'est-ce que tu sais faire ?")
        const ms = Date.now() - t0
        return import('@/lib/llm/dialogue').then(({ matchDialogue }) => {
          matchDialogue('Bonjour !', [])
          matchDialogue("Qu'est-ce que tu sais faire ?", [])
          console.log(`[nexus] classifieur entraîné + retrieval prêt en ${ms} ms`)
        })
      })
      .catch(() => {})

    // Préchauffage du modèle de langue maison : lecture des poids (base ou point
    // de contrôle embarqué), allocation du cache clé/valeur et premier décodage.
    // Sans lui, la toute première réponse du chat paie la lecture du fichier de
    // poids (~1 Mo) et l'initialisation du tokenizer BPE.
    import('@/lib/llm/engine')
      .then((engine) => engine.warmUpLocalModel())
      .then((r) => {
        if (r.trained) console.log(`[nexus] modèle de langue prêt en ${r.ms} ms`)
        else console.log('[nexus] aucun modèle de langue entraîné — repli sur le savoir local')
      })
      .catch(() => {})
  }
}
