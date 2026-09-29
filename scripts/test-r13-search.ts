// Test du webSearch renforcé (round 13)
import { webSearch } from '../src/lib/brain/search'

async function main() {
  const t0 = Date.now()
  const r1 = await webSearch('chatbot ia 2026', 6)
  console.log(`[1] « chatbot ia 2026 » → ${r1?.length ?? 'null'} résultats en ${Date.now() - t0} ms`)
  if (r1) for (const r of r1.slice(0, 4)) console.log(`   - ${r.domain} : ${r.title.slice(0, 60)}`)

  const t1 = Date.now()
  const r2 = await webSearch('fugu', 6, 'youtube.com')
  console.log(`[2] « fugu » site:youtube.com → ${r2?.length ?? 'null'} résultats en ${Date.now() - t1} ms`)
  if (r2) for (const r of r2.slice(0, 4)) console.log(`   - ${r.domain} : ${r.title.slice(0, 60)}`)

  const t2 = Date.now()
  const r3 = await webSearch('warhammer 40000 espace marine', 5)
  console.log(`[3] « warhammer 40000 espace marine » → ${r3?.length ?? 'null'} résultats en ${Date.now() - t2} ms`)
  if (r3) for (const r of r3.slice(0, 4)) console.log(`   - ${r.domain} : ${r.title.slice(0, 60)}`)
}

main()
