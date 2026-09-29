// Test réseau round 13 : état des moteurs de recherche + YouTube
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function probe(name: string, url: string, check: (body: string) => boolean): Promise<void> {
  const t0 = Date.now()
  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' }, redirect: 'follow' })
    clearTimeout(timer)
    const body = await res.text()
    const ok = res.ok && check(body)
    console.log(`${ok ? '✅' : '❌'} ${name} — HTTP ${res.status}, ${body.length} car, ${Date.now() - t0} ms`)
  } catch (e) {
    console.log(`❌ ${name} — ${e instanceof Error ? e.message : 'erreur'} (${Date.now() - t0} ms)`)
  }
}

async function main() {
  await probe('Bing', 'https://www.bing.com/search?q=fugu+youtube&setlang=fr', (b) => b.includes('b_algo'))
  await probe('Google News RSS', 'https://news.google.com/rss/search?q=fugu&hl=fr&gl=FR&ceid=FR:fr', (b) => b.includes('<item>'))
  await probe('YouTube search natif', 'https://www.youtube.com/results?search_query=fugu&hl=fr', (b) => b.includes('ytInitialData'))
  await probe('Reddit RSS', 'https://www.reddit.com/search.rss?q=fugu&limit=6', (b) => b.includes('<entry>'))
  await probe('StackExchange', 'https://api.stackexchange.com/2.3/search/advanced?pagesize=3&q=python&site=stackoverflow', (b) => b.includes('items'))
  await probe('HN Algolia', 'https://hn.algolia.com/api/v1/search?query=python&hitsPerPage=3', (b) => b.includes('hits'))
  await probe('Wikipedia API', 'https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=fugu&format=json&srlimit=3', (b) => b.includes('search'))
  await probe('DuckDuckGo HTML', 'https://html.duckduckgo.com/html/?q=fugu+youtube', (b) => b.includes('result'))
  await probe('YouTube oembed', 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json', (b) => b.includes('title'))
}

main()
