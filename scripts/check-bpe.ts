// Vérifie le port TypeScript du tokenizer BPE contre l'implémentation Python
// de référence (llm/nexus_llm/tokenizer.py). Les ids attendus sont produits par
// scripts/gen-bpe-fixtures.py et comparés UN PAR UN : même découpage, mêmes
// fusions, même aller-retour.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BPE } from '@/lib/llm/bpe'

interface Case { text: string; ids: number[]; roundtrip_ok: boolean }
interface Fixtures { vocab: number; eos: number; cases: Case[] }

// Fixtures SUIVIES PAR GIT (régénérées par scripts/gen-bpe-fixtures.py) : l'outil
// doit fonctionner depuis un clone neuf, sans dossier temporaire.
const path = join(process.cwd(), 'scripts', 'fixtures', 'bpe-fixtures.json')
const fixtures = JSON.parse(readFileSync(path, 'utf8')) as Fixtures

let failures = 0
if (fixtures.vocab !== BPE.modelVocabSize) {
  console.log(`✘ vocabulaire : python ${fixtures.vocab} ≠ ts ${BPE.modelVocabSize}`)
  failures++
} else console.log(`✔ vocabulaire modèle identique : ${BPE.modelVocabSize} (EOS = ${BPE.eosId})`)

for (const c of fixtures.cases) {
  const ids = BPE.encode(c.text)
  const same = ids.length === c.ids.length && ids.every((v, i) => v === c.ids[i])
  const back = BPE.decode(ids)
  // On compare à la RÉFÉRENCE PYTHON, pas à un aller-retour parfait : le BPE du
  // dépôt ignore le « _ » (aucune alternative du regex ne le capture), donc
  // Python ne le restitue pas non plus — les deux doivent se comporter pareil.
  const rt = back === c.text
  if (!same || rt !== c.roundtrip_ok) {
    failures++
    console.log(`✘ « ${c.text.slice(0, 48)} »`)
    if (!same) console.log(`   python: ${c.ids.join(',')}\n   ts    : ${ids.join(',')}`)
    if (rt !== c.roundtrip_ok) console.log(`   aller-retour ts=${rt} python=${c.roundtrip_ok} (« ${back} »)`)
  } else {
    console.log(`✔ « ${c.text.slice(0, 44)} » → ${ids.length} tokens · identique à Python${rt ? '' : ' (sans le « _ », comme Python)'}`)
  }
}

// Compression mesurée sur du texte réel du dépôt (le but du BPE).
const sample = readFileSync(join(process.cwd(), 'src', 'lib', 'brain', 'dialogue-bank.ts'), 'utf8').slice(0, 20000)
const ids = BPE.encode(sample)
console.log(`\nCompression : ${sample.length} caractères → ${ids.length} tokens (${(sample.length / ids.length).toFixed(2)} car./token)`)

console.log(failures === 0 ? '\n✔ TOKENIZER BPE IDENTIQUE À LA RÉFÉRENCE PYTHON' : `\n✘ ${failures} écart(s)`)
process.exit(failures === 0 ? 0 : 1)
