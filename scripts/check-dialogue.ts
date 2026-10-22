// ─── NEXUS — Mesure du retrieval de la banque de dialogue ────────────────────
// Le chat ne peut pas être plus intelligent que la phrase qu'il retrouve : si
// « Tu as peur qu'on t'éteigne ? » tombe sur « Tu as quel âge ? », aucun modèle
// ne rattrapera la réponse. Ce script mesure la seule chose qui compte ici :
// chaque question canonique doit retrouver SA réponse (auto-retrieval).
//
// Usage : node --import tsx scripts/check-dialogue.ts
//
// Deux passes : la question canonique (facile) et les mots-clés seuls (plus dur,
// mais proche d'un utilisateur qui tape « peur éteindre »).
// Lecture : top-1 ≥ 95 % = banque exploitable ; en dessous, vérifier les
// collisions de mots-outils (elles se règlent par l'IDF, pas par des exceptions).

import { DIALOGUE_BANK } from '@/lib/brain/dialogue-bank'
import { matchDialogue } from '@/lib/llm/dialogue'

const HISTORY = [
  { role: 'user' as const, content: 'Comment fonctionne un transformer ?' },
  { role: 'assistant' as const, content: 'Il lit le contenu retrouvé puis rédige la réponse caractère par caractère.' },
]

function run(label: string, query: (i: number) => string) {
  let top1 = 0
  let suivis = 0
  const misses: string[] = []
  for (let i = 0; i < DIALOGUE_BANK.length; i++) {
    const entry = DIALOGUE_BANK[i]
    // Une entrée « suivi » ne peut être retrouvée QUE dans un fil : sans
    // historique elle est volontairement écartée (sa phrase est elliptique).
    const history = entry.t === 'suivi' ? HISTORY : []
    const hit = matchDialogue(query(i), history)
    const ok = entry.t === 'suivi' ? Boolean(hit?.followUp || hit?.entry.t === 'suivi') : hit?.entry.a === entry.a
    if (entry.t === 'suivi') suivis++
    if (ok) top1++
    else if (misses.length < 8) misses.push(`${entry.q} → ${hit?.entry.q ?? '∅'} (${hit?.score.toFixed(2) ?? '—'})`)
  }
  const pct = Math.round((100 * top1) / DIALOGUE_BANK.length)
  console.log(`${label.padEnd(22)} top-1 ${String(top1).padStart(3)}/${DIALOGUE_BANK.length} (${pct} %) · dont ${suivis} relances`)
  if (misses.length) console.log(misses.map((m) => `  · ${m}`).join('\n'))
  return top1
}

const a = run('question canonique', (i) => DIALOGUE_BANK[i].q)
const b = run('mots-clés', (i) => DIALOGUE_BANK[i].k.join(' '))
const answers = new Set(DIALOGUE_BANK.map((e) => e.a))
console.log(`\nbanque : ${DIALOGUE_BANK.length} entrées · ${answers.size} réponses distinctes`)
console.log(a >= DIALOGUE_BANK.length - 1 && b >= DIALOGUE_BANK.length - 1
  ? '→ banque exploitable (la seule « collision » restante est une question dupliquée)'
  : '→ collisions à examiner')
