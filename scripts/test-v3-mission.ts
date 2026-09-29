/** Test live NEXUS v3 — mission autonome de bout en bout. */

const BASE = 'http://localhost:3000'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) Création de la mission (l'utilisateur assigne via le bouton Task)
  const created = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test v3 — compétences Roblox',
      duration: "Aujourd'hui",
      objectives: [
        'Trouver des techniques de scripting Luau pour débutants',
        'Découvrir des astuces de game design Roblox populaires',
      ],
      description: 'Mission de test du runner autonome NEXUS v3.',
    }),
  })
  const { task } = (await created.json()) as { task: { id: string; name: string } }
  console.log('Mission créée:', task.id, task.name)

  // 2) Déclenchement du runner autonome (fire-and-forget)
  const run = await fetch(`${BASE}/api/missions/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: task.id }),
  })
  console.log('Runner déclenché:', run.status, await run.json())

  // 3) Surveillance de la progression (comme le panneau Task, toutes les 5 s)
  const t0 = Date.now()
  let lastNote = ''
  while (Date.now() - t0 < 240_000) {
    await sleep(5000)
    const list = await fetch(`${BASE}/api/tasks`).then((r) => r.json())
    const t = (list.tasks as { id: string; status: string; progress: { at: string; note: string }[] }[]).find(
      (x) => x.id === task.id
    )
    if (!t) continue
    const notes = t.progress.map((p) => p.note)
    const latest = notes[notes.length - 1] ?? ''
    if (latest !== lastNote) {
      lastNote = latest
      console.log(`[${Math.round((Date.now() - t0) / 1000)}s][${t.status}] ${latest}`)
    }
    if (t.status === 'done' || t.status === 'blocked') {
      console.log(`\n=== MISSION ${t.status.toUpperCase()} en ${Math.round((Date.now() - t0) / 1000)}s ===`)
      console.log('Journal complet:')
      for (const n of notes) console.log('  •', n)
      break
    }
  }

  // 4) Vérifie les compétences apprises en base
  const kb = await fetch(`${BASE}/api/knowledge`).then((r) => r.json())
  const items = (kb.items as { title: string; category: string }[]).filter(
    (i) => i.category.startsWith('Compétences/') || i.category === 'Rapports'
  )
  console.log(`\nBase de connaissances: ${items.length} note(s) compétences/rapports`)
  for (const i of items.slice(0, 8)) console.log(`  [${i.category}] ${i.title}`)
}

main().catch((e) => {
  console.error('ÉCHEC GLOBAL:', e)
  process.exit(1)
})
