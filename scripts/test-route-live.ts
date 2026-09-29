/** Test SSE progressif de /api/agent : affiche chaque étape au fil de l'eau. */
const BASE = 'http://localhost:3000'

async function main() {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Réponds en une phrase : qui es-tu ?' }] }),
    signal: AbortSignal.timeout(120_000),
  })
  console.log(`HTTP ${res.status} en ${Date.now() - t0}ms`)
  if (!res.ok || !res.body) return
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let tokens = 0
  let pings = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) {
        if (line.startsWith(':')) pings++
        continue
      }
      try {
        const ev = JSON.parse(line.slice(5).trim()) as { type?: string; content?: string }
        if (ev.type === 'ping') pings++
        else if (ev.type === 'token') tokens += (ev.content ?? '').length
        else console.log(`  event: ${ev.type} à ${(Date.now() - t0) / 1000 | 0}s`)
      } catch { /* partiel */ }
    }
    process.stdout.write(`\r t=${((Date.now() - t0) / 1000).toFixed(1)}s pings=${pings} tokens=${tokens}   `)
    if (tokens > 40) {
      console.log(`\nOK — streaming actif (t=${((Date.now() - t0) / 1000).toFixed(1)}s, tokens=${tokens})`)
      reader.cancel()
      return
    }
  }
  console.log(`\nFin du flux : tokens=${tokens} pings=${pings} total=${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

main().catch((e) => {
  console.error('ÉCHEC :', e instanceof Error ? e.message : e)
  process.exit(1)
})
