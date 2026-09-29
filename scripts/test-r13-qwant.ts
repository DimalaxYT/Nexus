// Inspection fine de Qwant lite
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function main() {
  const q = await fetch('https://lite.qwant.com/?q=last+video+of+fugu+youtube&t=web', { headers: { 'User-Agent': UA, 'Accept-Language': 'fr-FR,fr;q=0.9' } }).then((r) => r.text())
  // Exclure les liens internes qwant
  const externals = [...q.matchAll(/<a[^>]+href="(https?:\/\/(?!lite\.qwant|about\.qwant|www\.qwant)[^"]+)"[^>]*>([\s\S]{0,400}?)<\/a>/g)]
  console.log('liens externes réels:', externals.length)
  for (const m of externals.slice(0, 5)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    console.log(`→ ${m[1].slice(0, 100)}\n   texte: ${text.slice(0, 140)}`)
  }
  // chercher un conteneur résultat
  for (const marker of ['result', 'Result', 'snippet', 'url', '<li']) {
    const idx = q.indexOf(marker)
    console.log(`marqueur "${marker}" à l'index:`, idx)
  }
  // dump d'un extrait autour du 1er lien externe
  const i = q.search(/https?:\/\/(?!lite\.qwant|about\.qwant|www\.qwant)/)
  if (i > 0) console.log('\n--- extrait HTML autour du 1er lien externe:\n', q.slice(Math.max(0, i - 500), i + 700))
}
main()
