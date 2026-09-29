/** Contrôle qualité : dernières notes de compétences en base. */
import { db } from '@/lib/db'

async function main() {
  const rows = await db.knowledge.findMany({
    where: { category: { startsWith: 'Compétences/' } },
    orderBy: { updatedAt: 'desc' },
    take: 6,
    select: { title: true, category: true, content: true },
  })
  console.log(`${rows.length} dernières compétences :`)
  for (const r of rows) {
    console.log(`\n[${r.category}] ${r.title.slice(0, 80)}`)
    console.log(`  ${r.content.slice(0, 180).replace(/\n/g, ' | ')}`)
  }
}

main()
  .catch((e) => {
    console.error('ÉCHEC:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
