// ─── NEXUS — Diagnostic du modèle de conversation ─────────────────────────────
// Répond à la seule question qui compte pendant un entraînement : le modèle
// a-t-il appris la TÂCHE (lire `C:` et `Q:`, écrire `R:`), ou seulement la
// statistique des caractères ?
//
// Trois mesures, dans l'ordre :
//   1. ce que le modèle voit réellement à l'entraînement (fenêtre décodée avec
//      SON tokenizer — un décodage BPE sur un modèle caractère affiche du bruit,
//      piège dans lequel ce script est tombé une fois),
//   2. le top-5 prédit après « R: » puis pas à pas : une distribution plate
//      (meilleur candidat < 20 %) signifie que la tâche n'est pas apprise,
//   3. la NLL et le RANG de chaque caractère de la réponse attendue, forcé en
//      teacher forcing : rang 1-3 = le modèle sait ; rang 40+ = il ne sait pas.
//
// Usage : node --import tsx scripts/check-chat-model.ts [--seed]

import { buildChatCorpus } from '@/lib/llm/chat-corpus'
import { chatPrompt, retrieveChatContext } from '@/lib/llm/dialogue'
import { createKv, prefill, resetKv, stepToken } from '@/lib/llm/kv'
import { decodeFor, encodeFor } from '@/lib/llm/tokenize'
import { loadActiveModel } from '@/lib/llm/engine'
import { loadSeedModel } from '@/lib/llm/seed'

async function main() {
  const useSeed = process.argv.includes('--seed')
  const model = useSeed ? loadSeedModel() : await loadActiveModel()
  if (!model) {
    console.log('Aucun modèle chargé (ni en base, ni point de contrôle embarqué).')
    process.exit(1)
  }
  const { cfg, vocab, params } = model
  const decode = (ids: number[]) => decodeFor(cfg, vocab, ids)
  console.log(
    `modèle : ${model.id} · ${cfg.format} · tokenizer ${cfg.tokenizer ?? 'char'} · vocab ${cfg.vocab} · dim ${cfg.dim} · ${cfg.layers} couches · ctx ${cfg.ctx} · ${model.steps} étapes · perte ${Number(model.loss).toFixed(3)}${model.seeded ? ' · (poids livrés)' : ''}\n`
  )

  // 1) Fenêtre d'entraînement réelle.
  const corpus = await buildChatCorpus({ includeDb: false })
  const text = corpus.text
  const ids = encodeFor(cfg, vocab, text)
  const from = Math.min(4000, Math.max(0, ids.length - 200))
  console.log('── ce que le modèle apprend (fenêtre décodée) ──')
  console.log(JSON.stringify(decode(Array.from(ids.subarray(from, from + 140)))))
  console.log(`\ncorpus : ${corpus.examples.length} exemples · ${corpus.chars.toLocaleString('fr-FR')} caractères · ${ids.length.toLocaleString('fr-FR')} tokens`)

  // 2) Prédictions pas à pas après « R: ».
  const message = 'Bonjour'
  const ctx = await retrieveChatContext(message, null, [])
  const prompt = chatPrompt({ history: [], context: ctx.passage, message })
  console.log(`\n── prédictions après « R: » ──\nprompt   : ${JSON.stringify(prompt)}\nattendu  : « ${(ctx.fallback ?? '').slice(0, 70)} »`)
  const kv = createKv(cfg, params)
  const pIds = Array.from(encodeFor(cfg, vocab, prompt))
  resetKv(kv)
  if (pIds.length > 1) prefill(kv, pIds.slice(0, -1))
  let logits = stepToken(kv, pIds[pIds.length - 1])
  const V = cfg.vocab
  let generated = ''
  for (let n = 0; n < 14; n++) {
    let max = -Infinity
    let sum = 0
    for (let j = 0; j < V; j++) if (logits[j] > max) max = logits[j]
    for (let j = 0; j < V; j++) sum += Math.exp(logits[j] - max)
    const order = Array.from({ length: V }, (_, j) => j).sort((a, b) => logits[b] - logits[a]).slice(0, 5)
    const top = order.map((j) => `${JSON.stringify(decode([j]))} ${((100 * Math.exp(logits[j] - max)) / sum).toFixed(1)}%`).join('  ')
    console.log(`  pas ${String(n + 1).padStart(2)} : ${top}`)
    const next = order[0]
    generated += decode([next])
    if (kv.pos >= cfg.ctx) break
    logits = stepToken(kv, next)
  }
  console.log(`  → décodage glouton : « ${generated} »`)

  // 3) Teacher forcing sur la réponse attendue : rang et NLL par caractère.
  const target = ctx.passage ?? ''
  const tIds = Array.from(encodeFor(cfg, vocab, target))
  const all = pIds.concat(tIds)
  resetKv(kv)
  let lg = stepToken(kv, all[0])
  const rows: string[] = []
  let total = 0
  let counted = 0
  let top3 = 0
  for (let i = 1; i < all.length; i++) {
    if (i >= pIds.length) {
      let max = -Infinity
      let sum = 0
      for (let j = 0; j < V; j++) if (lg[j] > max) max = lg[j]
      for (let j = 0; j < V; j++) sum += Math.exp(lg[j] - max)
      const p = Math.exp(lg[all[i]] - max) / sum
      const nll = -Math.log(Math.max(p, 1e-12))
      const order = Array.from({ length: V }, (_, j) => j).sort((a, b) => lg[b] - lg[a])
      const rank = order.indexOf(all[i]) + 1
      total += nll
      counted++
      if (rank <= 3) top3++
      rows.push(`${JSON.stringify(decode([all[i]]))}:${nll.toFixed(1)}(r${rank})`)
    }
    if (kv.pos >= cfg.ctx) break
    lg = stepToken(kv, all[i])
  }
  console.log(`\n── réponse attendue forcée (${counted} caractères) ──`)
  console.log('  ' + rows.slice(0, 26).join(' '))
  console.log(`\nNLL moyenne forcée : ${(total / Math.max(1, counted)).toFixed(2)} · caractères dans le top-3 : ${top3}/${counted} (${Math.round((100 * top3) / Math.max(1, counted))} %)`)
  console.log(
    top3 / Math.max(1, counted) > 0.6
      ? '→ la tâche est apprise : le modèle sait quoi écrire après « R: ».'
      : '→ tâche pas encore apprise : les garde-fous renvoient le texte retrouvé (repli), ce qui est le comportement voulu.'
  )
}

main().catch((err) => {
  console.error('échec :', err instanceof Error ? err.stack : err)
  process.exit(1)
})
