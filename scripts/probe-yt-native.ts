// Probe : recherche native YouTube — ytInitialData accessible ?
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const res = await fetch('https://www.youtube.com/results?search_query=chatbot+intelligence+artificielle&hl=fr', {
  headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
})
const html = await res.text()
console.log('status:', res.status, '| len:', html.length, '| ytInitialData:', html.includes('ytInitialData'))
console.log('videoRenderer:', (html.match(/"videoRenderer":/g) ?? []).length)
// extrait le JSON ytInitialData
const start = html.indexOf('ytInitialData')
const open = html.indexOf('{', start)
let depth = 0, inStr = false, esc = false, end = -1
for (let i = open; i < html.length; i++) {
  const ch = html[i]
  if (esc) { esc = false; continue }
  if (ch === '\\') { esc = true; continue }
  if (ch === '"') inStr = !inStr
  if (inStr) continue
  if (ch === '{') depth++
  if (ch === '}') { depth--; if (depth === 0) { end = i; break } }
}
if (end > 0) {
  const data = JSON.parse(html.slice(open, end + 1))
  // cherche les videoRenderer (récursif)
  const videos = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.videoRenderer) {
      const v = node.videoRenderer
      videos.push({
        id: v.videoId,
        title: v.title?.runs?.[0]?.text?.slice(0, 60),
        channel: v.ownerText?.runs?.[0]?.text?.slice(0, 30),
        length: v.lengthText?.simpleText,
        desc: (v.descriptionSnippet?.runs?.map(r => r.text).join('') ?? '').slice(0, 80),
      })
    }
    for (const k of Object.keys(node)) walk(node[k])
  }
  walk(data)
  console.log('vidéos trouvées:', videos.length)
  for (const v of videos.slice(0, 6)) console.log(' 🎬', v.id, '|', v.title, '|', v.channel, '|', v.length ?? '—', '|', v.desc.slice(0, 60))
}
