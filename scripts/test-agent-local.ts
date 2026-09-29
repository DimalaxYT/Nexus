// Test SSE de bout en bout de l'agent local — bun scripts/test-agent-local.ts
const BASE = 'http://localhost:3000'

interface SseEvent {
  type: string
  [k: string]: unknown
}

async function runAgent(label: string, messages: { role: string; content: string }[]) {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok || !res.body) {
    console.log(`❌ ${label}: HTTP ${res.status}`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: SseEvent[] = []
  let text = ''
  const t0 = Date.now()
  let firstEventMs = -1
  let doneMs = -1
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (firstEventMs < 0) firstEventMs = Date.now() - t0
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      try {
        const ev = JSON.parse(payload) as SseEvent
        events.push(ev)
        if (ev.type === 'token') text += String(ev.content ?? '')
        if (ev.type === 'done') doneMs = Date.now() - t0
        if (ev.type === 'error') console.log(`   ⚠️ erreur: ${String(ev.message)}`)
      } catch {
        /* incomplet */
      }
    }
  }
  const types = [...new Set(events.map((e) => e.type))]
  console.log(`\n── ${label} ──`)
  console.log(`   1er octet ${firstEventMs} ms · done ${doneMs} ms · événements [${types.join(', ')}]`)
  console.log(`   réponse (${text.length} chars): ${text.slice(0, 180).replace(/\n/g, ' ')}…`)
  const hasDone = events.some((e) => e.type === 'done')
  const hasError = events.some((e) => e.type === 'error')
  const steps = events.filter((e) => e.type === 'step')
  for (const s of steps.slice(0, 6)) {
    console.log(`   step: [${s.tool}] ${s.label} — ${String(s.detail).slice(0, 100)} (${s.status})`)
  }
  console.log(hasDone && !hasError && text.length > 30 ? `   ✅ flux complet` : `   ❌ flux incomplet`)
}

async function main() {
  // Health
  const health = await fetch(`${BASE}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [] }) })
  console.log(`Health check (messages vides → 400 attendu): ${health.status}`)

  await runAgent('Salutation', [{ role: 'user', content: 'salut nexus' }])
  await runAgent('Identité', [{ role: 'user', content: 'qui es tu ?' }])
  await runAgent('Maths', [{ role: 'user', content: 'combien font 128 fois 256 ?' }])
  await runAgent('Script Roblox', [{ role: 'user', content: 'ecris un script roblox pour un systeme de pieces qui rapportent 15 argent' }])
  await runAgent('Image procédurale', [{ role: 'user', content: 'genere une image de ville cyberpunk neon' }])
  await runAgent('Scène 3D', [{ role: 'user', content: 'cree une scene 3d de ville futuriste' }])
  await runAgent('Page web', [{ role: 'user', content: 'cree une page web todo liste' }])
  await runAgent('Savoir intégré', [{ role: 'user', content: 'explique moi comment fonctionne un datastore roblox' }])
  await runAgent('Mémoire', [{ role: 'user', content: "je m'appelle Maxime et j'habite à Paris" }])
  await runAgent('Rappel mémoire', [
    { role: 'user', content: "je m'appelle Maxime" },
    { role: 'assistant', content: 'Enchanté Maxime !' },
    { role: 'user', content: 'comment je m appelle ?' },
  ])
}

main()
