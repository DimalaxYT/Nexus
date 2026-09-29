// Test round 13 : chemin NEXUS + mission réseau
const BASE = 'http://localhost:3000'

async function nexusQuestion(text: string): Promise<void> {
  const t0 = Date.now()
  const sse = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
  })
  const reader = sse.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let out = ''
  const steps: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      try {
        const ev = JSON.parse(line.slice(5)) as Record<string, unknown>
        if (ev.type === 'token') out += String(ev.content)
        else if (ev.type === 'step') steps.push(`${ev.label} — ${ev.detail}`)
        else if (ev.type === 'error') steps.push(`ERREUR: ${ev.message}`)
      } catch { /* partiel */ }
    }
  }
  console.log(`\n« ${text.slice(0, 60)} » (${Date.now() - t0} ms)`)
  console.log('étapes:', steps.join(' | ').slice(0, 200))
  console.log('réponse:', out.slice(0, 420).replace(/\n+/g, ' '))
}

async function missionTest(): Promise<void> {
  console.log('\n=== MISSION : dernière vidéo de fugu ===')
  // Créer la mission via l'API tasks
  const created = (await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TEST R13 fugu',
      duration: '5 min',
      objectives: ['Regarder la dernière vidéo youtube de fugu', 'Me faire une synthèse de ce que tu as compris'],
      description: 'Regarder la dernière vidéo de fugu et résumer.',
    }),
  }).then((r) => r.json())) as { task?: { id: string } }
  const id = created.task?.id
  console.log('mission créée:', id)
  if (!id) return

  // Déclencher le runner via l'API missions/run
  await fetch(`${BASE}/api/missions/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => {})

  // Attendre la fin (polling, max 100 s)
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 4000))
    const t = (await fetch(`${BASE}/api/tasks`).then((r) => r.json())) as { tasks?: { id: string; status: string; progress: { note: string }[]; report: string }[] }
    const task = t.tasks?.find((x) => x.id === id)
    if (!task) continue
    console.log(`[${i * 4}s] status=${task.status} · ${task.progress?.length ?? 0} entrées de journal`)
    if (task.status === 'done' || task.status === 'blocked') {
      console.log('\njournal:')
      for (const p of task.progress) console.log('  -', p.note.slice(0, 120))
      console.log('\nrapport (extrait):', task.report.slice(0, 600).replace(/\n+/g, ' | '))
      break
    }
  }

  // Nettoyage mission + notes
  await fetch(`${BASE}/api/tasks?id=${id}`, { method: 'DELETE' }).catch(() => {})
}

async function main() {
  await nexusQuestion('Peux tu regarder la dernière vidéo youtube de fugu et me dire de quoi elle parle?')
  await nexusQuestion('Génère une vidéo : un vol de drone au-dessus d une ville néon')
  await missionTest()
}

main()
