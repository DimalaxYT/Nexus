/** Diagnostic : ce que renvoie webSearch pour chaque source d'une mission. */
import { webSearch } from '@/lib/brain/search'

async function show(label: string, q: string, site?: string) {
  const t0 = Date.now()
  const r = await webSearch(q, 6, site)
  console.log(`\n[${label}] (${Date.now() - t0}ms) ${r ? r.length : 'null'} résultats`)
  if (r) {
    for (const x of r.slice(0, 4)) {
      console.log(`  • [${x.domain}] ${x.title.slice(0, 70)}`)
      console.log(`    snippet(${x.snippet.length}): ${x.snippet.slice(0, 110).replace(/\n/g, ' ')}`)
    }
  }
}

async function main() {
  await show('google', 'techniques de scripting Luau pour débutants')
  await show('youtube', 'techniques de scripting Luau pour débutants tutoriel', 'youtube.com')
  await show('tiktok', 'astuces game design Roblox', 'tiktok.com')
  await show('ai', 'astuces game design Roblox IA ChatGPT astuces')
}

main().catch((e) => {
  console.error('ÉCHEC:', e)
  process.exit(1)
})
