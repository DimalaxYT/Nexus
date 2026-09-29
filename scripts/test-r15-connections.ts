// Test e2e round 15 : les bots connectés (mail IMAP réel, TikTok réel)
// + les deux questions capabilities réparées — via l'API agent (SSE)
const BASE = 'http://localhost:3000'

interface SseEvent {
  type: string
  [k: string]: unknown
}

async function runChat(messages: { role: 'user' | 'assistant'; content: string }[], label: string) {
  const t0 = Date.now()
  const sse = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, target: { kind: 'nexus' } }),
  })
  const reader = (sse.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: SseEvent[] = []
  let finalText = ''
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
        const ev = JSON.parse(line.slice(5)) as SseEvent
        if (ev.type === 'token') finalText += String(ev.content ?? '')
        else if (ev.type !== 'done') events.push(ev)
      } catch {
        /* ligne partielle */
      }
    }
  }
  const ms = Date.now() - t0
  console.log(`\n=== ${label} (${(ms / 1000).toFixed(1)} s) ===`)
  for (const ev of events) {
    if (ev.type === 'step') console.log(`  [étape] ${ev.label} — ${ev.detail} (${ev.status})`)
    else if (ev.type === 'thought') console.log(`  [pensée] ${String(ev.text).slice(0, 130)}`)
  }
  console.log(`  [réponse] ${finalText.slice(0, 700).replace(/\n\n+/g, '\n  ')}`)
  return { events, finalText, ms }
}

async function main() {
  // 1) Lecture RÉELLE de la boîte Gmail connectée (IMAP)
  const mail = await runChat([{ role: 'user', content: 'lis ma boîte mail' }], 'TEST 1 — « lis ma boîte mail » (IMAP réel)')
  const mailOk = mail.finalText.includes('mails') || mail.finalText.includes('boîte')
  console.log(`  → ${mailOk ? '✅ réponse boîte mail produite' : '❌ pas de réponse boîte mail'}`)

  // 2) TikTok réel (profil relié @ano1be)
  const tiktok = await runChat([{ role: 'user', content: 'regarde mon tiktok' }], 'TEST 2 — « regarde mon tiktok » (profil réel)')
  const tiktokOk = tiktok.finalText.toLowerCase().includes('tiktok')
  console.log(`  → ${tiktokOk ? '✅ réponse TikTok produite' : '❌ pas de réponse TikTok'}`)

  // 3) Les deux questions capabilities réparées
  const cap1 = await runChat([{ role: 'user', content: 'non mais globalement quels fonctions en plus tu as?' }], 'TEST 3 — « quels fonctions en plus tu as ? »')
  const cap1Ok = cap1.finalText.includes('Voici tout ce que je sais faire') && !cap1.finalText.includes('Noté dans ta base')
  console.log(`  → ${cap1Ok ? '✅ liste des capacités (plus de « Noté dans ta base »)' : '❌ toujours mal routé'}`)

  const cap2 = await runChat([{ role: 'user', content: 'quels est ta dernière mise a jour?' }], 'TEST 4 — « quels est ta dernière mise a jour ? »')
  const cap2Ok = cap2.finalText.includes('Voici tout ce que je sais faire') && !cap2.finalText.includes('Pour lire une page')
  console.log(`  → ${cap2Ok ? '✅ liste des capacités (plus de « Pour lire une page »)' : '❌ toujours mal routé'}`)

  const allOk = mailOk && tiktokOk && cap1Ok && cap2Ok
  console.log(`\n${allOk ? '🎉 TOUS LES TESTS PASSENT' : '⚠️ ÉCHECS DÉTECTÉS'}`)
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
