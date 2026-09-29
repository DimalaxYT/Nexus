/* eslint-disable @typescript-eslint/no-require-imports */
// Test réel Round 11 : table ronde parallèle, BUREAU, codeur restreint, suivi contextuel
const BASE = process.env.BASE || 'http://127.0.0.1:3111'

async function jfetch(path, opts) {
  const res = await fetch(BASE + path, opts)
  const text = await res.text()
  try {
    return { status: res.status, data: JSON.parse(text) }
  } catch {
    return { status: res.status, data: text.slice(0, 300) }
  }
}

async function runSse(label, target, messages) {
  const t0 = Date.now()
  const res = await fetch(BASE + '/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, ...(target ? { target } : {}) }),
  })
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  let done = false
  while (!done) {
    const { done: d, value } = await reader.read()
    if (d) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      try {
        const ev = JSON.parse(line.slice(5).trim())
        events.push(ev)
        if (ev.type === 'done') done = true
      } catch {}
    }
  }
  const ms = Date.now() - t0
  console.log(`\n===== ${label} (${ms} ms) =====`)
  for (const ev of events) {
    if (ev.type === 'token') process.stdout.write(ev.content)
    else if (ev.type === 'speaker') console.log(`\n[SPEAKER] ${ev.emoji} ${ev.name} (${ev.id})`)
    else if (ev.type === 'thought') console.log(`\n[THOUGHT] ${ev.text.slice(0, 110)}`)
    else if (ev.type === 'step') console.log(`\n[STEP ${ev.status}] ${ev.label} — ${ev.detail}`)
    else if (ev.type === 'error') console.log(`\n[ERROR] ${ev.message}`)
    else if (ev.type === 'meta') console.log(`\n[META] ${JSON.stringify(ev)}`)
  }
  console.log(`\n[/fin ${label}] total events: ${events.length}`)
  return { events, ms }
}

async function main() {
  console.log('BASE =', BASE)

  // 0. Resolve follow-up : test unitaire de la logique (import du module compilé impossible
  //    ici → on valide via le comportement SSE au tour 2 ci-dessous)

  // 1. Créer des agents de test (codeur + chercheur) et un groupe
  const mk = await jfetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TestCodeur',
      emoji: '💠',
      role: 'codeur',
      description: 'agent de test',
      prompt: 'Tu es TestCodeur, tu codes vite et propre.',
      color: '#38bdf8',
      specialties: ['code'],
    }),
  })
  const mk2 = await jfetch('/api/agents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TestScout',
      emoji: '🔎',
      role: 'chercheur',
      description: 'agent de test',
      prompt: 'Tu es TestScout, chercheur infatigable.',
      color: '#fbbf24',
    }),
  })
  const codeurId = mk.data?.agent?.id
  const scoutId = mk2.data?.agent?.id
  console.log('agents créés:', { codeurId, scoutId })

  // 2. Groupe de test
  const grp = await jfetch('/api/agents/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'TestGroupe', emoji: '🧪', color: '#a78bfa', members: [codeurId, scoutId].filter(Boolean) }),
  })
  const groupId = grp.data?.group?.id
  console.log('groupe créé:', groupId)

  // 3. NEXUS solo (non-régression : salutation instantanée)
  await runSse('NEXUS solo — bonjour', null, [{ role: 'user', content: 'bonjour' }])

  // 4. Suivi contextuel : tour 1 pose le sujet, tour 2 « réalise-le »
  const tour1 = [
    { role: 'user', content: 'Je veux un script Python qui trie mes fichiers par extension dans des dossiers.' },
    { role: 'assistant', content: "Très bon projet ! Je te propose un script Python qui parcourt ton dossier, détecte l'extension de chaque fichier et le déplace dans un sous-dossier du même nom (Images/, Documents/…). Dis-moi « réalise-le » quand tu veux le code complet." },
  ]
  await runSse('Suivi contextuel — « réalise-le » (tour 2)', null, [...tour1, { role: 'user', content: 'réalise-le' }])

  // 5. Codeur seul : sa réponse (persona + restriction d'outils)
  if (codeurId) {
    await runSse('Agent codeur seul', { kind: 'agent', agentId: codeurId }, [{ role: 'user', content: 'code-moi un jeu de devinettes en Python' }])
  }

  // 6. Table ronde (groupe) : speakers + replay rapide
  if (groupId) {
    await runSse('Table ronde groupe', { kind: 'group', groupId }, [{ role: 'user', content: 'Quelle est la meilleure façon d apprendre Python ?' }])
  }

  // 7. BUREAU : UNE seule réponse consolidée (aucun speaker avant la fin)
  const bureau = await runSse('BUREAU — toute l équipe', { kind: 'bureau' }, [{ role: 'user', content: 'Faut-il apprendre Python ou JavaScript en 2026 ?' }])
  const speakersInBureau = bureau.events.filter((e) => e.type === 'speaker')
  console.log(`\n>>> BUREAU: ${speakersInBureau.length} événement(s) speaker (attendu : 0)`)

  // 8. BUREAU d'un groupe
  if (groupId) {
    await runSse('BUREAU groupe', { kind: 'bureau', groupId }, [{ role: 'user', content: 'Donnez-moi un plan pour créer un jeu Roblox en 7 jours.' }])
  }

  // 9. Nettoyage
  for (const id of [codeurId, scoutId].filter(Boolean)) {
    await jfetch(`/api/agents?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }
  if (groupId) await jfetch(`/api/agents/groups?id=${encodeURIComponent(groupId)}`, { method: 'DELETE' })
  console.log('\nNettoyage effectué.')
}

main().catch((e) => {
  console.error('ÉCHEC:', e)
  process.exit(1)
})
