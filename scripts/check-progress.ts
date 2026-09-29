import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const task = await db.task.findUnique({ where: { id: 'cmulixoxb0006upvqwny1vhxi' } })
if (!task) { console.log('introuvable'); process.exit(0) }
console.log('status:', task.status)
const progress = JSON.parse(task.progress) as { at: string; note: string }[]
console.log(`${progress.length} entrée(s) de journal :`)
for (const p of progress) console.log(` [${p.at.slice(11, 19)}] ${p.note.slice(0, 160)}`)
await db.$disconnect()
