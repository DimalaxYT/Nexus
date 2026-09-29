// Inspection structure Qwant lite + Bing avec cookie
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function main() {
  // Qwant lite
  const q = await fetch('https://lite.qwant.com/?q=fugu+youtube&t=web', { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' } }).then((r) => r.text())
  console.log('=== QWANT LITE ===')
  // trouver un bloc résultat
  const linkMatch = q.match(/<a[^>]+href="(https?:(?!lite\.qwant)[^"]+)"[^>]*>/g)
  console.log('liens externes trouvés:', linkMatch?.length ?? 0)
  const firstBlock = q.match(/<a[\s\S]{0,400}?https?:\/\/(?!(?:lite\.)?qwant)[^"]+[\s\S]{0,600}?<\/a>/)
  if (firstBlock) console.log('--- premier bloc résultat:\n', firstBlock[0].slice(0, 900))
  // structure des titres
  const h2 = q.match(/<h2[^>]*>[\s\S]{0,200}?<\/h2>/g)
  console.log('h2:', h2?.slice(0, 2))
  const h3 = q.match(/<h3[^>]*>[\s\S]{0,300}?<\/h3>/g)
  console.log('h3:', h3?.slice(0, 2))
  const rel = [...q.matchAll(/<a[^>]+rel="([^"]*)"[^>]*href="(https?:\/\/[^"]+)"/g)].slice(0, 3)
  console.log('a rel+href:', rel.map((m) => `${m[1]} → ${m[2].slice(0, 80)}`))
  const cls = [...q.matchAll(/class="(result[^"]*|web[^"]*)"/gi)].slice(0, 8)
  console.log('classes result:', cls.map((m) => m[1]))

  console.log('\n=== BING avec cookie ===')
  const b = await fetch('https://www.bing.com/search?q=super+Mario+brothers+wonder&count=10&mkt=fr-FR', {
    headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9', Cookie: 'SRCHHPGUSR=SRCHLANG=fr' },
  }).then((r) => r.text())
  const nbAlgo = (b.match(/<li class="b_algo"/g) ?? []).length
  console.log('b_algo count:', nbAlgo)
  const first = b.split('<li class="b_algo"')[1]
  if (first) {
    const h2 = first.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    console.log('1er résultat:', h2 ? `${h2[2].replace(/<[^>]+>/g, '').slice(0, 80)} → ${h2[1].slice(0, 90)}` : 'parse KO')
    const cite = first.match(/<cite[^>]*>([\s\S]*?)<\/cite>/)?.[1]
    console.log('cite:', cite?.slice(0, 100))
  }
}

main()
