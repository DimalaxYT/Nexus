/**
 * Mesure précise : TTFB (headers HTTP) vs premier événement SSE.
 * Si les headers n'arrivent qu'avec le 1er chunk de body, tout délai LLM pré-stream
 * expose la requête au timeout "time-to-first-byte" du gateway → 502.
 */
interface Msg { role: 'user' | 'assistant'; content: string }
const BASE = 'http://localhost:3000'

async function measure(label: string, messages: Msg[]) {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal: AbortSignal.timeout(300_000),
  })
  const tHeaders = Date.now() - t0
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let tFirstEvent = -1
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    if (tFirstEvent < 0 && buf.includes('data:')) {
      tFirstEvent = Date.now() - t0
      break // on n'a besoin que du timing
    }
  }
  reader.cancel()
  console.log(`[${label}] headers=${tHeaders}ms  1erÉvénementSSE=${tFirstEvent < 0 ? '>' + tHeaders + 'ms (jamais vu)' : tFirstEvent + 'ms'}`)
}

function filler(n: number): Msg[] {
  const m: Msg[] = []
  for (let i = 0; i < 15; i++) {
    m.push({ role: 'user', content: `Sujet ${i} : ` + 'lorem ipsum dolor sit amet '.repeat(Math.ceil(n / 29)) })
    m.push({ role: 'assistant', content: `Réponse ${i} : ` + 'analyse approfondie du sujet '.repeat(Math.ceil(n / 31)) })
  }
  return m
}

async function main() {
  await measure('petit (2ko)', [{ role: 'user', content: 'Bonjour, qui es-tu ?' }])
  await measure('gros (300ko)', filler(10_000))
  await measure('énorme (900ko)', filler(30_000))
}

main()
