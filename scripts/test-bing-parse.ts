/** Vérifie le parsing réel de Bing + structure HTML de Startpage/Reddit. */
import { webSearch } from '@/lib/brain/search'

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function main() {
  // 1) La fonction bingSearch (via webSearch) renvoie-t-elle des résultats ?
  for (const q of ['roblox luau tutoriel', 'site:youtube.com roblox astuces', 'apprendre programmation jeu vidéo']) {
    const t0 = Date.now()
    const r = await webSearch(q, 6)
    console.log(`webSearch("${q}") → ${r ? r.length : 'null'} en ${Date.now() - t0}ms`)
    if (r) for (const x of r.slice(0, 3)) console.log(`   [${x.domain}] ${x.title.slice(0, 60)} | snip:${x.snippet.slice(0, 60).replace(/\n/g, ' ')}`)
  }

  // 2) Structure du HTML Bing : b_algo présent ?
  const res = await fetch('https://www.bing.com/search?q=roblox+luau+tutoriel&setlang=fr', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' },
  })
  const html = await res.text()
  console.log(`\nBing: ${html.length}o, b_algo=${(html.match(/b_algo/g) ?? []).length}, b_algo lié=${(html.match(/<li class="b_algo"/g) ?? []).length}`)

  // 3) Reddit RSS items
  const rr = await fetch('https://www.reddit.com/search.rss?q=roblox%20luau&limit=5', {
    headers: { 'User-Agent': UA },
  })
  const rss = await rr.text()
  const items = (rss.match(/<entry>/g) ?? []).length
  console.log(`Reddit RSS: ${items} entrées, lien ext=${(rss.match(/<link href="([^"]+)"/g) ?? []).slice(0, 2).join(' , ')}`)
}

main().catch((e) => {
  console.error('ÉCHEC:', e)
  process.exit(1)
})
