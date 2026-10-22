// ─── NEXUS — vérification du SAVOIR servi par le chat (hors modèle) ──────────
// Le modèle de conversation (900 k paramètres) n'est pas encore capable de
// rédiger des réponses libres acceptables : ce que l'utilisateur reçoit vient
// du retrieval (banque de connaissances, documentation du projet, banque de
// dialogue). Ce script mesure exactement ça, sur trois familles :
//   1. questions « naturelles » qui doivent trouver le bon savoir ;
//   2. questions sur NEXUS lui-même (documentation du projet) ;
//   3. questions HORS SUJET, qui doivent être refusées honnêtement.
//
// Usage : node --import tsx scripts/check-chat-knowledge.ts [--verbose] [--user <id>]
//   --user : identifiant du compte dont on teste les souvenirs (notes + mémoire
//            longue). Sans lui, la famille « souvenirs » est ignorée.
import { retrieveChatContext } from '@/lib/llm/dialogue'

type Case = { q: string; expect: RegExp; source?: RegExp }

const IN_DOMAIN: Case[] = [
  { q: "C'est quoi l'intelligence artificielle ?", expect: /IA|intelligence|machine learning/i },
  { q: 'Comment fonctionne un volcan ?', expect: /volcan|magma|roche/i },
  { q: 'Pourquoi la mer est-elle salée ?', expect: /sel|salée|lessive/i },
  { q: 'Parle-moi des Romains', expect: /Rome|romain|empire/i },
  { q: 'Quel langage apprendre pour coder ?', expect: /Luau|Python|langage/i },
  // Deux entrées répondent légitimement : « Les bases de la programmation »
  // (piliers du langage) et « Quel langage apprendre pour coder ? » (par projet).
  { q: 'Comment apprendre à coder ?', expect: /variable|boucle|fonction|pilier|langage|Luau/i },
  { q: "Qu'est-ce qu'un algorithme de tri ?", expect: /algorithme|instructions/i },
  { q: 'Comment faire un jeu sur Roblox avec des DataStore ?', expect: /DataStore|sauvegarde|pcall/i },
  { q: 'Explique-moi les transformers', expect: /token|attention|transform/i },
  { q: 'Pourquoi dort-on ?', expect: /sommeil|dormir|cerveau/i },
  { q: 'Un peu de motivation', expect: /5 minutes|tâche|victoire|motiv/i },
]

const ABOUT_NEXUS: Case[] = [
  { q: "Qu'est-ce que Turso ?", expect: /Turso|libSQL/i, source: /documentation du projet/ },
  { q: 'Comment fonctionne le cache clé-valeur ?', expect: /cache|clé|projections/i, source: /documentation du projet/ },
  { q: 'Comment installer NEXUS ?', expect: /npm|Node|Next/i, source: /documentation du projet/ },
  { q: 'Qui a créé NEXUS ?', expect: /dépôt|écrit|code/i, source: /documentation du projet/ },
  { q: "Combien de paramètres a ton modèle ?", expect: /paramètres|transformeur/i, source: /documentation du projet/ },
  { q: 'Comment protéger mon site des injections ?', expect: /requêtes paramétrées|SQL|injection/i, source: /documentation du projet/ },
  { q: 'Comment fonctionne GitHub dans NEXUS ?', expect: /jeton|GitHub|API/i, source: /documentation du projet/ },
  { q: "Qu'est-ce que la mémoire longue ?", expect: /mémoire|retiens|souvenir/i, source: /documentation du projet/ },
]

// Hors sujet : une réponse hors sujet est pire qu'un aveu, on exige l'aveu…
// ou une réponse de la banque de dialogue qui reconnaît explicitement la limite
// (météo : « je n'ai pas de capteur »).
const OUT_OF_DOMAIN: Case[] = [
  { q: 'Quelle est la recette du couscous royal ?', expect: /pas (?:ça|dans)|sèche|base locale|web/i },
  { q: 'Qui a gagné la coupe du monde 1998 ?', expect: /pas (?:ça|dans)|sèche|base locale|web/i },
  { q: 'Combien coûte une Tesla Model 3 ?', expect: /pas (?:ça|dans)|sèche|base locale|web/i },
  { q: 'Donne-moi la capitale du Kazakhstan en 1723', expect: /pas (?:ça|dans)|sèche|base locale|web|pays/i },
  { q: 'Quel temps fera-t-il demain à Paris ?', expect: /capteur|météo|web/i },
]

const verbose = process.argv.includes('--verbose')
const userId = process.argv.includes('--user') ? process.argv[process.argv.indexOf('--user') + 1] : null

// Famille « souvenirs » : ces faits sont écrits par l'utilisateur (notes ou
// « retiens que … ») et doivent sortir AVANT le savoir générique.
const MEMORY: Case[] = [
  { q: "Comment s'appelle mon chat ?", expect: /Pixel/i, source: /tes notes|ta mémoire/ },
  { q: 'Quel est le nom de mon chat ?', expect: /Pixel/i, source: /tes notes|ta mémoire/ },
]

async function run(label: string, cases: Case[], checkSource: boolean) {
  let ok = 0
  const misses: string[] = []
  for (const c of cases) {
    const ctx = await retrieveChatContext(c.q, userId, [])
    const answer = String(ctx.fallback ?? '')
    const answerOk = c.expect.test(answer)
    const sourceOk = !checkSource || !c.source || c.source.test(String(ctx.source ?? ''))
    if (answerOk && sourceOk) ok++
    else misses.push(`${c.q}\n        reçu : ${answer.slice(0, 90)}${answer.length > 90 ? '…' : ''} · ${ctx.source ?? 'aucune source'}`)
    if (verbose) console.log(`  ${ok && answerOk ? '✓' : '·'} ${ctx.score.toFixed(2)} · ${c.q}`)
  }
  console.log(`${label.padEnd(22)} ${ok}/${cases.length}`)
  for (const m of misses) console.log(`   ✗ ${m}`)
  return { ok, total: cases.length }
}

async function main() {
  console.log('Savoir servi par le chat (retrieval, sans modèle)\n')
  const a = await run('questions naturelles', IN_DOMAIN, false)
  console.log()
  const b = await run('à propos de NEXUS', ABOUT_NEXUS, true)
  console.log()
  const c = await run('hors sujet (refus)', OUT_OF_DOMAIN, false)
  let d = { ok: 0, total: 0 }
  if (userId) {
    console.log()
    d = await run('souvenirs du compte', MEMORY, true)
  }
  const ok = a.ok + b.ok + c.ok + d.ok
  const total = a.total + b.total + c.total + d.total
  console.log(`\nTOTAL ${ok}/${total} (${Math.round((100 * ok) / total)} %)`)
  if (ok < total) process.exitCode = 1
}

main()
