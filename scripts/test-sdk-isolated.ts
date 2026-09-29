/** Test SDK v3 isolé : web_search d'abord, puis LLM avec backoff (diagnostic 429). */
import ZAI from 'z-ai-web-dev-sdk'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const zai = await ZAI.create()

  // 1) web_search seul
  const t1 = Date.now()
  try {
    const res = (await zai.functions.invoke('web_search', {
      query: 'Roblox Luau scripting tutorial',
      num: 5,
    })) as unknown
    console.log(`web_search OK en ${Date.now() - t1}ms:`, JSON.stringify(res).slice(0, 400))
  } catch (e) {
    console.log(`web_search ÉCHEC (${Date.now() - t1}ms):`, e instanceof Error ? e.message : e)
  }

  // 2) LLM avec backoff : 5 essais max
  for (let attempt = 1; attempt <= 5; attempt++) {
    const t0 = Date.now()
    try {
      const body = (await zai.chat.completions.create({
        messages: [{ role: 'user', content: 'Dis bonjour en une phrase.' }],
        thinking: { type: 'disabled' },
      })) as { choices?: { message?: { content?: string } }[] }
      console.log(
        `LLM OK en ${Date.now() - t0}ms (essai ${attempt}):`,
        body.choices?.[0]?.message?.content?.slice(0, 80)
      )
      return
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`LLM essai ${attempt} ÉCHEC (${Date.now() - t0}ms): ${msg.slice(0, 120)}`)
      if (attempt < 5) await sleep(4000 * attempt)
    }
  }
  console.log('LLM indisponible après 5 essais — le quota chat est saturé.')
}

main().catch((e) => {
  console.error('ÉCHEC GLOBAL :', e instanceof Error ? e.message : e)
  process.exit(1)
})
