// Test de performance de l'agent : fast-path (1er token) + chemin lent (outils)
const BASE = 'http://localhost:3000'

async function testAgent(label, messages) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!res.ok) {
    console.log(`${label}: ERREUR HTTP ${res.status}`)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let firstToken = 0
  let tokens = 0
  let events = { step: 0, sources: 0, done: 0, meta: 0, code: 0, image: 0 }
  let metaInfo = ''
  let firstChunkLen = 0
  const start = () => (firstToken === 0 ? Date.now() - t0 : firstToken)
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
        const ev = JSON.parse(line.slice(5).trim())
        if (ev.type === 'token') {
          if (firstToken === 0) {
            firstToken = Date.now() - t0
            firstChunkLen = ev.content.length
          }
          tokens++
        } else if (events[ev.type] !== undefined) {
          events[ev.type]++
          if (ev.type === 'meta') metaInfo = JSON.stringify(ev)
          if (ev.type === 'step') start()
        }
      } catch {}
    }
  }
  const total = Date.now() - t0
  console.log(`${label}:`)
  console.log(`  1er token: ${firstToken} ms (chunk=${firstChunkLen} chars) | ${tokens} chunks`)
  console.log(`  total: ${total} ms | events: ${JSON.stringify(events)} ${metaInfo}`)
}

async function main() {
  await testAgent('FAST-PATH (salut)', [
    { role: 'user', content: 'Salut NEXUS ! Raconte-moi une blague courte sur les robots.' },
  ])
  await testAgent('CHEMIN LENT (recherche)', [
    { role: 'user', content: 'Quel est le prix actuel du bitcoin en dollars ?' },
  ])
}

main().catch((e) => {
  console.error('ERREUR', e)
  process.exit(1)
})
