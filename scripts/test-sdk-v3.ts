/** Test SDK v3 : LLM stream + web_search + page_reader (timing). */
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()

  // 1) LLM streamé — TTFB
  const t0 = Date.now()
  const body = (await zai.chat.completions.create({
    messages: [{ role: 'user', content: 'Dis bonjour en une phrase.' }],
    stream: true,
    thinking: { type: 'disabled' },
  })) as unknown as ReadableStream
  const reader = (body as ReadableStream).getReader()
  const dec = new TextDecoder()
  let first = -1
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (first < 0) first = Date.now() - t0
    text += dec.decode(value, { stream: true })
  }
  console.log(`LLM stream: TTFB=${first}ms, total=${Date.now() - t0}ms, extrait=${text.replace(/\n/g, ' ').slice(0, 100)}`)

  // 2) web_search
  const t1 = Date.now()
  try {
    const res = (await zai.functions.invoke('web_search', {
      query: 'Roblox Luau scripting tutorial',
      num: 5,
    })) as unknown
    console.log(`web_search OK en ${Date.now() - t1}ms:`, JSON.stringify(res).slice(0, 300))
  } catch (e) {
    console.log(`web_search ÉCHEC (${Date.now() - t1}ms):`, e instanceof Error ? e.message : e)
  }

  // 3) web_search avec filtre site:youtube.com
  const t2 = Date.now()
  try {
    const res = (await zai.functions.invoke('web_search', {
      query: 'site:youtube.com apprendre scripting roblox luau',
      num: 5,
    })) as unknown
    console.log(`web_search youtube OK en ${Date.now() - t2}ms:`, JSON.stringify(res).slice(0, 300))
  } catch (e) {
    console.log(`web_search youtube ÉCHEC:`, e instanceof Error ? e.message : e)
  }
}

main().catch((e) => {
  console.error('ÉCHEC GLOBAL :', e instanceof Error ? e.message : e)
  process.exit(1)
})
