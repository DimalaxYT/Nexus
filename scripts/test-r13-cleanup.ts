// Nettoyage des résidus de test dans la base de connaissances
const BASE = 'http://localhost:3000'

async function main() {
  const data = (await fetch(`${BASE}/api/knowledge`).then((r) => r.json())) as {
    items?: { id: string; title: string; source: string }[]
  }
  const items = data.items ?? []
  const toRemove = items.filter(
    (it) =>
      it.source === 'agent' &&
      (it.title.includes('JE LANCE UNE RANKED') ||
        it.title.includes('Comment tester') ||
        it.title.includes('Speedtest') ||
        it.title.includes('Fast.com') ||
        it.title.includes('TEST R13') ||
        it.title.includes('Rapport — TEST'))
  )
  console.log(`à supprimer: ${toRemove.length}/${items.length}`)
  for (const it of toRemove) {
    await fetch(`${BASE}/api/knowledge?id=${it.id}`, { method: 'DELETE' })
    console.log('  ✗', it.title.slice(0, 70))
  }
  console.log('nettoyage terminé')
}
main()
