// Test mémoire : info personnelle → extraction → persistance → injection
const BASE = 'http://localhost:3000'

async function streamEvents(messages) {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let meta = null
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
        if (ev.type === 'token') text += ev.content
        if (ev.type === 'meta') meta = ev
      } catch {}
    }
  }
  return { text, meta }
}

async function main() {
  // 1. Échange avec info personnelle durable
  console.log('── Échange 1 : présentation ──')
  const r1 = await streamEvents([
    { role: 'user', content: "Bonjour ! Petite présentation : je m'appelle Claire Dupont, je suis architecte d'intérieur à Lyon, et je déteste le style minimaliste blanc. J'aime les ambiances chaleureuses avec du bois et du laiton." },
  ])
  console.log('meta:', JSON.stringify(r1.meta))
  console.log('réponse (100 premiers):', r1.text.slice(0, 100).replace(/\n/g, ' '))

  await new Promise((r) => setTimeout(r, 1500))

  // 2. Vérifier la mémoire en base
  const memRes = await fetch(`${BASE}/api/memory`)
  const { memories } = await memRes.json()
  console.log('\n── Mémoire en base ──')
  for (const m of memories) console.log(`  [${m.kind}] ${m.content}`)

  // 3. Nouvelle conversation : NEXUS doit se souvenir
  console.log('\n── Échange 2 : nouvelle conversation (test de rappel) ──')
  const r2 = await streamEvents([
    { role: 'user', content: 'Rappelle-moi ton prénom et ta ville ? Et quels matériaux tu préfères ?' },
  ])
  console.log('réponse:', r2.text.slice(0, 300).replace(/\n/g, ' '))
}

main().catch((e) => {
  console.error('ERREUR', e)
  process.exit(1)
})
