// ─── NEXUS — Entraînement du LLM maison (AdamW, en tâche de fond) ────────────
// L'entraînement tourne dans le process serveur, par petites étapes : après chaque
// pas, la boucle cède la main à l'event loop (le chat et les API restent
// réactifs). Points de contrôle en base toutes les 150 étapes : un redémarrage
// (Render, Turso…) ne fait jamais perdre plus de 150 étapes. Un seul entraînement
// à la fois. Reprise possible depuis le dernier modèle (« entraîner encore »).

import { db } from '@/lib/db'
import { buildCorpus, type CorpusSources } from './corpus'
import {
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
}

/** Démarre un entraînement. Renvoie aussitôt ; la boucle tourne en arrière-plan. */
export async function startTraining(opts: StartOptions): Promise<TrainJob> {
  const current = getTrainJob()
  if (current && current.status === 'running') throw new Error('Un entraînement est déjà en cours.')

  const steps = Math.max(20, Math.min(20_000, Math.floor(opts.steps)))
  const report = await buildCorpus()
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
    if (!prevCfg || prevCfg.format !== GROUNDED_FORMAT || prevCfg.ctx !== GROUNDED_CTX) {
      replacedNote = 'ancien format détecté : nouveau modèle au format ancré (les anciens poids sont remplacés)'
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
    vocab = { itos: JSON.parse(String(active.vocab)) as string[] }
    params = deserializeWeights(cfg, String(active.weights))
    baseSteps = Number(active.steps ?? 0)
    modelId = String(active.id)
    // Le savoir ajouté depuis le dernier entraînement doit être lisible : on étend
    // le vocabulaire aux nouveaux caractères et on rafraîchit le lexique du garde-fou.
    const oldRows = cfg.vocab
    const extended = extendVocab(vocab, report.text)
    vocab = extended.vocab
    params = growEmbedding(params, oldRows, vocab.itos.length, cfg.dim, opts.seed ?? 7)
    cfg = { ...cfg, vocab: vocab.itos.length, lexicon: buildLexicon(report.text) }
    resumeNote = `vocabulaire ${oldRows} → ${vocab.itos.length}${extended.added.length ? ` (+${extended.added.length} caractère(s) nouveau(x))` : ''} · lexique ${cfg.lexicon?.length ?? 0} mots`
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

  const data = encodeText(vocab, report.text)
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
    `${active ? 'reprise' : 'nouveau modèle'} · ${job.params.toLocaleString('fr-FR')} paramètres · vocabulaire ${vocab.itos.length} · corpus ${report.chars.toLocaleString('fr-FR')} caractères · ${steps} étapes`
  )
  if (replacedNote) pushLog(job, replacedNote)
  if (resumeNote) pushLog(job, resumeNote)

  void runLoop(job, { cfg, vocab, params, data, steps, baseSteps, seed: opts.seed ?? 7, resumed: Boolean(active), sources: report.sources })
  return job
}

async function runLoop(
  job: TrainJob,
  ctx: { cfg: LmConfig; vocab: Vocab; params: LmParams; data: Int32Array; steps: number; baseSteps: number; seed: number; resumed: boolean; sources: CorpusSources }
): Promise<void> {
  const { cfg, params, data, steps, baseSteps, vocab } = ctx
  const list = paramList(params)
  const m = list.map((p) => new Float32Array(p.size))
  const v = list.map((p) => new Float32Array(p.size))
  const B = 8
  const T = cfg.ctx
  const rng = makeRng(ctx.seed + baseSteps)
  const maxStart = data.length - T - 2
  const maxLr = ctx.resumed ? 1.5e-3 : 3e-3
  const minLr = maxLr / 10
  let ema = 0
  let lastCheckpoint = 0

  try {
    pushLog(job, `entraînement lancé (lot ${B} × contexte ${T})`)
    for (let step = 1; step <= steps; step++) {
      if (job.stopRequested) break
      const lr = learningRate(step, steps, maxLr, minLr)
      const x = new Int32Array(B * T)
      const y = new Int32Array(B * T)
      for (let b = 0; b < B; b++) {
        const s = Math.floor(rng() * maxStart)
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
      job.sessionStep = step
      job.totalSteps = baseSteps + step
      job.lr = lr
      job.loss = ema
      if (step % 5 === 0 || step === 1) {
        job.lossHistory.push({ step: baseSteps + step, loss: Number(ema.toFixed(4)) })
        if (job.lossHistory.length > 300) job.lossHistory.splice(0, job.lossHistory.length - 300)
      }
      if (step % 50 === 0) pushLog(job, `étape ${baseSteps + step} · perte ${ema.toFixed(3)} · lr ${lr.toExponential(2)}`)
      if (step - lastCheckpoint >= 150) {
        lastCheckpoint = step
        await saveCheckpoint(job.modelId, params, baseSteps + step, ema, job.corpusChars, job.corpusSources, { cfg, vocab })
        pushLog(job, `point de contrôle enregistré (étape ${baseSteps + step})`)
      }
      // Cède la main : le chat et les API restent réactifs pendant l'entraînement.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    await saveCheckpoint(job.modelId, params, job.totalSteps, ema, job.corpusChars, job.corpusSources, { cfg, vocab })
    job.status = job.stopRequested ? 'stopped' : 'done'
    pushLog(job, job.stopRequested ? `arrêté à l'étape ${job.totalSteps} — progression sauvegardée` : `terminé · perte finale ${ema.toFixed(3)}`)
  } catch (err) {
    job.status = 'error'
    job.error = err instanceof Error ? err.message : 'erreur inconnue'
    pushLog(job, `erreur : ${job.error}`)
    try {
      await saveCheckpoint(job.modelId, params, job.totalSteps, ema, job.corpusChars, job.corpusSources, { cfg, vocab })
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
