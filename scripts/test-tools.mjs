// Test des nouveaux outils : read_webpage + generate_webpage
const BASE = 'http://localhost:3000'

async function run(label, messages, watch) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let steps = []
  let codeName = null
  let sources = 0
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
        if (ev.type === 'step') steps.push(`${ev.status}:${ev.tool}`)
        if (ev.type === 'code') codeName = ev.code?.name
        if (ev.type === 'sources') sources += ev.sources?.length ?? 0
      } catch {}
    }
  }
  console.log(`${label} (${Math.round((Date.now() - t0) / 1000)}s)`)
  console.log(`  steps: ${steps.join(' | ')}`)
  if (sources) console.log(`  sources: ${sources}`)
  if (codeName) console.log(`  page web: "${codeName}"`)
  console.log(`  réponse: ${text.slice(0, 220).replace(/\n/g, ' ')}`)
}

async function main() {
  await run('READ_WEBPAGE', [
    { role: 'user', content: 'Lis https://example.com et dis-moi exactement ce que contient cette page.' },
  ])
  await run('GENERATE_WEBPAGE', [
    { role: 'user', content: 'Crée une page web avec un minuteur pomodoro interactif de 25 minutes, design sombre violet.' },
  ])
}

main().catch((e) => {
  console.error('ERREUR', e)
  process.exit(1)
})
