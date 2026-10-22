// ─── NEXUS — Évaluation honnête du modèle de conversation ────────────────────
// Trois mesures qui ne peuvent pas être maquillées par la perte d'entraînement :
//   1. NLL et rang des caractères attendus en teacher forcing (le modèle sait-il
//      ce qu'il doit écrire après « R: » ?),
//   2. taux d'acceptation par les garde-fous réels du chat (`verdictOn`) sur des
//      exemples de validation jamais vus,
//   3. similarité avec la réponse attendue (F1 de mots) et latence.
//
// Usage :
//   node --import tsx scripts/eval-chat.ts --models nexus-chat-v1,nexus-chat-v2
//   node --import tsx scripts/eval-chat.ts --limit 20
//
// Le jeu de validation est celui de l'export du corpus (réponses tenues à
// l'écart, pas seulement des exemples) : la comparaison v1/v2 porte donc sur
// les mêmes phrases que le modèle n'a jamais vues.

import { buildChatCorpus } from '@/lib/llm/chat-corpus'
import { CHAT_CONFIG, CHAT_FORMAT } from '@/lib/llm/model'
import { createKv, prefill, resetKv, stepToken } from '@/lib/llm/kv'
import { encodeFor } from '@/lib/llm/tokenize'
import { loadSeedModel, CHAT_SEED } from '@/lib/llm/seed'
import { groundingOf } from '@/lib/llm/grounding'
import { tidyAnswer, verdictOn, MIN_CHAT_GROUNDING } from '@/lib/llm/dialogue'
import { sample } from '@/lib/llm/generate'

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

function splitExample(ex: string): { prompt: string; answer: string; context: string | null } {
  const at = ex.lastIndexOf('\nR: ')
  const prompt = at >= 0 ? ex.slice(0, at + 4) : ex
  const answer = at >= 0 ? ex.slice(at + 4) : ''
  // Ordre du format : H?, Q, C, R. Le contexte est donc la ligne `C:` — la
  // découpe précédente cherchait `Q:` APRÈS `C:` et renvoyait un texte vide,
  // ce qui désactivait silencieusement la mesure d'ancrage.
  const cAt = prompt.lastIndexOf('\nC: ')
  let context: string | null = null
  if (cAt >= 0) {
    const rest = prompt.slice(cAt + 4)
    const end = rest.search(/\n(?:Q|H|R): /)
    context = (end >= 0 ? rest.slice(0, end) : rest).trim() || null
  }
  return { prompt, answer, context }
}

function tokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-zàâäéèêëîïôöùûüçœ'’]+/i).filter(Boolean)
}

function f1(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const bag = new Map<string, number>()
  for (const w of tb) bag.set(w, (bag.get(w) ?? 0) + 1)
  let hit = 0
  for (const w of ta) {
    const n = bag.get(w) ?? 0
    if (n > 0) {
      hit++
      bag.set(w, n - 1)
    }
  }
  const p = hit / ta.length
  const r = hit / tb.length
  return p + r > 0 ? (2 * p * r) / (p + r) : 0
}

type Model = NonNullable<ReturnType<typeof loadSeedModel>>

function teacherStats(model: Model, examples: { prompt: string; answer: string }[]): { nll: number; top3: number; chars: number; ms: number } {
  const t0 = Date.now()
  const kv = createKv(model.cfg, model.params)
  let nll = 0
  let top3 = 0
  let chars = 0
  for (const { prompt, answer } of examples) {
    const pIds = Array.from(encodeFor(model.cfg, model.vocab, prompt))
    const aIds = Array.from(encodeFor(model.cfg, model.vocab, answer))
    if (!aIds.length || pIds.length + aIds.length < 2) continue
    const all = [...pIds, ...aIds].slice(-model.cfg.ctx)
    const answerStart = Math.max(0, all.length - aIds.length)
    resetKv(kv)
    let logits = stepToken(kv, all[0])
    for (let i = 1; i < all.length; i++) {
      if (i >= answerStart) {
        let max = -Infinity
        for (let j = 0; j < model.cfg.vocab; j++) if (logits[j] > max) max = logits[j]
        let sum = 0
        for (let j = 0; j < model.cfg.vocab; j++) sum += Math.exp(logits[j] - max)
        const p = Math.exp(logits[all[i]] - max) / sum
        nll += -Math.log(Math.max(p, 1e-12))
        let rank = 1
        for (let j = 0; j < model.cfg.vocab; j++) if (logits[j] > logits[all[i]]) rank++
        if (rank <= 3) top3++
        chars++
      }
      if (kv.pos >= model.cfg.ctx) break
      logits = stepToken(kv, all[i])
    }
  }
  return { nll: nll / Math.max(1, chars), top3: top3 / Math.max(1, chars), chars, ms: Date.now() - t0 }
}

function evaluate(modelName: string, examples: { prompt: string; answer: string; context: string | null }[], limit: number) {
  const model = loadSeedModel(modelName)
  console.log(`\n══ ${modelName} ══`)
  if (!model) {
    console.log('  modèle introuvable dans public/models')
    return
  }
  console.log(
    `  ${model.cfg.format} · tokenizer ${model.cfg.tokenizer ?? 'char'} · vocab ${model.cfg.vocab} · dim ${model.cfg.dim} · ` +
      `${model.cfg.layers} couches · ctx ${model.cfg.ctx} · ${model.steps} étapes · perte ${Number(model.loss).toFixed(3)}`
  )
  const te = teacherStats(model, examples.slice(0, Math.max(4, Math.min(limit, 24))))
  console.log(`  teacher forcing : NLL ${te.nll.toFixed(3)} · top-3 ${Math.round(te.top3 * 100)} % · ${te.chars} caractères · ${te.ms} ms`)

  let accepted = 0
  let grounding = 0
  let similarity = 0
  let latency = 0
  const shown: string[] = []
  let n = 0
  for (const ex of examples) {
    if (n >= limit) break
    const t0 = Date.now()
    const res = sample(model, ex.prompt, {
      maxTokens: 200,
      temperature: 0.45,
      topK: 6,
      repeatPenalty: 1.2,
      repeatWindow: 28,
      stopAtLine: true,
      seed: hashText(ex.answer) + n,
    })
    latency += Date.now() - t0
    const text = tidyAnswer(res.text)
    const verdict = verdictOn(text, {
      avgNll: res.avgNll,
      lexicon: model.lexicon,
      passage: ex.context,
      minGrounding: MIN_CHAT_GROUNDING,
    })
    if (verdict.ok) accepted++
    grounding += ex.context ? groundingOf(text, ex.context) : 0
    similarity += f1(text, ex.answer)
    if (shown.length < 4) shown.push(`    Q ${JSON.stringify(ex.prompt.split('\nQ: ').pop()?.slice(0, 70))}\n    attendu ${JSON.stringify(ex.answer.slice(0, 110))}\n    généré  ${JSON.stringify(text.slice(0, 110))}${verdict.ok ? '' : `  ✗ ${verdict.reason}`}`)
    n++
  }
  const denom = Math.max(1, n)
  console.log(`  génération : ${accepted}/${n} acceptés (${Math.round((100 * accepted) / denom)} %) · ancrage ${(grounding / denom).toFixed(2)} · F1 ${(similarity / denom).toFixed(2)} · ${Math.round(latency / denom)} ms/réponse`)
  console.log(shown.join('\n'))
}

async function main() {
  const models = arg('models', CHAT_SEED).split(',').map((s) => s.trim()).filter(Boolean)
  const limit = Number(arg('limit', '12'))
  const corpus = await buildChatCorpus({ includeDb: false })
  // MÊME découpage que scripts/export-chat-corpus.ts.
  const val = corpus.examples.filter((ex) => {
    const at = ex.lastIndexOf('\nR: ')
    return hashText(at >= 0 ? ex.slice(at + 4) : ex) % 12 === 0
  })
  const examples = val.map(splitExample).filter((e) => e.answer.length >= 20)
  console.log(`validation : ${examples.length} exemples tenus à l'écart (format ${CHAT_FORMAT}, ctx ${CHAT_CONFIG.ctx})`)
  for (const name of models) evaluate(name, examples, limit)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
