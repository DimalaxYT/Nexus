/** Sonde réseau : quels endpoints de recherche sont accessibles depuis ce serveur ? */

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function probe(label: string, url: string, init?: RequestInit, timeout = 6000): Promise<void> {
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7', ...(init?.headers ?? {}) },
      redirect: 'follow',
    })
    const body = await res.text()
    const ok = res.ok && body.length > 100
    console.log(`[${label}] ${res.status} ${body.length}o ${Date.now() - t0}ms ${ok ? 'OK' : 'VIDÉ/BLOQUÉ'}`)
    return
  } catch (e) {
    console.log(`[${label}] ÉCHEC ${Date.now() - t0}ms: ${e instanceof Error ? e.message.slice(0, 60) : e}`)
  } finally {
    clearTimeout(timer)
  }
}

async function main() {
  await probe('GoogleNewsRSS', 'https://news.google.com/rss/search?q=roblox&hl=fr&gl=FR&ceid=FR:fr')
  await probe('BingHTML', 'https://www.bing.com/search?q=roblox+luau')
  await probe('DDG-html', 'https://html.duckduckgo.com/html/?q=roblox+luau')
  await probe('DDG-lite', 'https://lite.duckduckgo.com/lite/?q=roblox+luau')
  await probe('WikipediaAPI', 'https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=roblox&format=json&srlimit=5')
  await probe('RedditRSS', 'https://www.reddit.com/search.rss?q=roblox&limit=10')
  await probe('HNAPI', 'https://hn.algolia.com/api/v1/search?query=roblox')
  await probe('StackExchange', 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=roblox+luau&site=stackoverflow')
  await probe('MojeekHTML', 'https://www.mojeek.com/search?q=roblox+luau')
  await probe('Marginalia', 'https://search.marginalia.nu/search?query=roblox+luau')
  await probe('BraveHTML', 'https://search.brave.com/search?q=roblox+luau')
  await probe('Startpage', 'https://www.startpage.com/sp/search?query=roblox+luau')
  await probe('Ecosia', 'https://www.ecosia.org/search?q=roblox%20luau')
  await probe('Qwant', 'https://api.qwant.com/v3/search/web?q=roblox&count=5&locale=fr_FR')
}

main()
