/**
 * Vérification anti-502 : les headers + le ping SSE doivent arriver INSTANTANÉMENT,
 * même avec un historique massif. Puis test des nouveaux outils knowledge.
 */
interface Msg { role: 'user' | 'assistant'; content: string }
const BASE = 'http://localhost:3000'

async function measureTTFB(label: string, messages: Msg[]) {
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
  let chars = 0
  let eventType = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    if (tFirstEvent < 0 && buf.includes('data:')) {
      tFirstEvent = Date.now() - t0
      eventType = buf.slice(buf.indexOf('data:') + 5, buf.indexOf('data:') + 60).trim()
    }
    for (const part of buf.split('\n\n')) {
      const line = part.trim()
      if (line.startsWith('data:')) {
        try {
          const ev = JSON.parse(line.slice(5).trim()) as { type?: string; content?: string }
          if (ev.type === 'token') chars += (ev.content ?? '').length
        } catch { /* partiel */ }
      }
    }
    buf = buf.split('\n\n').pop() ?? ''
    if (tFirstEvent > 0 && chars > 20) break // suffit pour valider
  }
  reader.cancel()
  console.log(`[${label}] headers=${tHeaders}ms ping/1erEvent=${tFirstEvent}ms (${eventType.slice(0, 40)}…) charsReçus=${chars}`)
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
  await measureTTFB('courte (2ko)', [{ role: 'user', content: 'Bonjour, présente-toi en une phrase.' }])
  await measureTTFB('gros 300ko (avant: headers à 10s)', filler(10_000))
  await measureTTFB('énorme 900ko (avant: headers à 34s)', filler(30_000))
}

main()
