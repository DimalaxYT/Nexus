/** Nettoyage des données de test (notes bruitées + mission de test). */
import { db } from '@/lib/db'

async function main() {
  const kb = await db.knowledge.deleteMany({ where: { category: { startsWith: 'Compétences/' } } })
  const rp = await db.knowledge.deleteMany({ where: { category: 'Rapports' } })
  const tk = await db.task.deleteMany({ where: { name: { contains: 'Test v3' } } })
  console.log(`Supprimés: ${kb.count} compétences, ${rp.count} rapports, ${tk.count} missions test`)
}

main()
  .catch((e) => {
    console.error('ÉCHEC:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
