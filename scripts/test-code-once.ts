/* Test rapide : l'agent ne doit générer le code QU'UNE SEULE FOIS maintenant */
const BASE = 'http://localhost:3000'

const res = await fetch(`${BASE}/api/agent`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Écris un script Python qui calcule les nombres premiers jusqu\u2019à 100' }] }),
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let codeEvents = 0
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
      if (ev.type === 'code') {
        codeEvents++
        console.log('CODE:', ev.code.files.language, ev.code.files.filename, ev.code.files.js.length, 'chars')
      }
      if (ev.type === 'thought') console.log('THOUGHT:', ev.text)
    } catch {}
  }
}
console.log(`codeEvents=${codeEvents} (attendu: 1), tokens=${tokens}, ${Date.now() - start}ms`)
process.exit(codeEvents === 1 ? 0 : 1)
