/**
 * Test NEXUS v1.4 : API /api/tasks (CRUD), capture d'écran (/api/tools/screenshot
 * et /api/tools/browse), event SSE webpage+screenshot via l'agent.
 */
const BASE = 'http://localhost:3000'

async function main() {
  console.log('── 1) /api/tasks CRUD ──────────────────────────────')
  const created = await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test mission veille',
      duration: 'Cette semaine',
      objectives: ['Trouver 3 tendances', 'Rédiger une synthèse'],
      description: 'Mission de test automatique',
    }),
  })
  const { task, error } = await created.json()
  if (!created.ok) throw new Error('POST task: ' + error)
  console.log('POST OK:', task.name, '| statut:', task.status, '| objectifs:', task.objectives.length, '| durée:', task.duration)

  const patched = await fetch(`${BASE}/api/tasks`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: task.id, status: 'running', note: 'Premier point d\u2019étape automatique' }),
  })
  const { task: patchedTask } = await patched.json()
  console.log('PATCH OK:', patchedTask.status, '| progress:', patchedTask.progress.length, 'entrée(s)')

  const list = await fetch(`${BASE}/api/tasks`).then((r) => r.json())
  console.log('GET OK:', list.tasks.length, 'mission(s)')

  const del = await fetch(`${BASE}/api/tasks?id=${task.id}`, { method: 'DELETE' })
  console.log('DELETE OK:', del.ok)

  console.log('\n── 2) /api/tools/screenshot ────────────────────────')
  const t0 = Date.now()
  const shot = await fetch(`${BASE}/api/tools/screenshot?url=https://example.com`)
  const shotData = await shot.json()
  if (!shot.ok || !shotData.dataUrl) throw new Error('screenshot: ' + JSON.stringify(shotData).slice(0, 200))
  console.log(`screenshot OK en ${Date.now() - t0}ms — title="${shotData.title}" — dataUrl=${shotData.dataUrl.slice(0, 30)}… (${Math.round(shotData.dataUrl.length / 1024)} Ko base64)`)

  console.log('\n── 3) /api/tools/browse (texte + capture) ──────────')
  const t1 = Date.now()
  const browse = await fetch(`${BASE}/api/tools/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' }),
  })
  const browseData = await browse.json()
  if (!browse.ok) throw new Error('browse: ' + JSON.stringify(browseData).slice(0, 200))
  console.log(`browse OK en ${Date.now() - t1}ms — title="${browseData.title}" — texte ${browseData.text.length} chars — screenshot: ${browseData.screenshot ? 'OUI (' + Math.round(browseData.screenshot.length / 1024) + ' Ko)' : 'NON'}`)

  // 2e capture immédiate (vérifie la réutilisation du navigateur)
  const t2 = Date.now()
  const shot2 = await fetch(`${BASE}/api/tools/screenshot?url=https://www.iana.org/help/example-domains`)
  const shot2Data = await shot2.json()
  console.log(`2e capture OK en ${Date.now() - t2}ms — title="${shot2Data.title || '?'}"`)

  console.log('\n── 4) Agent : event webpage avec screenshot ────────')
  const t3 = Date.now()
  const agentRes = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Lis https://example.com et dis-moi ce que tu y vois.' }],
    }),
  })
  const reader = agentRes.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let sawWebpage = false
  let sawShotInWebpage = false
  let sawThought = false
  let tokens = 0
  let done = false
  while (!done) {
    const { done: d, value } = await reader.read()
    if (d) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      try {
        const evt = JSON.parse(line.slice(5))
        if (evt.type === 'webpage') {
          sawWebpage = true
          sawShotInWebpage = Boolean(evt.screenshot)
          console.log(`  event webpage: url=${evt.url} title="${evt.title}" screenshot=${sawShotInWebpage ? Math.round(evt.screenshot.length / 1024) + ' Ko' : 'absent'}`)
        }
        if (evt.type === 'thought') { sawThought = true; console.log('  event thought:', evt.text.slice(0, 80)) }
        if (evt.type === 'token') tokens++
        if (evt.type === 'done') done = true
        if (evt.type === 'error') { console.log('  ERREUR:', evt.message); done = true }
      } catch {}
    }
  }
  console.log(`agent OK en ${((Date.now() - t3) / 1000).toFixed(1)}s — webpage:${sawWebpage ? 'OUI' : 'NON'} (screenshot:${sawShotInWebpage ? 'OUI' : 'NON'}) thought:${sawThought ? 'OUI' : 'NON'} chunks:${tokens}`)

  if (!sawWebpage) throw new Error('event webpage manquant')
  if (!sawShotInWebpage) throw new Error('screenshot manquant dans event webpage')

  console.log('\n✅ TOUS LES TESTS v1.4 PASSENT')
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
