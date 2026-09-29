// Probe : résultats site:youtube.com pour différents sujets
import { webSearch } from '../src/lib/brain/search'
import { extractVideoId } from '../src/lib/brain/youtube'

const queries = ['chatbot ia', "chatbot d'ia", 'chatbot intelligence artificielle']
for (const q of queries) {
  const results = (await webSearch(q, 6, 'youtube.com')) ?? []
  console.log(`\n[${q}] ${results.length} résultat(s)`)
  for (const r of results.slice(0, 6)) {
    console.log(`  ${extractVideoId(r.url) ? '🎬' : '🔗'} ${r.title.slice(0, 70)} | ${r.url.slice(0, 70)} | snip:${r.snippet.length}`)
  }
}
