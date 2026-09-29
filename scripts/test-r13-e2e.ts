// Test e2e round 13 : « regarde la dernière vidéo de fugu » via l'API agent (SSE)
const BASE = 'http://localhost:3000'

async function main() {
  // 1) Lister les agents (trouver PROF YOUTUBE ou un agent de test)
  const res = await fetch(`${BASE}/api/agents`)
  const data = (await res.json()) as { agents?: { id: string; name: string; emoji: string; enabled: boolean }[] }
  const agents = data.agents ?? []
  console.log('agents:', agents.map((a) => `${a.emoji} ${a.name} (${a.id.slice(0, 8)}) enabled=${a.enabled}`).join(' | '))

  // 2) Créer un agent de test dédié (nettoyé ensuite) — évite de dépendre de la team de l'utilisateur
  const created = await fetch(`${BASE}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TEST R13 Prof', emoji: '🎬', role: 'specialiste', description: 'Agent test round 13', prompt: 'Tu es Prof YouTube, passionné de vidéos.', specialties: ['youtube'] }),
  }).then((r) => r.json()) as { agent?: { id: string } }
  const agentId = created.agent?.id
  console.log('agent test créé:', agentId)

  if (!agentId) return

  // 3) Question EXACTE de l'utilisateur à l'agent seul (SSE)
  const t0 = Date.now()
  const sse = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Peux tu regarder la dernière vidéo youtube de fugu et me dire de quoi elle parle?' }],
      target: { kind: 'agent', agentId },
    }),
  })
  console.log('SSE status:', sse.status)

  const reader = sse.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events: { type: string; detail?: string }[] = []
  let finalText = ''
  let currentSpeaker = 'AGENT'
  let nexusBubble = ''
  let inNexus = false

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
        const type = ev.type as string
        if (type === 'step') events.push({ type: `step:${ev.label}`, detail: String(ev.detail) })
        else if (type === 'sources') events.push({ type: 'sources', detail: `${(ev.sources as unknown[]).length} sources` })
        else if (type === 'speaker') {
          currentSpeaker = String(ev.name)
          if (ev.id === 'nexus') inNexus = true
          events.push({ type: 'speaker', detail: String(ev.name) })
        } else if (type === 'token') {
          if (inNexus) nexusBubble += String(ev.content)
          else finalText += String(ev.content)
        } else if (type === 'thought') events.push({ type: 'thought', detail: String(ev.text).slice(0, 100) })
        else if (type === 'done') events.push({ type: 'done' })
        else if (type === 'error') events.push({ type: 'error', detail: String(ev.message) })
      } catch {
        /* partiel */
      }
    }
  }

  console.log(`\n=== événements (${Date.now() - t0} ms) ===`)
  for (const e of events) console.log(`  ${e.type}${e.detail ? ` — ${e.detail}` : ''}`)
  console.log('\n=== réponse AGENT (extrait) ===')
  console.log(finalText.slice(0, 700))
  console.log('\n=== bulle NEXUS (extrait) ===')
  console.log(nexusBubble.slice(0, 700))

  // 4) Nettoyage
  await fetch(`${BASE}/api/agents?id=${agentId}`, { method: 'DELETE' })
  console.log('\nagent test supprimé ✅')
}

main()
