/** Test des outils save_knowledge / search_knowledge + CRUD /api/knowledge */
const BASE = 'http://localhost:3000'

async function agent(text: string): Promise<{ tools: string[]; chars: number; events: string[] }> {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: text }] }),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let chars = 0
  const tools: string[] = []
  const events: string[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data:')) continue
      try {
        const ev = JSON.parse(line.slice(5).trim()) as { type?: string; tool?: string; content?: string; title?: string }
        if (ev.type === 'token') chars += (ev.content ?? '').length
        else if (ev.type === 'step' && ev.status === 'running') tools.push(`${ev.tool}(${ev.title ?? ''})`)
        else if (ev.type !== 'ping' && ev.type !== 'token' && ev.type !== 'step') events.push(ev.type + (ev.title ? `:${ev.title}` : ''))
      } catch { /* partiel */ }
    }
  }
  return { tools, chars, events }
}

async function main() {
  // 1. CRUD direct
  console.log('── CRUD /api/knowledge ──')
  const created = await fetch(`${BASE}/api/knowledge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test Roblox Luau',
      content: 'Luau est le langage de script de Roblox, dérivé de Lua 5.1 avec typage graduel.',
      category: 'Programmation/Roblox',
      tags: ['roblox', 'lua'],
      links: [],
    }),
  })
  const createdData = (await created.json()) as { item?: { id: string } }
  console.log(`POST → ${created.status} id=${createdData.item?.id}`)

  const search = await fetch(`${BASE}/api/knowledge?q=luau`)
  const searchData = (await search.json()) as { items: unknown[] }
  console.log(`GET ?q=luau → ${search.status}, ${searchData.items.length} résultat(s)`)

  // 2. Agent : recherche dans la base (déclenche search_knowledge)
  console.log('── Agent : « que sais-tu sur luau ? » ──')
  const r1 = await agent('Que sais-tu sur luau dans ma base de connaissances ?')
  console.log(`outils: ${r1.tools.join(', ') || 'aucun'} | events: ${r1.events.join(', ') || '—'} | chars=${r1.chars}`)

  // 3. Agent : sauvegarde (déclenche save_knowledge)
  console.log('── Agent : « retiens ça » ──')
  const r2 = await agent("Retiens ça dans ta base de connaissances : le projet NEXUS de l'utilisateur utilise Next.js 16 et Prisma avec SQLite.")
  console.log(`outils: ${r2.tools.join(', ') || 'aucun'} | events: ${r2.events.join(', ') || '—'} | chars=${r2.chars}`)

  const after = await fetch(`${BASE}/api/knowledge`)
  const afterData = (await after.json()) as { items: { title: string; source: string; category: string }[] }
  console.log(`Notes en base : ${afterData.items.length}`)
  afterData.items.forEach((k) => console.log(`  - « ${k.title} » [${k.category}] source=${k.source}`))

  // Nettoyage
  if (createdData.item?.id) {
    await fetch(`${BASE}/api/knowledge?id=${createdData.item.id}`, { method: 'DELETE' })
    console.log('Note de test supprimée')
  }
}

main().catch((e) => {
  console.error('ÉCHEC :', e instanceof Error ? e.message : e)
  process.exit(1)
})
