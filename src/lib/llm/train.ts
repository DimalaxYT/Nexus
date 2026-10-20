// ─── NEXUS — Entraînement du LLM maison (AdamW, en tâche de fond) ────────────
// L'entraînement tourne dans le process serveur, par petites étapes : après chaque
// pas, la boucle cède la main à l'event loop (le chat et les API restent
// réactifs). Points de contrôle en base toutes les 150 étapes : un redémarrage
// (Render, Turso…) ne fait jamais perdre plus de 150 étapes. Un seul entraînement
// à la fois. Reprise possible depuis le dernier modèle (« entraîner encore »).

import { db } from '@/lib/db'
import { buildCorpus, type CorpusSources } from './corpus'
import { buildChatCorpus, type ChatCorpusSources } from './chat-corpus'
import { BPE } from './bpe'
import { encodeFor, isBpe } from './tokenize'
import {
  CHAT_CONFIG,
  CHAT_FORMAT,
  DEFAULT_CONFIG,
  batchLoss,
  buildLexicon,
  buildVocab,
  countParams,
  deserializeWeights,
  encodeText,
  initParams,
  makeRng,
  GROUNDED_FORMAT,
  GROUNDED_CTX,
  paramList,
  serializeWeights,
  type LmConfig,
  type LmParams,
  type Vocab,
} from './model'
import { backward } from './tensor'
import { invalidateModelCache } from './engine'
import { extendVocab, growEmbedding } from './model'

export interface TrainJob {
  status: 'running' | 'done' | 'stopped' | 'error'
  modelId: string
  startedAt: number
  endedAt: number | null
  /** Étapes effectuées pendant cette session. */
  sessionStep: number
  sessionTotal: number
  /** Étapes cumulées du modèle (reprise incluse). */
  totalSteps: number
  lr: number
  loss: number
  lossHistory: { step: number; loss: number }[]
  params: number
  corpusChars: number
  corpusSources: CorpusSources | null
  resumed: boolean
  stopRequested: boolean
  error: string
  log: string[]
}

const g = globalThis as unknown as { __nexusLlmJob?: TrainJob }

export function getTrainJob(): TrainJob | null {
  return g.__nexusLlmJob ?? null
}

function pushLog(job: TrainJob, line: string) {
  job.log.push(`${new Date().toLocaleTimeString('fr-FR')} · ${line}`)
  if (job.log.length > 40) job.log.splice(0, job.log.length - 40)
}

/** Planification du taux d'apprentissage : échauffement linéaire puis cosinus. */
export function learningRate(step: number, total: number, maxLr: number, minLr: number): number {
  const warm = Math.max(10, Math.min(60, Math.floor(total / 10)))
  if (step < warm) return (maxLr * step) / warm
  const progress = Math.min(1, (step - warm) / Math.max(1, total - warm))
  return minLr + 0.5 * (maxLr - minLr) * (1 + Math.cos(Math.PI * progress))
}

/** Écrêtage de la norme globale des gradients. */
function clipGradients(list: { grad: Float32Array | null }[], maxNorm: number): void {
  let sq = 0
  for (const p of list) {
    if (!p.grad) continue
    for (let i = 0; i < p.grad.length; i++) sq += p.grad[i] * p.grad[i]
  }
  const norm = Math.sqrt(sq)
  if (norm <= maxNorm || norm === 0) return
  const k = maxNorm / norm
  for (const p of list) if (p.grad) for (let i = 0; i < p.grad.length; i++) p.grad[i] *= k
}

/** Pas AdamW (decoupled weight decay sur les matrices uniquement). */
function adamStep(
  list: { data: Float32Array; grad: Float32Array | null; shape: number[] }[],
  m: Float32Array[],
  v: Float32Array[],
  lr: number,
  t: number
): void {
  const b1 = 0.9
  const b2 = 0.99
  const eps = 1e-8
  const wd = 0.01
  const c1 = 1 - Math.pow(b1, t)
  const c2 = 1 - Math.pow(b2, t)
  list.forEach((p, k) => {
    const grad = p.grad
    if (!grad) return
    const mm = m[k]
    const vv = v[k]
    const w = p.data
    const decay = p.shape.length === 2 ? wd : 0
    for (let i = 0; i < w.length; i++) {
      const gi = grad[i]
      mm[i] = b1 * mm[i] + (1 - b1) * gi
      vv[i] = b2 * vv[i] + (1 - b2) * gi * gi
      const mh = mm[i] / c1
      const vh = vv[i] / c2
      w[i] -= lr * (mh / (Math.sqrt(vh) + eps) + decay * w[i])
    }
  })
}

/** Enregistre un point de contrôle et rend le modèle actif (les anciens sont supprimés). */
export async function saveCheckpoint(
  modelId: string,
  params: LmParams,
  steps: number,
  loss: number,
  corpusChars: number,
  corpusSources: CorpusSources | null,
  layout?: { cfg: LmConfig; vocab: Vocab }
): Promise<void> {
  await db.llmModel.update({
    where: { id: modelId },
    data: {
      weights: serializeWeights(params),
      ...(layout ? { config: JSON.stringify(layout.cfg), vocab: JSON.stringify(layout.vocab.itos) } : {}),
      steps,
      loss,
      corpusChars,
      corpusInfo: JSON.stringify(corpusSources ?? {}),
      active: true,
    },
  })
  const others = await db.llmModel.findMany().catch(() => [])
  for (const row of others ?? []) {
    if (String(row.id) !== modelId) await db.llmModel.delete({ where: { id: String(row.id) } }).catch(() => {})
  }
}

function safeConfig(raw: string): LmConfig | null {
  try {
    return JSON.parse(raw) as LmConfig
  } catch {
    return null
  }
}

export interface StartOptions {
  /** Nombre d'étapes à effectuer dans cette session. */
  steps: number
  /** Reprendre le modèle actif au lieu d'en créer un neuf. */
  resume: boolean
  seed?: number
  /**
   * `chat` (défaut) : modèle de conversation en sous-mots BPE (`chat-v1`).
   * `grounded` : ancien format caractère (`grounded-v1`), conservé pour les
   * modèles déjà en base.
   */
  format?: 'chat' | 'grounded'
  /** Taille du lot (4 par défaut en conversation : le contexte est plus long). */
  batchSize?: number
}

/** Démarre un entraînement. Renvoie aussitôt ; la boucle tourne en arrière-plan. */
export async function startTraining(opts: StartOptions): Promise<TrainJob> {
  const current = getTrainJob()
  if (current && current.status === 'running') throw new Error('Un entraînement est déjà en cours.')

  const steps = Math.max(20, Math.min(20_000, Math.floor(opts.steps)))
  const chat = (opts.format ?? 'chat') === 'chat'
  const chatReport = chat ? await buildChatCorpus() : null
  const report = chatReport
    ? { text: chatReport.text, chars: chatReport.chars, sources: chatReport.sources as CorpusSources }
    : await buildCorpus()
  if (report.chars < 4000) {
    throw new Error(`Corpus trop court (${report.chars} caractères). Ajoute des connaissances ou des conversations, ou retire des filtres d'exclusion.`)
  }

  // Reprise : on garde vocabulaire, configuration et poids du dernier modèle.
  // Un ancien modèle (autre format ou contexte trop court) ne peut pas être repris :
  // on en crée un neuf au format ancré.
  let active = opts.resume
    ? await db.llmModel.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } }).catch(() => null)
    : null
  let replacedNote = ''
  if (active) {
    const prevCfg = safeConfig(String(active.config))
    const wantFormat = chat ? CHAT_FORMAT : GROUNDED_FORMAT
    const wantCtx = chat ? CHAT_CONFIG.ctx : GROUNDED_CTX
    const wantTok = chat ? CHAT_CONFIG.tokenizer ?? 'char' : 'char'
    if (!prevCfg || prevCfg.format !== wantFormat || prevCfg.ctx !== wantCtx || (prevCfg.tokenizer ?? 'char') !== wantTok) {
      replacedNote = chat
        ? 'modèle précédent incompatible (format, contexte ou tokenizer) : nouveau modèle de conversation (les anciens poids sont remplacés)'
        : 'ancien format détecté : nouveau modèle au format ancré (les anciens poids sont remplacés)'
      active = null
    }
  }

  let cfg: LmConfig
  let vocab: Vocab
  let params: LmParams
  let baseSteps = 0
  let modelId: string
  let resumeNote = ''
  if (active && String(active.weights ?? '')) {
    cfg = JSON.parse(String(active.config)) as LmConfig
    // BPE : le vocabulaire est fixé par le tokenizer (2049), aucune table de
    // caractères à étendre — tout texte français, emoji compris, est encodable.
    vocab = isBpe(cfg) ? { itos: [] } : { itos: JSON.parse(String(active.vocab ?? '[]')) as string[] }
    params = deserializeWeights(cfg, String(active.weights))
    baseSteps = Number(active.steps ?? 0)
    modelId = String(active.id)
    if (isBpe(cfg)) {
      cfg = { ...cfg, lexicon: buildLexicon(report.text) }
      resumeNote = `tokenizer BPE (vocabulaire ${cfg.vocab}) · lexique ${cfg.lexicon?.length ?? 0} mots`
    } else {
      // Le savoir ajouté depuis le dernier entraînement doit être lisible : on étend
      // le vocabulaire aux nouveaux caractères et on rafraîchit le lexique du garde-fou.
      const oldRows = cfg.vocab
      const extended = extendVocab(vocab, report.text)
      vocab = extended.vocab
      params = growEmbedding(params, oldRows, vocab.itos.length, cfg.dim, opts.seed ?? 7)
      cfg = { ...cfg, vocab: vocab.itos.length, lexicon: buildLexicon(report.text) }
      resumeNote = `vocabulaire ${oldRows} → ${vocab.itos.length}${extended.added.length ? ` (+${extended.added.length} caractère(s) nouveau(x))` : ''} · lexique ${cfg.lexicon?.length ?? 0} mots`
    }
  } else if (chat) {
    // Le vocabulaire dépend du tokenizer choisi dans CHAT_CONFIG : caractère
    // (vocabulaire appris sur le corpus, ~85 symboles) ou BPE (2049 sous-mots).
    vocab = isBpe(CHAT_CONFIG as LmConfig) ? { itos: [] } : buildVocab(report.text)
    cfg = {
      ...CHAT_CONFIG,
      vocab: isBpe(CHAT_CONFIG as LmConfig) ? BPE.modelVocabSize : vocab.itos.length,
      lexicon: buildLexicon(report.text),
    }
    params = initParams(cfg, opts.seed ?? 1337)
    const row = await db.llmModel.create({
      data: {
        name: 'nexus-chat',
        config: JSON.stringify(cfg),
        vocab: JSON.stringify([]),
        weights: '',
        steps: 0,
        loss: 0,
        corpusChars: report.chars,
        corpusInfo: JSON.stringify(report.sources),
        active: false,
      },
    })
    modelId = String(row.id)
  } else {
    vocab = buildVocab(report.text)
    cfg = { vocab: vocab.itos.length, ...DEFAULT_CONFIG, lexicon: buildLexicon(report.text), format: GROUNDED_FORMAT }
    params = initParams(cfg, opts.seed ?? 1337)
    const row = await db.llmModel.create({
      data: {
        name: 'nexus-llm',
        config: JSON.stringify(cfg),
        vocab: JSON.stringify(vocab.itos),
        weights: '',
        steps: 0,
        loss: 0,
        corpusChars: report.chars,
        corpusInfo: JSON.stringify(report.sources),
        active: false,
      },
    })
    modelId = String(row.id)
  }

  // Corpus de conversation : exemples emballés en blocs entiers (voir
  // `packChatBlocks`) pour que la tâche soit toujours complète à l'entraînement.
  const packed = chatReport
    ? packChatBlocks(
        chatReport.examples,
        isBpe(cfg) ? (t) => BPE.encodeDocument(t) : (t) => encodeText(vocab, t),
        cfg.ctx,
        isBpe(cfg) ? BPE.eosId : 1
      )
    : null
  const data = packed ? packed.data : encodeText(vocab, report.text)
  const batchSize = opts.batchSize ?? (chat ? 4 : 8)
  const job: TrainJob = {
    status: 'running',
    modelId,
    startedAt: Date.now(),
    endedAt: null,
    sessionStep: 0,
    sessionTotal: steps,
    totalSteps: baseSteps,
    lr: 0,
    loss: 0,
    lossHistory: [],
    params: countParams(params),
    corpusChars: report.chars,
    corpusSources: report.sources,
    resumed: Boolean(active),
    stopRequested: false,
    error: '',
    log: [],
  }
  g.__nexusLlmJob = job
  pushLog(
    job,
    `${active ? 'reprise' : 'nouveau modèle'} · ${job.params.toLocaleString('fr-FR')} paramètres · tokenizer ${cfg.tokenizer ?? 'char'} (vocabulaire ${cfg.vocab}) · corpus ${report.chars.toLocaleString('fr-FR')} caractères${chatReport ? ` / ${chatReport.examples.length} exemples` : ''} · ${steps} étapes`
  )
  if (replacedNote) pushLog(job, replacedNote)
  if (resumeNote) pushLog(job, resumeNote)

  void runLoop(job, { cfg, vocab, params, data, steps, baseSteps, seed: opts.seed ?? 7, resumed: Boolean(active), sources: report.sources, batchSize, blocks: packed?.blocks })
  return job
}

export interface TrainCoreOptions {
  steps: number
  baseSteps?: number
  seed?: number
  batchSize?: number
  resumed?: boolean
  maxLr?: number
  checkpointEvery?: number
  /**
   * Nombre de blocs de longueur `ctx` dans `data`, quand le corpus a été
   * emballé exemple par exemple (voir `packChatBlocks`). Les fenêtres sont alors
   * tirées sur des frontières de blocs : chaque échantillon contient des
   * exemples ENTIERS. Sans cela, une fenêtre tirée au hasard dans le flux
   * concaténé coupe les exemples en deux et la tâche « lire C:, écrire R: »
   * n'est complète que dans une minorité d'échantillons — mesuré : la perte
   * plafonne à 2,37 alors que le même modèle sur-apprend une fenêtre figée
   * à 0,578 en 80 pas.
   */
  blocks?: number
}

export interface TrainHooks {
  onStep?: (info: { step: number; totalSteps: number; loss: number; lr: number }) => void | Promise<void>
  onCheckpoint?: (info: { step: number; totalSteps: number; loss: number }) => Promise<void>
  shouldStop?: () => boolean
}

export interface TrainOutcome {
  /** Étapes réellement effectuées dans cet appel. */
  steps: number
  totalSteps: number
  loss: number
  stopped: boolean
}

/**
 * Boucle d'entraînement pure (AdamW + écrêtage de norme) : elle ne connaît ni la
 * base ni les fichiers, tout passe par les hooks. Utilisée par l'entraînement du
 * dashboard Dev (points de contrôle en base) ET par `scripts/train-chat.ts`
 (export du point de contrôle livré dans le dépôt) — une seule implémentation.
 */
export async function trainSteps(
  params: LmParams,
  cfg: LmConfig,
  data: Int32Array,
  opts: TrainCoreOptions,
  hooks: TrainHooks = {}
): Promise<TrainOutcome> {
  const list = paramList(params)
  const m = list.map((p) => new Float32Array(p.size))
  const v = list.map((p) => new Float32Array(p.size))
  const steps = Math.max(1, Math.floor(opts.steps))
  const baseSteps = Math.max(0, Math.floor(opts.baseSteps ?? 0))
  const B = Math.max(1, Math.min(16, Math.floor(opts.batchSize ?? 8)))
  const T = cfg.ctx
  const rng = makeRng((opts.seed ?? 7) + baseSteps)
  const maxStart = data.length - T - 2
  if (maxStart <= 0) throw new Error(`Corpus trop court pour un contexte de ${T} tokens (${data.length} tokens).`)
  const maxLr = opts.maxLr ?? (opts.resumed ? 1.5e-3 : 3e-3)
  const minLr = maxLr / 10
  const checkpointEvery = Math.max(1, Math.floor(opts.checkpointEvery ?? 150))
  let ema = 0
  let lastCheckpoint = 0
  let done = 0
  let stopped = false

  for (let step = 1; step <= steps; step++) {
    if (hooks.shouldStop?.()) {
      stopped = true
      break
    }
    const lr = learningRate(step, steps, maxLr, minLr)
    const x = new Int32Array(B * T)
    const y = new Int32Array(B * T)
    const blocks = Math.max(0, Math.floor(opts.blocks ?? 0))
    for (let b = 0; b < B; b++) {
      const s = blocks > 0 ? Math.floor(rng() * blocks) * T : Math.floor(rng() * maxStart)
      for (let t = 0; t < T; t++) {
        x[b * T + t] = data[s + t]
        y[b * T + t] = data[s + t + 1]
      }
    }
    for (const p of list) if (p.grad) p.grad.fill(0)
    const loss = batchLoss(cfg, params, x, y, B, T)
    backward(loss)
    clipGradients(list, 1.0)
    adamStep(list, m, v, lr, step)

    const value = loss.data[0]
    ema = step === 1 ? value : 0.95 * ema + 0.05 * value
    done = step
    // Céder la main à la file des TIMERS, pas seulement aux microtâches.
    // Un pas est un bloc de calcul synchrone de plusieurs secondes : sans ce
    // rendement, un entraînement lancé dans le process du serveur empêche tout
    // `setTimeout` de partir — mesuré sur le flux SSE d'une réponse de chat :
    // 71 s pour 20 morceaux (3,5 s d'attente par morceau) au lieu de 180 ms.
    // Le coût est un tick de timer par pas, négligeable devant le pas lui-même.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await hooks.onStep?.({ step, totalSteps: baseSteps + step, loss: ema, lr })
    if (step - lastCheckpoint >= checkpointEvery || step === steps) {
      lastCheckpoint = step
      await hooks.onCheckpoint?.({ step, totalSteps: baseSteps + step, loss: ema })
    }
    // Cède la main : le chat et les API restent réactifs pendant l'entraînement.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  return { steps: done, totalSteps: baseSteps + done, loss: ema, stopped }
}

/**
 * Emballe des exemples de conversation dans des blocs de longueur exactement
 * `ctx`, sans jamais couper un exemple (remplissage premier-ajustement décroissant
 * pour limiter le bourrage). Renvoie le flux de tokens et le nombre de blocs à
 * passer à `trainSteps({ blocks })`.
 *
 * Pourquoi : le format `chat-v1` est une TÂCHE (lire `C:` et `Q:`, écrire `R:`).
 * Une fenêtre qui commence au milieu d'un exemple ne contient ni le début de `C:`
 * ni la fin de `R:` : le signal d'apprentissage de la tâche est alors tronqué, et
 * la perte stagne au niveau de la simple statistique des caractères.
 *
 * Contrepartie assumée : les caractères de bourrage (sauts de ligne) sont triviaux
 * à prédire, donc la perte moyenne affichée baisse artificiellement. La vraie
 * mesure reste `scripts/check-chat-model.ts` (rang des caractères attendus).
 */
export function packChatBlocks(
  examples: string[],
  encode: (text: string) => ArrayLike<number>,
  ctx: number,
  padId: number
): { data: Int32Array; blocks: number; padded: number } {
  const encoded = examples
    .map((e) => Array.from(encode(e)))
    .filter((ids) => ids.length > 0)
    .sort((a, b) => b.length - a.length)
  const bins: number[][] = []
  const used: number[] = []
  for (const ids of encoded) {
    const need = ids.length + 1 // + le séparateur
    let placed = false
    for (let i = 0; i < bins.length; i++) {
      if (used[i] + need <= ctx) {
        bins[i].push(...ids, padId)
        used[i] += need
        placed = true
        break
      }
    }
    if (!placed) {
      bins.push([...ids, padId])
      used.push(Math.min(need, ctx))
    }
  }
  const blocks = bins.length
  // Un bloc supplémentaire de bourrage : la dernière fenêtre lit `s + T + 1`.
  const data = new Int32Array((blocks + 1) * ctx).fill(padId)
  bins.forEach((row, i) => data.set(row.slice(0, ctx), i * ctx))
  const filled = used.reduce((a, b) => a + b, 0)
  return { data, blocks, padded: 1 - filled / (blocks * ctx) }
}

async function runLoop(
  job: TrainJob,
  ctx: { cfg: LmConfig; vocab: Vocab; params: LmParams; data: Int32Array; steps: number; baseSteps: number; seed: number; resumed: boolean; sources: CorpusSources; batchSize?: number; blocks?: number }
): Promise<void> {
  const { cfg, params, data, steps, baseSteps, vocab } = ctx
  const B = ctx.batchSize ?? 8

  try {
    pushLog(
      job,
      ctx.blocks
        ? `entraînement lancé (lot ${B} × contexte ${cfg.ctx} · ${ctx.blocks} blocs d'exemples entiers · fenêtres alignées)`
        : `entraînement lancé (lot ${B} × contexte ${cfg.ctx})`
    )
    const outcome = await trainSteps(
      params,
      cfg,
      data,
      { steps, baseSteps, seed: ctx.seed, resumed: ctx.resumed, batchSize: B, checkpointEvery: 150, blocks: ctx.blocks },
      {
        shouldStop: () => job.stopRequested,
        onStep: ({ step, totalSteps, loss, lr }) => {
          job.sessionStep = step
          job.totalSteps = totalSteps
          job.lr = lr
          job.loss = loss
          if (step % 5 === 0 || step === 1) {
            job.lossHistory.push({ step: totalSteps, loss: Number(loss.toFixed(4)) })
            if (job.lossHistory.length > 300) job.lossHistory.splice(0, job.lossHistory.length - 300)
          }
          if (step % 50 === 0) pushLog(job, `étape ${totalSteps} · perte ${loss.toFixed(3)} · lr ${lr.toExponential(2)}`)
        },
        onCheckpoint: async ({ totalSteps, loss }) => {
          await saveCheckpoint(job.modelId, params, totalSteps, loss, job.corpusChars, job.corpusSources, { cfg, vocab })
          pushLog(job, `point de contrôle enregistré (étape ${totalSteps})`)
        },
      }
    )
    await saveCheckpoint(job.modelId, params, outcome.totalSteps, outcome.loss, job.corpusChars, job.corpusSources, { cfg, vocab })
    job.status = outcome.stopped ? 'stopped' : 'done'
    pushLog(job, outcome.stopped ? `arrêté à l'étape ${outcome.totalSteps} — progression sauvegardée` : `terminé · perte finale ${outcome.loss.toFixed(3)}`)
  } catch (err) {
    job.status = 'error'
    job.error = err instanceof Error ? err.message : 'erreur inconnue'
    pushLog(job, `erreur : ${job.error}`)
    try {
      await saveCheckpoint(job.modelId, params, job.totalSteps, job.loss, job.corpusChars, job.corpusSources, { cfg, vocab })
    } catch {
      /* sauvegarde impossible : le dernier point de contrôle reste valable */
    }
  } finally {
    job.endedAt = Date.now()
    job.stopRequested = false
    // Le modèle en mémoire doit être relu depuis la base à la prochaine requête.
    invalidateModelCache()
  }
}

/** Demande l'arrêt propre (la progression est sauvegardée avant la fin). */
export function stopTraining(): boolean {
  const job = getTrainJob()
  if (!job || job.status !== 'running') return false
  job.stopRequested = true
  return true
}
