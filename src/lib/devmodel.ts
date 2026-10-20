// ─── NEXUS — L'entraîneur Dev fait progresser le modèle maison ───────────────
// Chaque apprentissage validé par l'agent Dev entre dans le corpus du modèle.
// Quand assez de nouveau savoir s'est accumulé, on relance une reprise
// d'entraînement (poids conservés, vocabulaire et lexique mis à jour) : le
// modèle apprend en continu, sans intervention. Et on le mesure à chaque cycle,
// pour que la progression affichée soit celle de l'IA — pas seulement du savoir.

import { db } from './db'
import { getTrainJob, startTraining } from './llm/train'
import { answerWithLocalModel, loadActiveModel, type LoadedModel } from './llm/engine'
import { CHAT_CONFIG, CHAT_FORMAT, GROUNDED_FORMAT, GROUNDED_CTX } from './llm/model'

/** Nombre d'apprentissages validés à accumuler avant une relance. */
export const RETRAIN_MIN_NEW_ITEMS = 2
/** Étapes d'une mise à jour (reprise du modèle ancré) — environ 15 minutes de calcul. */
export const RETRAIN_STEPS_UPDATE = 400
/** Étapes du premier modèle ancré, créé automatiquement — environ 1 heure de calcul. */
export const RETRAIN_STEPS_FIRST = 1500

/**
 * L'entraînement AUTOMATIQUE du modèle est désactivé par défaut.
 *
 * Pourquoi (mesuré, pas théorique) : un entraînement tourne dans le process du
 * serveur web, et chaque pas est un bloc de calcul synchrone de 3,5 à 5 s. La
 * boucle d'entraînement ne cédait la main qu'aux microtâches, donc les timers ne
 * s'exécutaient jamais entre deux pas : le flux SSE d'une réponse de chat
 * attendait la fin d'un pas à CHAQUE morceau — 71 s pour 20 morceaux au lieu de
 * 180 ms, soit une réponse à 78 s au lieu de ~0,4 s. Un entraînement de 1500 pas
 * (~1 h) rendait simplement le site inutilisable pour sa fonction première :
 * parler avec l'IA.
 *
 * `NEXUS_AUTO_TRAIN=1` rétablit les relances automatiques (le bouton
 * « Entraîner » du tableau de bord, lui, reste toujours disponible : c'est un
 * choix explicite de l'utilisateur). L'entraînement de référence se fait hors
 * ligne avec `node --import tsx scripts/train-chat.ts`, qui exporte les poids
 * livrés dans `public/models/`.
 */
export function autoTrainEnabled(): boolean {
  return process.env.NEXUS_AUTO_TRAIN === '1'
}

/**
 * Le modèle actif est-il reprenable, et dans quel format ?
 *
 * Le test précédent n'acceptait que le format ancré (`grounded-v1`) : le modèle
 * de conversation livré (`chat-v1`) était donc jugé inutilisable à chaque cycle,
 * ce qui réarmait un « premier entraînement » de 1500 pas — et `saveCheckpoint`
 * supprimant les autres lignes, la ligne `nexus-chat` entraînée disparaissait de
 * la base. Les deux formats sont maintenant reconnus.
 */
function resumableFormat(model: LoadedModel | null): 'chat' | 'grounded' | null {
  if (!model) return null
  const { format, ctx, tokenizer } = model.cfg
  const tok = tokenizer ?? 'char'
  if (format === CHAT_FORMAT && ctx === CHAT_CONFIG.ctx && tok === (CHAT_CONFIG.tokenizer ?? 'char')) return 'chat'
  if (format === GROUNDED_FORMAT && ctx === GROUNDED_CTX && tok === 'char') return 'grounded'
  return null
}

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
export async function maybeRetrainModel(opts: { allowed?: boolean } = {}): Promise<RetrainOutcome> {
  // Deux façons d'autoriser l'entraînement en arrière-plan : le réglage persisté
  // de l'espace Dev (`llmTraining`, pilotable par l'agent Dev lui-même) ou la
  // variable d'environnement au démarrage. Ni l'un ni l'autre = on ne lance rien,
  // le chat garde toute la machine.
  if (!opts.allowed && !autoTrainEnabled()) {
    return {
      started: false,
      reason: "entraînement du modèle désactivé — réglage « Modèle de langue » de l'espace Dev ou NEXUS_AUTO_TRAIN=1 (le chat reste prioritaire)",
      steps: 0,
    }
  }
  if (getTrainJob()?.status === 'running') {
    return { started: false, reason: 'un entraînement est déjà en cours', steps: 0 }
  }
  const validItems = await countValidItems()
  const sync = await readSync()
  const model = await loadActiveModel()
  // Un modèle d'un format inconnu ne se reprend pas : on repart sur le format ancré.
  const format = resumableFormat(model)
  const usable = format !== null
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
    await startTraining({ steps, resume: true, format: format === 'chat' ? 'chat' : 'grounded' })
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
