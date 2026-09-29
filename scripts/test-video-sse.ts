// Test SSE : « génère une vidéo de … » → événement video + réponse finale
const BASE = 'http://localhost:3000'

async function main() {
  const res = await fetch(`${BASE}/api/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'génère une vidéo de vagues sur l océan au coucher du soleil' },
      ],
    }),
  })
  if (!res.ok || !res.body) {
    console.error('HTTP', res.status)
    process.exit(1)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let sawVideo = false
  let sawStep = false
  let finalText = ''
  const t0 = Date.now()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const m = line.match(/^data: (.*)$/m)
      if (!m) continue
      try {
        const ev = JSON.parse(m[1])
        if (ev.type === 'step' && ev.tool === 'generate_video') sawStep = true
        if (ev.type === 'video') {
          sawVideo = true
          console.log(`ÉVÉNEMENT video : url=${ev.url} prompt=« ${ev.prompt.slice(0, 50)} »`)
        }
        if (ev.type === 'token') finalText += ev.content
        if (ev.type === 'done') console.log(`done en ${((Date.now() - t0) / 1000).toFixed(1)} s`)
      } catch { /* ignore */ }
    }
  }
  console.log(`step generate_video: ${sawStep ? 'OUI' : 'NON'} · événement video: ${sawVideo ? 'OUI' : 'NON'}`)
  console.log(`Réponse finale (extrait) : ${finalText.slice(0, 220).replace(/\n/g, ' | ')}`)
  if (!sawVideo || !sawStep) process.exit(1)
  console.log('SSE VIDÉO OK ✔')
}
main()
