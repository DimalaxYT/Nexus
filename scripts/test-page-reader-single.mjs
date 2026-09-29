import ZAI from 'z-ai-web-dev-sdk'
const zai = await ZAI.create()
const t0 = Date.now()
try {
  const res = await zai.functions.invoke('page_reader', { url: 'https://example.com' })
  console.log('page_reader OK en', Date.now() - t0, 'ms — title:', res?.data?.title)
} catch (e) {
  console.log('page_reader FAIL en', Date.now() - t0, 'ms —', e.message.slice(0, 120))
}
