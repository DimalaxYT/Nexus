/* Test des nouvelles API NEXUS v1.3 : vidéo, browse, agent (code + thought) */
const BASE = 'http://localhost:3000'

async function testVideoCreate() {
  const res = await fetch(`${BASE}/api/tools/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'a golden retriever running on a beach at sunset, cinematic slow motion', duration: 5, quality: 'speed' }),
  })
  const data = await res.json()
  console.log('VIDEO CREATE:', res.status, JSON.stringify(data).slice(0, 200))
  return data.taskId
}

async function testVideoPoll(taskId) {
  const res = await fetch(`${BASE}/api/tools/video?taskId=${encodeURIComponent(taskId)}`)
  const data = await res.json()
  console.log('VIDEO POLL:', res.status, JSON.stringify(data).slice(0, 300))
  return data
}

async function testBrowse() {
  const res = await fetch(`${BASE}/api/tools/browse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com' }),
  })
  const data = await res.json()
  console.log('BROWSE:', res.status, 'title=', data.title, 'textLen=', (data.text || '').length)
}

async function testAgent(prompt, label) {
  console.log(`\n=== AGENT: ${label} ===`)
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok || !res.body) {
    console.log('AGENT HTTP ERROR:', res.status)
    return
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []
  let tokens = 0
  const start = Date.now()
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
        if (ev.type === 'token') tokens += ev.content.length
        else events.push(`${ev.type}${ev.tool ? ':' + ev.tool : ''}${ev.action ? ':' + ev.action : ''}`)
        if (ev.type === 'code') {
          console.log('  CODE EVENT: language=', ev.code.files.language, 'filename=', ev.code.files.filename, 'codeLen=', ev.code.files.js.length)
        }
        if (ev.type === 'video') console.log('  VIDEO EVENT: url=', ev.url?.slice(0, 100))
        if (ev.type === 'thought') console.log('  THOUGHT:', ev.text)
        if (ev.type === 'error') console.log('  ERROR:', ev.message)
      } catch {}
    }
  }
  console.log(`  events=[${events.join(', ')}] tokens=${tokens} chars, ${Date.now() - start}ms`)
}

;(async () => {
  const taskId = await testVideoCreate()
  if (taskId) {
    const first = await testVideoPoll(taskId)
    // Poll pendant ~90s max pour voir si ça finit
    if (first.status === 'PROCESSING') {
      console.log('...polling vidéo (jusqu\u2019à 100s)...')
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 6500))
        const state = await testVideoPoll(taskId)
        if (state.status !== 'PROCESSING') break
      }
    }
  }
  await testBrowse()
  await testAgent('Écris un script Lua pour Roblox qui fait apparaître une pièce quand on clique sur un bouton', 'generate_code attendu')
})().catch((e) => {
  console.error('TEST FAILURE:', e)
  process.exit(1)
})
