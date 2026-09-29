// Test e2e round 15 bis : agent SEUL lit la boîte mail (pré-chargement déterministe)
const BASE = 'http://localhost:3000'

async function main() {
  // 1) Créer un agent de test « secrétaire »
  const created = (await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TEST R15 Secrétaire',
      emoji: '📬',
      role: 'analyste',
      description: 'Agent test round 15 — accès mail',
      prompt: 'Tu es le secrétaire numérique de ton créateur : tu lis sa boîte mail et tu résumes ce qui compte.',
      specialties: ['mail', 'organisation'],
    }),
  }).then((r) => r.json())) as { agent?: { id: string } }
  const agentId = created.agent?.id
  console.log('agent test créé:', agentId)
  if (!agentId) return

  try {
    // 2) Lui demander de lire la boîte mail (SSE)
    const t0 = Date.now()
    const sse = await fetch(`${BASE}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'lis ma boîte mail et dis-moi ce qui mérite mon attention' }],
        target: { kind: 'agent', agentId },
      }),
    })
    const reader = (sse.body as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let finalText = ''
    const steps: string[] = []
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
          else if (ev.type === 'step') steps.push(`${ev.label} — ${ev.detail} (${ev.status})`)
        } catch {
          /* partiel */
        }
      }
    }
    const ms = Date.now() - t0
    console.log(`\n=== AGENT SEUL — « lis ma boîte mail » (${(ms / 1000).toFixed(1)} s) ===`)
    for (const s of steps) console.log('  [étape]', s)
    console.log('  [réponse]', finalText.slice(0, 700).replace(/\n\n+/g, '\n  '))
    const ok = steps.some((s) => s.includes('mail') && s.includes('done')) && finalText.length > 80
    console.log(`  → ${ok ? '✅ l\'agent a LU la vraie boîte mail' : '❌ échec lecture par agent'}`)
    process.exit(ok ? 0 : 1)
  } finally {
    // 3) Nettoyage de l'agent de test
    await fetch(`${BASE}/api/agents?id=${encodeURIComponent(agentId)}`, { method: 'DELETE' })
    console.log('\n(agent test supprimé)')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
