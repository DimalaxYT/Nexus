// Test de la fonction page_reader du SDK
import ZAI from 'z-ai-web-dev-sdk'

async function main() {
  const zai = await ZAI.create()
  const t0 = Date.now()
  const res = await zai.functions.invoke('page_reader', { url: 'https://example.com' })
  console.log('Latence:', Date.now() - t0, 'ms')
  console.log('code:', res?.code, '| status:', res?.status, '| title:', res?.data?.title)
  const html = res?.data?.html ?? ''
  console.log('Taille HTML:', html.length)
  console.log('Extrait:', html.slice(0, 300).replace(/\n/g, ' '))
}

main().catch((e) => {
  console.error('ERREUR', e?.message ?? e)
  process.exit(1)
})
