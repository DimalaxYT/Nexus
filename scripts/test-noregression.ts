// Non-régression : visionnage YouTube, image, scène 3D (chemins existants)
const BASE = 'http://localhost:3000'

async function chat(message: string): Promise<{ events: Map<string, number>; text: string; secs: number }> {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: message }] }),
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const events = new Map<string, number>()
  let text = ''
  const t0 = Date.now()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const p of parts) {
      const m = p.match(/^data: (.*)$/m)
      if (!m) continue
      try {
        const ev = JSON.parse(m[1])
        events.set(ev.type, (events.get(ev.type) ?? 0) + 1)
        if (ev.type === 'token') text += ev.content
      } catch { /* ignore */ }
    }
  }
  return { events, text, secs: (Date.now() - t0) / 1000 }
}

async function main() {
  // 1. Visionnage YouTube (ne doit PAS générer de vidéo)
  const yt = await chat('regarde la dernière vidéo de fugu et dis moi de quoi elle parle')
  const ytUrl = [...eventsOf(yt)].includes('video')
  console.log(`1. VISIONNAGE fugu : ${yt.secs.toFixed(1)}s · événements=${[...eventsOf(yt)].join(',')} · video généré=${ytUrl ? 'OUI (BUG!)' : 'non'}`)
  console.log(`   Extrait : ${yt.text.slice(0, 150).replace(/\n/g, ' | ')}`)

  // 2. Image
  const img = await chat('génère une image de montagnes enneigées')
  console.log(`2. IMAGE : ${img.secs.toFixed(1)}s · image=${img.events.get('image') ?? 0}`)

  // 3. Scène 3D sous-marine (nouveau thème via chat)
  const sc = await chat('crée une scène 3D sous-marine avec des poissons')
  console.log(`3. SCÈNE : ${sc.secs.toFixed(1)}s · scene=${sc.events.get('scene') ?? 0}`)
  console.log(`   Extrait : ${sc.text.slice(0, 130).replace(/\n/g, ' | ')}`)
}
function eventsOf(r: { events: Map<string, number> }): string[] {
  return [...r.events.keys()]
}
main()
