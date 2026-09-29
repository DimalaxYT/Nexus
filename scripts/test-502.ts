/**
 * Test de reproduction du bug 502 : conversation longue.
 * Simule une conversation qui grandit et mesure quand /api/agent échoue.
 */
const BASE = 'http://localhost:3000'

interface Msg { role: 'user' | 'assistant'; content: string }

function makeLongHistory(turns: number, fillerLen: number): Msg[] {
  const msgs: Msg[] = []
  for (let i = 0; i < turns; i++) {
    msgs.push({ role: 'user', content: `Question ${i} : explique-moi en détail le sujet numéro ${i}. ` + 'x'.repeat(fillerLen) })
    msgs.push({ role: 'assistant', content: `Voici une réponse détaillée à la question ${i}. ` + 'y'.repeat(fillerLen * 2) })
  }
  return msgs
}

async function callAgent(messages: Msg[], label: string): Promise<{ ok: boolean; status: number; ms: number; firstTokenMs: number; chars: number; err?: string }> {
  const t0 = Date.now()
  let firstTokenMs = -1
  let chars = 0
  let status = 0
  try {
    const res = await fetch(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(180_000),
    })
    status = res.status
    if (!res.ok || !res.body) {
      return { ok: false, status, ms: Date.now() - t0, firstTokenMs, chars, err: `HTTP ${res.status}` }
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstTokenMs < 0) firstTokenMs = Date.now() - t0
      buf += dec.decode(value, { stream: true })
      for (const part of buf.split('\n\n')) {
        const line = part.trim()
        if (line.startsWith('data:')) {
          try {
            const ev = JSON.parse(line.slice(5).trim()) as { type?: string; content?: string; message?: string }
            if (ev.type === 'token') chars += (ev.content ?? '').length
            if (ev.type === 'error') return { ok: false, status, ms: Date.now() - t0, firstTokenMs, chars, err: `SSE error: ${ev.message}` }
          } catch { /* partiel */ }
        }
      }
      buf = buf.split('\n\n').pop() ?? ''
    }
    return { ok: chars > 0, status, ms: Date.now() - t0, firstTokenMs, chars, err: chars === 0 ? 'réponse vide' : undefined }
  } catch (e) {
    return { ok: false, status, ms: Date.now() - t0, firstTokenMs, chars, err: e instanceof Error ? e.message : String(e) }
  }
}

async function main() {
  // Ne pas appeler de outils : utiliser des phrases neutres (fast-path)
  const scenarios: { label: string; msgs: Msg[] }[] = [
    { label: '6 messages (~3 échanges, court)', msgs: makeLongHistory(3, 200) },
    { label: '12 messages (~6 échanges)', msgs: makeLongHistory(6, 400) },
    { label: '24 messages (~12 échanges)', msgs: makeLongHistory(12, 600) },
    { label: '40 messages (~20 échanges, long)', msgs: makeLongHistory(20, 900) },
    { label: '60 messages (~30 échanges, très long)', msgs: makeLongHistory(30, 1200) },
  ]
  for (const s of scenarios) {
    const size = JSON.stringify({ messages: s.msgs }).length
    const r = await callAgent(s.msgs, s.label)
    console.log(`[${s.label}] payload=${(size / 1024).toFixed(1)}ko → ${r.ok ? 'OK' : 'ÉCHEC'} status=${r.status} total=${(r.ms / 1000).toFixed(1)}s 1erEvt=${(r.firstTokenMs / 1000).toFixed(1)}s chars=${r.chars} ${r.err ?? ''}`)
  }
}

main()
