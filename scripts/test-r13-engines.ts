// Test moteurs de repli round 13
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function probe(name: string, url: string, check: (body: string) => boolean, init?: RequestInit): Promise<void> {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 9000)
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7', ...(init?.headers ?? {}) }, redirect: 'follow' })
    clearTimeout(timer)
    const body = await res.text()
    const ok = res.ok && check(body)
    console.log(`${ok ? '✅' : '❌'} ${name} — HTTP ${res.status}, ${body.length} car, ${Date.now() - t0} ms`)
    if (!ok && res.ok) {
      // diag : quels marqueurs présents ?
      const markers = ['b_algo', 'b_no', 'captcha', 'challenge', 'consent', 'b_results', 'result__a', 'web-result', 'searchResults', '<item>', 'g-link']
      const found = markers.filter((m) => body.toLowerCase().includes(m.toLowerCase()))
      console.log(`   marqueurs: ${found.join(', ') || 'aucun'}`)
      const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      if (title) console.log(`   title: ${title.slice(0, 100)}`)
    }
  } catch (e) {
    console.log(`❌ ${name} — ${e instanceof Error ? e.message : 'erreur'} (${Date.now() - t0} ms)`)
  }
}

async function main() {
  await probe('Bing RSS (format=rss)', 'https://www.bing.com/search?q=fugu+youtube&format=rss&setlang=fr', (b) => b.includes('<item>'))
  await probe('Mojeek', 'https://www.mojeek.com/search?q=fugu+youtube', (b) => b.includes('results-standard') || b.includes('<a class="ob"') || b.includes('web-result'))
  await probe('DDG Lite', 'https://lite.duckduckgo.com/lite/?q=fugu+youtube', (b) => b.includes('result-link'))
  await probe('Ecosia', 'https://www.ecosia.org/search?q=fugu+youtube', (b) => b.includes('result') || b.includes('mainline'))
  await probe('Brave', 'https://search.brave.com/search?q=fugu+youtube', (b) => b.includes('snippet'))
  await probe('Marginalia', 'https://api.search.marginalia.nu/search/fugu', (b) => b.length > 10)
  await probe('Wikipedia retry', 'https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=fugu&format=json&srlimit=3', (b) => b.includes('search'))
  await probe('Qwant lite', 'https://lite.qwant.com/?q=fugu+youtube&t=web', (b) => b.includes('result'))
  await probe('Startpage', 'https://www.startpage.com/sp/search?query=fugu+youtube', (b) => b.includes('result'))
  // Bing classique avec paramètres différents
  await probe('Bing count=10 + cookies', 'https://www.bing.com/search?q=fugu+youtube+chaine&count=10&mkt=fr-FR', (b) => b.includes('b_algo'), { headers: { 'Cookie': 'SRCHHPGUSR=SRCHLANG=fr' } })
}

main()
