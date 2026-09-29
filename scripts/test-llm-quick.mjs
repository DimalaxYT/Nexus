import ZAI from 'z-ai-web-dev-sdk'
const zai = await ZAI.create()
const t0 = Date.now()
try {
  const c = await zai.chat.completions.create({ messages: [{ role: 'user', content: 'Réponds juste: OK' }], thinking: { type: 'disabled' } })
  console.log('LLM OK en', Date.now() - t0, 'ms —', c.choices[0]?.message?.content?.slice(0, 30))
} catch (e) {
  console.log('LLM FAIL:', e.message.slice(0, 100))
}
