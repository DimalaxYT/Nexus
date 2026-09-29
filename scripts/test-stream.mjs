// Test du format SSE renvoyé par le SDK en mode stream:true
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const t0 = Date.now()
  const body = await zai.chat.completions.create({
    messages: [
      { role: 'assistant', content: 'Tu réponds en français, brièvement.' },
      { role: 'user', content: 'Compte de 1 à 5.' },
    ],
    stream: true,
    thinking: { type: 'disabled' },
  })

  console.log('Type retourné:', body?.constructor?.name, '| première latence ms:', Date.now() - t0)

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let events = 0
  let firstTokenAt = 0
  let raw = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!firstTokenAt) firstTokenAt = Date.now() - t0
    buffer += decoder.decode(value, { stream: true })
    // on garde les 8 premières lignes brutes pour inspecter le format
    if (events < 8) {
      raw += buffer
    }
    events++
  }
  console.log('Blocs réseau lus:', events, '| premier token après ms:', firstTokenAt)
  console.log('--- ÉCHANTILLON BRUT ---')
  console.log(raw.slice(0, 1200))
}

main().catch((e) => {
  console.error('ERREUR', e)
  process.exit(1)
})
