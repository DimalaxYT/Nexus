// ─── NEXUS — Entraînement du modèle de conversation (hors ligne) ──────────────
// Entraîne le transformeur `chat-v1` (tokenizer BPE) sur le corpus de
// conversation, puis exporte le point de contrôle livré dans le dépôt :
//   public/models/nexus-chat-v1.bin   poids Float32 little-endian
//   public/models/nexus-chat-v1.json  configuration + lexique + métadonnées
// Un déploiement neuf charge ces fichiers (src/lib/llm/seed.ts) et peut donc
// discuter immédiatement, sans API ni entraînement préalable.
//
// Usage :
//   node --import tsx scripts/train-chat.ts --steps 900
//   node --import tsx scripts/train-chat.ts --steps 300 --resume --eval
// Options : --steps --batch --lr --dim --layers --ctx --out --include-db
//           --resume (repart du .bin existant) --eval (évaluation finale)
//           --no-db (ne pas écrire dans db/custom.db)

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BPE } from '@/lib/llm/bpe'
import { buildChatCorpus } from '@/lib/llm/chat-corpus'
import { chatPrompt, matchDialogue, retrieveChatContext, verdictOn, cleanAnswer, MAX_CHAT_NLL } from '@/lib/llm/dialogue'
import { averageNll, sample } from '@/lib/llm/generate'
import {
  CHAT_CONFIG,
  buildLexicon,
  buildVocab,
  encodeText,
  countParams,
  deserializeWeights,
  initParams,
  serializeWeights,
  type LmConfig,
  type LmParams,
  type Vocab,
} from '@/lib/llm/model'
import { packChatBlocks, saveCheckpoint, trainSteps } from '@/lib/llm/train'
import { SEED_DIR, CHAT_SEED, writeSeedFiles, type SeedMeta } from '@/lib/llm/seed'
import { db } from '@/lib/db'

// ── Arguments ────────────────────────────────────────────────────────────────
function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = Number(process.argv[i + 1])
  return Number.isFinite(v) ? v : fallback
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

const steps = arg('steps', 900)
const batchSize = arg('batch', 4)
const lr = arg('lr', 0) || undefined
const dim = arg('dim', 0) || CHAT_CONFIG.dim
const layers = arg('layers', 0) || CHAT_CONFIG.layers
const ctx = arg('ctx', 0) || CHAT_CONFIG.ctx
const checkpointEvery = arg('every', 50)
const includeDb = flag('include-db')
const resume = flag('resume')
const evalOnly = flag('eval')
const writeDb = !flag('no-db')
const outName = (process.argv.indexOf('--out') >= 0 ? process.argv[process.argv.indexOf('--out') + 1] : CHAT_SEED) as string

const log = (line: string) => console.log(`${new Date().toLocaleTimeString('fr-FR')} · ${line}`)

/**
 * NLL moyenne de la réponse attendue SACHANT le prompt, mesurée sur des exemples
 * complets et SANS BOURRAGE.
 *
 * Indispensable : la perte d'entraînement est moyennée sur des blocs de longueur
 * `ctx` remplis à ~76 % — le quart restant est du saut de ligne trivial à prédire.
 * Une perte « 1,81 » vaut donc ~2,32 sur les tokens réels, soit exactement le
 * plateau que l'on croyait avoir quitté. Cette fonction est la métrique honnête :
 * elle ne dépend ni du remplissage ni de la géométrie des lots.
 */
function validationNll(
  model: { cfg: LmConfig; vocab: Vocab; params: LmParams },
  examples: string[],
  count = 6
): number {
  let sum = 0
  let n = 0
  for (const ex of examples) {
    if (n >= count) break
    const at = ex.lastIndexOf('\nR: ')
    if (at < 0) continue
    const prompt = ex.slice(0, at + 4)
    const answer = ex.slice(at + 4)
    if (answer.length < 8) continue
    sum += averageNll(model, prompt, answer)
    n++
  }
  return n ? sum / n : Number.NaN
}

async function main() {
  log(`corpus de conversation (base de données ${includeDb ? 'incluse' : 'exclue'})…`)
  const corpus = await buildChatCorpus({ includeDb })
  const bpe = (CHAT_CONFIG.tokenizer ?? 'char') === 'bpe'
  const vocabTable: Vocab = bpe ? { itos: [] } : buildVocab(corpus.text)
  const cfg: LmConfig = {
    ...CHAT_CONFIG,
    dim,
    layers,
    ctx,
    vocab: bpe ? BPE.modelVocabSize : vocabTable.itos.length,
    lexicon: buildLexicon(corpus.text),
  }
  // Exemples emballés en blocs de longueur ctx, sans jamais en couper un : la
  // tâche « lire C: et Q:, écrire R: » est alors COMPLÈTE dans chaque fenêtre.
  const packed = packChatBlocks(
    corpus.examples,
    bpe ? (t: string) => BPE.encodeDocument(t) : (t: string) => encodeText(vocabTable, t),
    cfg.ctx,
    bpe ? BPE.eosId : 1
  )
  const data = packed.data
  log(`exemples ${corpus.examples.length} · ${corpus.chars.toLocaleString('fr-FR')} caractères · ${data.length.toLocaleString('fr-FR')} tokens`)
  log(`emballage : ${packed.blocks} blocs de ${cfg.ctx} · remplissage ${Math.round((1 - packed.padded) * 100)} % · fenêtres alignées sur les exemples`)
  log(`configuration : tokenizer ${cfg.tokenizer ?? 'char'} · dim ${cfg.dim} · ${cfg.layers} couches · ${cfg.heads} têtes · ctx ${cfg.ctx} · vocab ${cfg.vocab}`)

  // Reprise depuis le point de contrôle existant (entraînements successifs).
  let params: LmParams
  let baseSteps = 0
  let baseLoss = 0
  const binPath = join(SEED_DIR, `${outName}.bin`)
  const jsonPath = join(SEED_DIR, `${outName}.json`)
  if (resume && existsSync(binPath) && existsSync(jsonPath)) {
    const meta = JSON.parse(readFileSync(jsonPath, 'utf8')) as SeedMeta
    const prev = meta.config
    if (prev.dim !== cfg.dim || prev.layers !== cfg.layers || prev.ctx !== cfg.ctx || prev.vocab !== cfg.vocab) {
      throw new Error('Reprise impossible : la configuration diffère du point de contrôle existant.')
    }
    params = deserializeWeights(cfg, readFileSync(binPath).toString('base64'))
    baseSteps = Number(meta.steps ?? 0)
    baseLoss = Number(meta.loss ?? 0)
    log(`reprise depuis l'étape ${baseSteps} (perte ${baseLoss.toFixed(3)})`)
  } else {
    params = initParams(cfg, 1337)
    log(`initialisation · ${countParams(params).toLocaleString('fr-FR')} paramètres`)
  }

  const vocab: Vocab = vocabTable
  const exportSeed = (atSteps: number, loss: number) => {
    const meta: SeedMeta = {
      name: outName,
      format: cfg.format ?? 'chat-v1',
      config: cfg,
      vocab: bpe ? [] : vocabTable.itos,
      steps: atSteps,
      loss: Number(loss.toFixed(4)),
      params: countParams(params),
      corpusChars: corpus.chars,
      exportedAt: new Date().toISOString(),
    }
    writeSeedFiles(SEED_DIR, outName, meta, Buffer.from(serializeWeights(params), 'base64'))
  }

  const model = { cfg, vocab, params }

  if (!evalOnly) {
    const t0 = Date.now()
    let lastLog = 0
    const outcome = await trainSteps(
      params,
      cfg,
      data,
      { steps, baseSteps, seed: 7, batchSize, resumed: baseSteps > 0, maxLr: lr, checkpointEvery, blocks: packed.blocks },
      {
        onStep: ({ step, totalSteps, loss, lr: currentLr }) => {
          if (step - lastLog < 25 && step !== steps) return
          lastLog = step
          const elapsed = (Date.now() - t0) / 1000
          const perStep = elapsed / step
          const eta = Math.round(perStep * (steps - step))
          log(`étape ${totalSteps} · perte ${loss.toFixed(4)} · lr ${currentLr.toExponential(2)} · ${perStep.toFixed(2)} s/pas · reste ~${eta} s`)
        },
        onCheckpoint: async ({ totalSteps, loss }) => {
          const valNll = validationNll({ cfg, vocab, params }, corpus.examples)
          log(`validation (sans bourrage) : NLL réponse ${valNll.toFixed(3)} nats/caractère · perte lot ${loss.toFixed(3)}`)
          exportSeed(totalSteps, loss)
          if (writeDb) {
            const row = await db.llmModel.findFirst({ where: { name: 'nexus-chat' }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
            if (row) {
              await saveCheckpoint(String(row.id), params, totalSteps, loss, corpus.chars, corpus.sources, { cfg, vocab }).catch(() => {})
            } else {
              const created = await db.llmModel
                .create({
                  data: {
                    name: 'nexus-chat',
                    config: JSON.stringify(cfg),
                    vocab: JSON.stringify([]),
                    weights: '',
                    steps: 0,
                    loss: 0,
                    corpusChars: corpus.chars,
                    corpusInfo: JSON.stringify(corpus.sources),
                    active: false,
                  },
                })
                .catch(() => null)
              if (created) await saveCheckpoint(String(created.id), params, totalSteps, loss, corpus.chars, corpus.sources, { cfg, vocab }).catch(() => {})
            }
          }
        },
      }
    )
    exportSeed(outcome.totalSteps, outcome.loss)
    log(`entraînement terminé · ${outcome.steps} étapes · perte ${outcome.loss.toFixed(4)} · ${(((Date.now() - t0) / 1000 / 60).toFixed(1))} min`)
    log(`point de contrôle : ${binPath}`)
  }

  await evaluate(model, corpus.chars)
}

// ── Évaluation : retrieval + rédaction + garde-fous sur des messages réels ────
const TESTS: { message: string; history?: { role: 'user' | 'assistant'; content: string }[] }[] = [
  { message: 'Bonjour !' },
  { message: 'Qui es-tu ?' },
  { message: "Qu'est-ce que tu sais faire ?" },
  { message: 'Ça va ?' },
  { message: 'Tu es une vraie IA ou un script ?' },
  { message: "J'ai passé une mauvaise journée" },
  { message: 'Raconte-moi quelque chose' },
  { message: 'Et pourquoi ?', history: [{ role: 'user', content: 'Qui es-tu ?' }, { role: 'assistant', content: 'Je suis NEXUS, un agent IA qui tourne entièrement sur ta machine.' }] },
  { message: 'Tu penses quoi des humains ?' },
  { message: 'Merci pour ton aide' },
]

async function evaluate(model: { cfg: LmConfig; vocab: Vocab; params: LmParams }, corpusChars: number) {
  void corpusChars
  const lexicon = new Set(model.cfg.lexicon ?? [])
  log(`évaluation (${TESTS.length} messages) · seuil NLL ${MAX_CHAT_NLL}`)
  let accepted = 0
  for (const t of TESTS) {
    const ctx = await retrieveChatContext(t.message, null, t.history ?? [])
    const prompt = chatPrompt({ history: t.history ?? [], context: ctx.passage, message: t.message })
    const res = sample(model, prompt, { maxTokens: 120, temperature: 0.55, topK: 6, seed: 11, repeatPenalty: 1.3, stopAtLine: true })
    const text = cleanAnswer(res.text)
    const verdict = verdictOn(text, { avgNll: res.avgNll, lexicon, passage: ctx.passage, minGrounding: ctx.passage ? 0.45 : 0 })
    const match = matchDialogue(t.message, t.history ?? [])
    if (verdict.ok) accepted++
    console.log(
      [
        `\nQ: ${t.message}`,
        `   retrieval  : ${match ? `« ${match.entry.q} » (${match.entry.t}, score ${match.score.toFixed(2)})` : 'aucun'} · contexte ${ctx.passage ? 'oui' : 'non'}`,
        `   généré     : « ${text} »`,
        `   confiance  : NLL ${res.avgNll.toFixed(2)} · ${res.tokens} tokens · ${res.ms} ms · ${verdict.ok ? 'ACCEPTÉ' : `REFUSÉ (${verdict.reason})`}`,
        verdict.ok ? '' : `   repli      : « ${ctx.fallback ?? '—'} »`,
      ]
        .filter(Boolean)
        .join('\n')
    )
  }
  log(`bilan : ${accepted}/${TESTS.length} réponses générées acceptées, ${TESTS.length - accepted} replis sur le savoir retrouvé`)
}

main().catch((err) => {
  console.error('échec :', err instanceof Error ? err.stack : err)
  process.exit(1)
})
