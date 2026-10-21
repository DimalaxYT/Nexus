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

    // Préchauffage du CLASSIFIEUR : ses poids sont livrés dans le dépôt
    // (`public/models/nexus-intent-v1.*`) et chargés en quelques millisecondes.
    // Avant, le réseau s'entraînait ici de façon SYNCHRONE : 28 s pendant
    // lesquelles le serveur ne répondait à rien (plusieurs minutes sur une
    // instance Render à 0,1 CPU, après chaque déploiement ou redémarrage).
    // `prepareClassifier` ne bloque jamais la boucle d'événements : si les
    // poids livrés ne correspondent plus au dataset, il réentraîne par petites
    // tranches pendant que le serveur continue de répondre. Suivi d'un
    // préchauffage du retrieval de dialogue (stemmes de la banque).
    import('@/lib/brain/classifier')
      .then(({ prepareClassifier }) => prepareClassifier())
      .then((r) =>
        import('@/lib/llm/dialogue').then(({ matchDialogue }) => {
          matchDialogue('Bonjour !', [])
          matchDialogue("Qu'est-ce que tu sais faire ?", [])
          const how = r.source === 'livré' ? 'poids livrés' : r.source === 'cache' ? 'poids en cache' : 'réentraîné en arrière-plan'
          console.log(`[nexus] classifieur prêt en ${r.ms} ms (${how}) + retrieval prêt`)
        })
      )
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
