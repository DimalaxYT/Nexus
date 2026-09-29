/**
 * Test limite : historique MASSIF pour provoquer un dépassement de contexte LLM.
 * Objectif : déterminer si l'échec remonte en HTTP 502 ou en event SSE error.
 */
interface Msg { role: 'user' | 'assistant'; content: string }

const BASE = 'http://localhost:3000'

function makeHugeHistory(turns: number, charsPerTurn: number): Msg[] {
  const msgs: Msg[] = []
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: 'user', content: `Sujet ${i} : ` + 'lorem ipsum dolor sit amet consectetur '.repeat(Math.ceil(charsPerTurn / 41)) })
    msgs.push({ role: 'assistant', content: `Réponse ${i} : ` + 'voici une analyse approfondie du sujet proposé '.repeat(Math.ceil(charsPerTurn / 47)) })
  }
  return msgs
}

async function run(label: string, messages: Msg[]) {
  const size = JSON.stringify({ messages }).length
  const t0 = Date.now()
  try {
    const res = await fetch(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok || !res.body) {
      console.log(`[${label}] payload=${(size / 1024).toFixed(0)}ko → HTTP ${res.status} après ${((Date.now() - t0) / 1000).toFixed(1)}s`)
      return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let chars = 0
    let errEvent = ''
    let firstEventMs = -1
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstEventMs < 0) firstEventMs = Date.now() - t0
      buf += dec.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? ''
      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        try {
          const ev = JSON.parse(line.slice(5).trim()) as { type?: string; content?: string; message?: string }
          if (ev.type === 'token') chars += (ev.content ?? '').length
          if (ev.type === 'error') errEvent = ev.message ?? 'unknown'
        } catch { /* partiel */ }
      }
    }
    console.log(`[${label}] payload=${(size / 1024).toFixed(0)}ko → 200, 1erEvt=${(firstEventMs / 1000).toFixed(1)}s, chars=${chars}, total=${((Date.now() - t0) / 1000).toFixed(1)}s ${errEvent ? `SSE_ERROR="${errEvent}"` : ''}`)
  } catch (e) {
    console.log(`[${label}] payload=${(size / 1024).toFixed(0)}ko → EXCEPTION après ${((Date.now() - t0) / 1000).toFixed(1)}s : ${e instanceof Error ? e.message : e}`)
  }
}

async function main() {
  await run('30 messages × 10k chars (~300ko)', makeHugeHistory(15, 10_000))
  await run('30 messages × 30k chars (~900ko)', makeHugeHistory(15, 30_000))
}

main()
