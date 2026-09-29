const origFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  const res = await origFetch(...args)
  if (res.status === 429) {
    const h = {}
    res.headers.forEach((v, k) => { if (/rate|retry|limit|reset/i.test(k)) h[k] = v })
    console.log('URL:', String(args[0]).slice(0, 80))
    console.log('429 headers:', JSON.stringify(h))
  }
  return res
}
const ZAI = (await import('z-ai-web-dev-sdk')).default
const zai = await ZAI.create()
try {
  await zai.chat.completions.create({ messages: [{ role: 'user', content: 'OK' }], thinking: { type: 'disabled' } })
  console.log('LLM OK — limite levée')
} catch {}
