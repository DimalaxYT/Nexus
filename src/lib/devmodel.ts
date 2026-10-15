// ─── NEXUS — L'entraîneur Dev fait progresser le modèle maison ───────────────
// Chaque apprentissage validé par l'agent Dev entre dans le corpus du modèle.
// Quand assez de nouveau savoir s'est accumulé, on relance une reprise
// d'entraînement (poids conservés, vocabulaire et lexique mis à jour) : le
// modèle apprend en continu, sans intervention. Et on le mesure à chaque cycle,
// pour que la progression affichée soit celle de l'IA — pas seulement du savoir.

import { db } from './db'
import { getTrainJob, startTraining } from './llm/train'
import { answerWithLocalModel, loadActiveModel } from './llm/engine'
import { GROUNDED_FORMAT, GROUNDED_CTX } from './llm/model'

/** Nombre d'apprentissages validés à accumuler avant une relance. */
export const RETRAIN_MIN_NEW_ITEMS = 2
/** Étapes d'une mise à jour (reprise du modèle ancré) — environ 15 minutes de calcul. */
export const RETRAIN_STEPS_UPDATE = 400
/** Étapes du premier modèle ancré, créé automatiquement — environ 1 heure de calcul. */
export const RETRAIN_STEPS_FIRST = 1500

const SYNC_KEY = 'dev.llm.sync'

interface SyncState {
  /** Nombre d'apprentissages validés au moment de la dernière relance. */
  validItems: number
  at: string | null
  steps: number
}

async function readSync(): Promise<SyncState> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: SYNC_KEY } })
    const parsed = JSON.parse(String((row as { value?: unknown })?.value ?? '{}')) as Partial<SyncState>
    return { validItems: Number(parsed.validItems ?? 0), at: parsed.at ?? null, steps: Number(parsed.steps ?? 0) }
  } catch {
    return { validItems: 0, at: null, steps: 0 }
  }
}

async function writeSync(state: SyncState): Promise<void> {
  const value = JSON.stringify(state)
  const existing = await db.siteSetting.findUnique({ where: { key: SYNC_KEY } })
  if (existing) {
    await db.siteSetting.update({ where: { key: SYNC_KEY }, data: { value } })
  } else {
    await db.siteSetting.create({ data: { key: SYNC_KEY, value, updatedBy: 'dev' } })
  }
}

/** Apprentissages validés : exactement ceux que le corpus du modèle lit. */
async function countValidItems(): Promise<number> {
  const rows = await db.trainingItem
    .findMany({ where: { status: { in: ['valide', 'applique'] } }, take: 2000 })
    .catch(() => [])
  return (rows ?? []).length
}

export interface RetrainOutcome {
  started: boolean
  reason: string
  steps: number
}

/**
 * Relance l'entraînement en arrière-plan si assez de savoir nouveau existe.
 * Ne bloque jamais : startTraining rend la main dès que la boucle tourne.
 */
export async function maybeRetrainModel(): Promise<RetrainOutcome> {
  if (getTrainJob()?.status === 'running') {
    return { started: false, reason: 'un entraînement est déjà en cours', steps: 0 }
  }
  const validItems = await countValidItems()
  const sync = await readSync()
  const model = await loadActiveModel()
  // Un ancien modèle (autre format) ne se reprend pas : on repart sur le format ancré.
  const usable = Boolean(model && model.cfg.format === GROUNDED_FORMAT && model.cfg.ctx === GROUNDED_CTX)
  const fresh = Math.max(0, validItems - sync.validItems)

  if (usable && fresh < RETRAIN_MIN_NEW_ITEMS) {
    return {
      started: false,
      reason: `${fresh} nouvel apprentissage(s) — relance à partir de ${RETRAIN_MIN_NEW_ITEMS}`,
      steps: 0,
    }
  }

  const steps = usable ? RETRAIN_STEPS_UPDATE : RETRAIN_STEPS_FIRST
  try {
    await startTraining({ steps, resume: true })
  } catch (err) {
    return { started: false, reason: err instanceof Error ? err.message : 'entraînement impossible', steps: 0 }
  }
  await writeSync({ validItems, at: new Date().toISOString(), steps })
  return {
    started: true,
    reason: usable
      ? `mise à jour : +${fresh} apprentissage(s), ${steps} étapes`
      : `premier entraînement : ${steps} étapes`,
    steps,
  }
}

/** Questions tirées des apprentissages validés, pour mesurer le modèle. */
export async function validQuestions(limit = 6): Promise<string[]> {
  const rows = await db.trainingItem
    .findMany({ where: { status: { in: ['valide', 'applique'] } }, orderBy: { createdAt: 'desc' }, take: limit })
    .catch(() => [])
  return (rows ?? []).map((r) => String(r.question ?? '')).filter(Boolean)
}

export interface ModelProbe {
  answered: number
  total: number
  ms: number
}

/**
 * Mesure le modèle : combien de questions reçoivent une réponse qui passe le
 * garde-fou (confiance + lexique). null si aucun modèle n'est entraîné.
 */
export async function probeModel(questions: string[]): Promise<ModelProbe | null> {
  const model = await loadActiveModel()
  if (!model || questions.length === 0) return null
  const t0 = Date.now()
  let answered = 0
  for (const q of questions) {
    const r = await answerWithLocalModel(q).catch(() => null)
    if (r && r.ok) answered++
  }
  return { answered, total: questions.length, ms: Date.now() - t0 }
}
