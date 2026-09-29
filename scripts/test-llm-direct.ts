/** Test direct du SDK LLM : stream + non-stream avec timeouts courts. */
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  console.log('Création ZAI…')
  const zai = await ZAI.create()
  console.log('ZAI créé. Test non-streamé…')
  const t0 = Date.now()
  const completion = await Promise.race([
    zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Réponds en une phrase : qui es-tu ?' }],
      thinking: { type: 'disabled' },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 30s')), 30_000)),
  ]) as { choices?: { message?: { content?: string } }[] }
  console.log(`Non-stream OK en ${Date.now() - t0}ms :`, completion.choices?.[0]?.message?.content?.slice(0, 80))

  console.log('Test streamé…')
  const t1 = Date.now()
  const body = await Promise.race([
    zai.chat.completions.create({
      messages: [{ role: 'user', content: 'Compte de 1 à 5.' }],
      stream: true,
      thinking: { type: 'disabled' },
    }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT 30s')), 30_000)),
  ])
  if (!body || typeof body.getReader !== 'function') {
    console.log('Stream: réponse non streamable', typeof body)
    return
  }
  const reader = body.getReader()
  const dec = new TextDecoder()
  let first = -1
  let n = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (first < 0) {
      first = Date.now() - t1
      console.log(`1er chunk stream en ${first}ms`)
    }
    n += value.length
  }
  console.log(`Stream terminé : ${n} octets en ${Date.now() - t1}ms`)
}

main().catch((e) => {
  console.error('ÉCHEC :', e instanceof Error ? e.message : e)
  process.exit(1)
})
