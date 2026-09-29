// ─── Tests réels Round 12 : Bureau transparent, rédacteur, propositions, connexions ───
const BASE = 'http://localhost:3000'

async function sse(path, body, onEvent, maxMs = 90_000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), maxMs)
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
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
        events.push(ev)
        onEvent?.(ev)
      } catch {}
    }
  }
  clearTimeout(timer)
  return events
}

async function main() {
  console.log('═══ TEST 1 : agent rédacteur (writer) + bureau transparent ═══')
  // Crée 2 agents de test : un rédacteur "Franch" + un chercheur
  const dels = []
  for (const a of [{ name: 'TEST Franch', emoji: '📝', role: 'redacteur' }, { name: 'TEST Lou', emoji: '🔬', role: 'chercheur' }]) {
    const res = await fetch(`${BASE}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...a, description: 'agent de test', prompt: 'Tu réponds en une phrase complète.', writer: a.role === 'redacteur' }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error('création agent: ' + JSON.stringify(data))
    dels.push(data.agent.id)
    console.log(`  agent créé: ${data.agent.name} writer=${data.agent.writer}`)
  }

  // Groupe de test avec les 2 agents
  const gres = await fetch(`${BASE}/api/agents/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TEST Bureau', emoji: '🏛️', members: dels }),
  })
  const gdata = await gres.json()
  if (!gres.ok) throw new Error('création groupe: ' + JSON.stringify(gdata))
  const groupId = gdata.group?.id ?? gdata.id
  console.log(`  groupe créé: ${groupId}`)

  // Bureau du groupe → doit contenir deliberation + speaker rédacteur + réponse
  console.log('\n  → Question au Bureau (Faisons un plan pour un site de pizzeria)…')
  const events = await sse('/api/agent', { messages: [{ role: 'user', content: 'Faisons un plan pour un site de pizzeria' }], target: { kind: 'bureau', groupId } }, (ev) => {
    if (ev.type === 'deliberation') console.log(`  [deliberation] ${ev.entries.length} contributions, longueurs: ${ev.entries.map((e) => e.text.length).join(',')}`)
    if (ev.type === 'speaker') console.log(`  [speaker] ${ev.emoji} ${ev.name}`)
    if (ev.type === 'step') console.log(`  [step] ${ev.label} — ${ev.detail} (${ev.status})`)
  })
  const delib = events.find((e) => e.type === 'deliberation')
  const speakers = events.filter((e) => e.type === 'speaker')
  const tokens = events.filter((e) => e.type === 'token').map((e) => e.content).join('')
  console.log(`  événements: ${events.length} · speakers: ${speakers.map((s) => s.name).join(', ')}`)
  console.log(`  délibération présente: ${Boolean(delib)}`)
  if (delib) {
    const leak = delib.entries.some((e) => /\[Suivi|\[Ta dernière réponse/.test(e.text))
    console.log(`  fuite méta-commentaire dans contributions: ${leak ? '❌ OUI' : '✅ non'}`)
    console.log(`  exemple contribution: « ${delib.entries[0]?.text.slice(0, 140)}… »`)
  }
  console.log(`  réponse finale (300 premiers car): « ${tokens.slice(0, 300)} »`)
  console.log(`  phrase finale complète: ${/[.!?…]["'»”)]?$/.test(tokens.trim()) ? '✅' : '⚠️'} `)

  console.log('\n═══ TEST 2 : proposition de code (agent + currentCode) ═══')
  const propEvents = await sse(
    '/api/agent',
    {
      messages: [
        { role: 'user', content: 'voici mon code: compte à rebours' },
        { role: 'assistant', content: 'Voici ton code actuel.' },
        { role: 'user', content: 'améliore le code : ajoute un bouton pause et des commentaires' },
      ],
      target: { kind: 'agent', agentId: dels[1] },
      currentCode: { html: '<div id="cpt">10</div>', css: '#cpt{font-size:2rem}', js: 'let n=10;\nsetInterval(()=>{n--;document.getElementById("cpt").textContent=n;},1000);' },
    },
    (ev) => {
      if (ev.type === 'proposal') console.log(`  [proposal] ${ev.proposal.agentEmoji} ${ev.proposal.agentName} — ${ev.proposal.title}`)
      if (ev.type === 'step') console.log(`  [step] ${ev.label} — ${ev.detail} (${ev.status})`)
    },
    120_000
  )
  const proposal = propEvents.find((e) => e.type === 'proposal')?.proposal
  const codeArtifact = propEvents.find((e) => e.type === 'code')
  console.log(`  proposal émise: ${Boolean(proposal)} · code direct émis (interdit en mode proposition): ${Boolean(codeArtifact) ? '❌' : '✅ non'}`)
  if (proposal) {
    console.log(`  base js: ${JSON.stringify(proposal.base.js.slice(0, 60))}`)
    console.log(`  proposé js contient "pause": ${/pause/i.test(proposal.proposed.js) ? '✅' : '⚠️ pas vu'} (${proposal.proposed.js.length} car)`)
  }

  console.log('\n═══ TEST 3 : connexions — GitHub token bidon (doit échouer proprement) ═══')
  const cRes = await fetch(`${BASE}/api/connections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'github', handle: '', secret: 'ghp_FAKE_TOKEN_FOR_TEST_123456' }),
  })
  const cData = await cRes.json()
  console.log(`  status HTTP: ${cRes.status} · ok: ${cData.ok} · handle: ${cData.connection?.handle} · note: ${cData.connection?.note?.slice(0, 90)}`)
  const listRes = await fetch(`${BASE}/api/connections`)
  const list = await listRes.json()
  console.log(`  connexions enregistrées: ${list.connections.length} · secret masqué: ${list.connections[0]?.secretMask}`)

  console.log('\n═══ TEST 4 : recherche vidéos (fugu) — variantes + YouTube natif ═══')
  const ytEvents = await sse(
    '/api/agent',
    { messages: [{ role: 'user', content: 'regarde la dernière vidéo de fugu et dis moi de quoi elle parle' }] },
    (ev) => {
      if (ev.type === 'step' && ev.tool === 'web_search') console.log(`  [step] ${ev.label}: ${ev.detail} (${ev.status})`)
      if (ev.type === 'sources') console.log(`  [sources] ${ev.sources.length} sources: ${ev.sources.slice(0, 3).map((s) => s.domain).join(', ')}`)
    },
    120_000
  )
  const ytText = ytEvents.filter((e) => e.type === 'token').map((e) => e.content).join('')
  console.log(`  réponse: « ${ytText.slice(0, 350)} »`)

  console.log('\n═══ NETTOYAGE ═══')
  await fetch(`${BASE}/api/connections?id=${list.connections[0]?.id ?? 'x'}`, { method: 'DELETE' })
  await fetch(`${BASE}/api/agents/groups?id=${groupId}`, { method: 'DELETE' })
  for (const id of dels) await fetch(`${BASE}/api/agents?id=${id}`, { method: 'DELETE' })
  console.log('  agents, groupe et connexion de test supprimés')
}

main().catch((err) => {
  console.error('ÉCHEC:', err.message)
  process.exit(1)
})
