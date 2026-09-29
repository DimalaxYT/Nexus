// Non-régression round 15 : les compétences existantes doivent rester intactes
const BASE = 'http://localhost:3000'

async function chat(content: string) {
  const t0 = Date.now()
  const sse = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }], target: { kind: 'nexus' } }),
  })
  const reader = (sse.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalText = ''
  let hasImage = false
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
        if (ev.type === 'token') finalText += String(ev.content ?? '')
        if (ev.type === 'image') hasImage = true
      } catch {
        /* partiel */
      }
    }
  }
  return { ms: Date.now() - t0, finalText, hasImage }
}

async function main() {
  const checks: [string, string, (r: Awaited<ReturnType<typeof chat>>) => boolean][] = [
    ['combien font 12 plus 45', 'math exact', (r) => r.finalText.includes('57')],
    ["quelle heure est il", 'horloge locale', (r) => r.finalText.toLowerCase().includes('il est')],
    ['genere une image de dragon', 'image procédurale', (r) => r.hasImage],
    ['mes repos github', 'GitHub non connecté honnête', (r) => r.finalText.includes('GitHub') && (r.finalText.includes('Connexions') || r.finalText.includes('répondu') || r.finalText.includes('réussi'))],
  ]
  let fail = 0
  for (const [msg, label, check] of checks) {
    const r = await chat(msg)
    const ok = check(r)
    if (!ok) fail++
    console.log(`${ok ? '✅' : '❌'} [${label}] ${r.finalText.slice(0, 110).replace(/\n+/g, ' ')}`)
  }
  console.log(fail === 0 ? '\n🎉 NON-RÉGRESSION OK' : `\n⚠️ ${fail} échec(s)`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
