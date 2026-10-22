// ─── NEXUS — Export du corpus de conversation pour l'entraîneur Python ───────
// Le corpus est construit par le code TypeScript (`chat-corpus.ts`) : c'est
// LUI qui définit le format vu à l'inférence (`H:/Q:/C:/R:`, budgets, variantes).
// Le trainer Python (llm/train_nexus_chat.py) ne fait que consommer ce JSON,
// ce qui garantit qu'entraînement et inférence ne peuvent pas diverger.
//
// Le vocabulaire est construit sur le corpus de conversation ET sur le texte de
// pré-entraînement : un caractère présent seulement dans la prose (un guillemet
// ancien, une ligature) ne doit pas devenir « inconnu » au pré-entraînement.
//
// Usage :
//   node --import tsx scripts/export-chat-corpus.ts
//   node --import tsx scripts/export-chat-corpus.ts --out llm/data/chat_corpus_v2.json
//   node --import tsx scripts/export-chat-corpus.ts --with-db   (ajoute le savoir utilisateur)

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildChatCorpus } from '@/lib/llm/chat-corpus'
import { buildLexicon, buildVocab, CHAT_CONFIG } from '@/lib/llm/model'
import { HISTORY_MAX, CONTEXT_MAX, MESSAGE_MAX } from '@/lib/llm/dialogue'
import { ANSWER_MAX } from '@/lib/llm/chat-corpus'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function hashText(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

async function main() {
  const out = arg('out', join('llm', 'data', 'chat_corpus_v2.json'))
  const withDb = process.argv.includes('--with-db')
  // « copy » = corpus v2 (C = la réponse, le modèle apprend à recopier) ;
  // « generate » = corpus v3 (C = une AUTRE réponse du même thème).
  const mode = arg('context-mode', 'generate') as 'copy' | 'generate'
  const pretrainPath = join('llm', 'data', 'chat_pretrain_v2.txt')
  const pretrain = readFileSync(pretrainPath, 'utf8')

  const corpus = await buildChatCorpus({ includeDb: withDb, contextMode: mode })
  const vocab = buildVocab(corpus.text + '\n' + pretrain)
  const lexicon = buildLexicon(corpus.text)

  // Découpage par RÉPONSE et non par exemple : toutes les variantes d'une même
  // réponse restent du même côté, sinon la validation contient des quasi-doublons
  // du train et la NLL mesurée ne prouve rien.
  const train: number[] = []
  const val: number[] = []
  corpus.examples.forEach((ex, i) => {
    const at = ex.lastIndexOf('\nR: ')
    const answer = at >= 0 ? ex.slice(at + 4) : ex
    if (hashText(answer) % 12 === 0) val.push(i)
    else train.push(i)
  })

  const payload = {
    name: CHAT_CONFIG.format === 'chat-v1' ? 'nexus-chat-v2' : 'nexus-chat',
    generatedAt: new Date().toISOString(),
    format: 'chat-v1',
    config: {
      ...CHAT_CONFIG,
      vocab: vocab.itos.length,
      lexicon,
    },
    vocab: vocab.itos,
    budgets: {
      history: HISTORY_MAX,
      message: MESSAGE_MAX,
      context: CONTEXT_MAX,
      answer: ANSWER_MAX,
      ctx: CHAT_CONFIG.ctx,
    },
    examples: corpus.examples,
    train,
    val,
    contextMode: mode,
    sources: corpus.sources,
    corpusChars: corpus.chars,
    pretrain: { path: pretrainPath, chars: pretrain.length },
  }
  writeFileSync(out, JSON.stringify(payload), 'utf8')
  console.log(
    `corpus exporté : ${corpus.examples.length} exemples · ${corpus.chars.toLocaleString('fr-FR')} caractères · ` +
      `vocabulaire ${vocab.itos.length} · lexique ${lexicon.length} · train ${train.length} / val ${val.length}`
  )
  console.log(`→ ${out}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
