/** Test live NEXUS v4 — mission « synthèse vidéos chatbot IA » de bout en bout. */

const BASE = 'http://localhost:3000'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface TaskRow {
  id: string
  name: string
  status: string
  progress: { at: string; note: string }[]
  report: string
  reportAt: string | null
}

async function main() {
  // 0) Équipe : semis + liste
  const agentsRes = await fetch(`${BASE}/api/agents`)
  const agentsData = (await agentsRes.json()) as { agents?: { id: string; name: string; role: string }[] }
  console.log('Équipe :', agentsData.agents?.map((a) => `${a.name}(${a.role})`).join(' · ') ?? 'VIDE')

  // 1) Création de la mission EXACTE donnée par l'utilisateur
  const created = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Comprendre les chatbots et l’IA',
      duration: "Aujourd'hui",
      objectives: [
        "Rechercher sur youtube des vidéos de chatbot et d'ia",
        'Regarder ses vidéos',
        'Comprendre',
        'Retenir les informations essentiels',
        'Me faire une synthèse de ce que tu as compris',
      ],
      description: '',
    }),
  })
  const createdData = (await created.json()) as { task?: TaskRow; error?: string }
  if (!created.ok || !createdData.task) {
    console.error('Création impossible :', createdData.error)
    process.exit(1)
  }
  const id = createdData.task.id
  console.log(`Mission créée (${id}) — lancement en arrière-plan…`)

  // 2) Lancement explicite (remplace aussi le worker au besoin)
  await fetch(`${BASE}/api/missions/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })

  // 3) Suivi jusqu'à terminaison (max 3 min)
  const t0 = Date.now()
  let task: TaskRow | null = null
  let lastPrinted = 0
  while (Date.now() - t0 < 180_000) {
    await sleep(4000)
    const res = await fetch(`${BASE}/api/tasks`)
    const data = (await res.json()) as { tasks?: TaskRow[] }
    task = data.tasks?.find((t) => t.id === id) ?? null
    if (!task) break
    while (lastPrinted < task.progress.length) {
      console.log('  •', task.progress[lastPrinted].note.slice(0, 150))
      lastPrinted++
    }
    if (task.status === 'done' || task.status === 'blocked') break
  }

  if (!task) return console.error('Mission introuvable après lancement')
  console.log('\nStatut final :', task.status)

  // 4) Vérif rapport
  if (task.report && task.report.trim().length > 100) {
    console.log(`\n═══ RAPPORT (${task.report.length} caractères) ═══\n`)
    console.log(task.report)
  } else {
    console.log('\n⚠️ Rapport ABSENT ou trop court — relance avec le nouveau code…')
    await fetch(`${BASE}/api/tasks`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'todo' }),
    })
    await sleep(1000)
    await fetch(`${BASE}/api/missions/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    const t1 = Date.now()
    lastPrinted = 0
    while (Date.now() - t1 < 180_000) {
      await sleep(4000)
      const res = await fetch(`${BASE}/api/tasks`)
      const data = (await res.json()) as { tasks?: TaskRow[] }
      const t = data.tasks?.find((x) => x.id === id)
      if (!t) break
      task = t
      while (lastPrinted < t.progress.length) {
        console.log('  •', t.progress[lastPrinted].note.slice(0, 150))
        lastPrinted++
      }
      if (t.status === 'done' || t.status === 'blocked') break
    }
    console.log('\nStatut final (relance) :', task?.status)
    if (task?.report) {
      console.log(`\n═══ RAPPORT (${task.report.length} caractères) ═══\n`)
      console.log(task.report)
    } else {
      console.log('⚠️ Toujours pas de rapport.')
    }
  }
}

main()
