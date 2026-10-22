// ─── NEXUS — le chat GÉNÈRE-t-il ses réponses ? (mesure honnête) ──────────────
// Le retrieval trouve toujours quelque chose ; la question est de savoir si le
// texte affiché est RÉDIGÉ par le transformeur ou simplement REPRIS du savoir
// local. Ce script coupe le disjoncteur de qualité (`gate: false`) et compte :
//   · généré   : le modèle a produit une réponse qui a passé les garde-fous,
//   · repli    : la génération a été refusée, le savoir retrouvé est servi,
//   · aucun    : rien de pertinent (aveu honnête).
//
// Usage :
//   node --import tsx scripts/check-chat-generation.ts [--model nexus-chat-v3]
//                                                      [--verbose]
import { answerChat, chatPrompt, cleanAnswer, retrieveChatContext } from '@/lib/llm/dialogue'
import { sample } from '@/lib/llm/generate'
import { loadSeedModel, CHAT_SEED } from '@/lib/llm/seed'

const QUESTIONS = [
  'Bonjour !',
  'Qui es-tu ?',
  "Qu'est-ce que tu sais faire ?",
  'Comment tu fonctionnes ?',
  'Tu as des émotions ?',
  'Tu penses quoi des humains ?',
  "J'ai passé une mauvaise journée",
  'Merci pour ton aide',
  'Au revoir',
  'Raconte-moi quelque chose',
  "Qu'est-ce que Turso ?",
  'Comment fonctionne le cache clé-valeur ?',
  'Comment installer NEXUS ?',
  'Qui a créé NEXUS ?',
  'Comment protéger mon site des injections ?',
  'Pourquoi dort-on ?',
  'Explique-moi les transformers',
  'Un peu de morivation',
  "Qu'est-ce que la mémoire longue ?",
  'Quel langage apprendre pour coder ?',
]

/** Part des 5-grammes de `text` déjà présents dans `source` (0 = texte neuf). */
function copyShare(text: string, source: string): number {
  const grams = (t: string) => {
    const w = t.toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}']+/u).filter(Boolean)
    const out = new Set<string>()
    for (let i = 0; i + 5 <= w.length; i++) out.add(w.slice(i, i + 5).join(' '))
    return out
  }
  const a = grams(text)
  const b = grams(source)
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const g of a) if (b.has(g)) hit++
  return hit / a.size
}

async function main() {
  const at = process.argv.indexOf('--model')
  const name = at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : CHAT_SEED
  const verbose = process.argv.includes('--verbose')
  const model = loadSeedModel(name)
  if (!model) {
    console.log(`modèle introuvable : ${name}`)
    process.exit(1)
  }
  console.log(
    `modèle ${model.id} · ${model.cfg.tokenizer ?? 'char'} · ctx ${model.cfg.ctx} · ${model.steps} étapes\n` +
      `${QUESTIONS.length} questions, disjoncteur court-circuité (chaque tour tente une génération)\n`
  )

  // Mode « sans contexte » : le modèle parle SEUL (aucun passage à recopier).
  // C'est la preuve la plus directe qu'il rédige, même quand le retrieval
  // pourrait fournir la réponse.
  if (process.argv.includes('--free')) {
    for (const q of QUESTIONS) {
      const res = sample(model, chatPrompt({ message: q }), {
        maxTokens: 80,
        temperature: 0.5,
        topK: 8,
        seed: 7,
        repeatPenalty: 1.25,
        stopAtLine: true,
      })
      console.log(`Q: ${q}\n   → « ${cleanAnswer(res.text).slice(0, 160)} » (${res.ms} ms, NLL ${res.avgNll.toFixed(2)})`)
    }
    return
  }

  let generated = 0
  let served = 0
  let none = 0
  let msGen = 0
  let copySum = 0
  const parSource = new Map<string, number>()
  for (const q of QUESTIONS) {
    const t0 = Date.now()
    const answer = await answerChat({ message: q, model, gate: false, maxTokens: 120 })
    const ms = Date.now() - t0
    if (answer.ok) parSource.set(answer.source ?? '—', (parSource.get(answer.source ?? '—') ?? 0) + 1)
    if (!answer.ok) {
      none++
      console.log(`✗ ${q}\n    aucun savoir`)
      continue
    }
    if (answer.generated) {
      generated++
      msGen += ms
      // RECOPIE : part de la réponse déjà présente dans le passage fourni. Une
      // réponse recopiée vaut 100 % ; une réponse rédigée, proche de 0 %.
      const ctx = await retrieveChatContext(q, null, [])
      const copy = copyShare(answer.text, ctx.passage ?? '')
      copySum += copy
      console.log(
        `✓ ${q} — GÉNÉRÉ en ${ms} ms (NLL ${Number.isFinite(answer.avgNll) ? answer.avgNll.toFixed(2) : '—'} · recopie ${Math.round(copy * 100)} %)`
      )
      console.log(`    « ${answer.text.replace(/\s+/g, ' ').slice(0, 160)} »`)
      if (copy >= 0.6) console.log('    ⚠ réponse quasi recopiée du contexte : ce n\'est pas de la rédaction.')
    } else {
      served++
      console.log(`· ${q} — repli (${answer.skipped ? 'génération sautée' : 'refusée'}) · ${answer.source ?? '—'}`)
      if (verbose) console.log(`    « ${answer.text.replace(/\s+/g, ' ').slice(0, 160) } »`)
    }
  }
  const total = generated + served + none
  console.log(`\n── Bilan ─────────────────────────────────────────────`)
  console.log(`générées : ${generated}/${total} (${Math.round((100 * generated) / total)} %)`)
  console.log(`repli    : ${served}/${total} · sans savoir : ${none}/${total}`)
  console.log(
    'provenance du texte servi : ' +
      [...parSource.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')
  )
  if (generated > 0) {
    console.log(`latence moyenne des réponses générées : ${Math.round(msGen / generated)} ms`)
    console.log(`recopie moyenne dans le contexte : ${Math.round((100 * copySum) / generated)} %`)
  }
  if (generated === 0) {
    console.log('\nAucune réponse rédigée par le modèle : le chat sert le savoir retrouvé.')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
