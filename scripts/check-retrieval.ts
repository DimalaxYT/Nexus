// ─── NEXUS — Mesure du retrieval des connaissances ───────────────────────────
// Le modèle ne peut copier que le passage qu'on lui donne : un mauvais passage
// = une mauvaise réponse, quelle que soit la taille du modèle. Ce script mesure
// le classement sur les 35 entrées de la banque de connaissances :
//   · question canonique — la question de l'entrée doit retrouver SON passage ;
//   · mots-clés — même test, avec seulement les mots-clés (plus difficile).
// Il affiche aussi le score du meilleur passage, pour vérifier le seuil
// MIN_PASSAGE_SCORE utilisé par le chemin ancré (`engine.ts`).
//
// Usage : node --import tsx scripts/check-retrieval.ts [--verbose]

import { NEXUS_KNOWLEDGE } from '@/lib/brain/knowledge-bank'
import { gatherPassages, MIN_PASSAGE_SCORE, rankPassage } from '@/lib/llm/grounding'
import { stems } from '@/lib/brain/text'

async function main() {
  const verbose = process.argv.includes('--verbose')
  const all = await gatherPassages(null)
  const bank = all.filter((p) => p.source === 'banque de connaissances NEXUS')
  // IDF sur les passages de la banque uniquement : les apprentissages Dev
  // ajoutent du bruit qui ne dit rien de la qualité du classement.
  const df = new Map<string, number>()
  for (const p of bank) for (const s of new Set(stems(p.text))) df.set(s, (df.get(s) ?? 0) + 1)
  const idf = new Map<string, number>()
  for (const [s, d] of df) idf.set(s, Math.log((bank.length + 1) / (d + 1)) + 1)

  const entryOf = (title: string | undefined) => NEXUS_KNOWLEDGE.findIndex((e) => title?.startsWith(e.question))
  const test = (label: string, query: (i: number) => string) => {
    let top1 = 0
    let scoreSum = 0
    const misses: string[] = []
    for (let i = 0; i < NEXUS_KNOWLEDGE.length; i++) {
      const entry = NEXUS_KNOWLEDGE[i]
      let bestI = -1
      let bestS = -1
      for (const p of bank) {
        const s = rankPassage(query(i), p.text, idf, p.title ?? '')
        if (s > bestS) {
          bestS = s
          bestI = entryOf(p.title)
        }
      }
      scoreSum += Math.max(0, bestS)
      if (bestI === i) top1++
      else if (misses.length < 6) misses.push(`${entry.question} → ${bestI >= 0 ? NEXUS_KNOWLEDGE[bestI].question : '∅'} (${bestS.toFixed(2)})`)
    }
    const n = NEXUS_KNOWLEDGE.length
    console.log(`${label.padEnd(20)} top-1 ${String(top1).padStart(2)}/${n} (${Math.round((100 * top1) / n)} %) · score moyen ${(scoreSum / n).toFixed(2)}`)
    if (verbose || top1 < n - 2) console.log(misses.map((m) => `  · ${m}`).join('\n'))
    return top1
  }

  console.log(`passages : ${bank.length} banque / ${all.length} au total · seuil ancré ${MIN_PASSAGE_SCORE}`)
  const a = test('question canonique', (i) => NEXUS_KNOWLEDGE[i].question)
  console.log('')
  test('mots-clés', (i) => NEXUS_KNOWLEDGE[i].keywords.join(' '))
  console.log(a >= NEXUS_KNOWLEDGE.length - 1 ? '\n→ classement exploitable' : '\n→ vérifier les collisions de radicaux')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
