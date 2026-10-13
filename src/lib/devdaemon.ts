// ─── NEXUS — Daemon d'entraînement (l'agent Dev tourne 24 h/24) ──────────────
// Une boucle légère dans le process serveur : à chaque minute elle regarde si
// un cycle doit partir (cadence, heures creuses, quota quotidien) et le lance
// en tâche de fond. Rien n'est bloquant, et un verrou en base empêche deux
// process (ou deux onglets de build) de lancer le même cycle.

import { getDevUserId } from './dev-seed'
import { getTrainerConfig, runTrainingCycle, type CycleReport, type TrainerConfig } from './devtrainer'

const TICK_MS = 60_000
const LOCK_TTL_MS = 6 * 60_000
const BACKOFF_MS = [0, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000] as const

export interface DaemonState {
  /** Le daemon est-il monté dans ce process ? */
  alive: boolean
  /** L'entraînement est-il actif (config) ? */
  enabled: boolean
  /** Un cycle est-il en cours ? */
  running: boolean
  startedAt: number | null
  lastRunAt: number | null
  nextRunAt: number | null
  cyclesToday: number
  dayKey: string
  consecutiveErrors: number
  lastError: string
  lastReport: {
    objective: string
    mode: string
    pages: number
    items: number
    scoreBefore: number
    scoreAfter: number
    at: number
  } | null
  ticks: number
}

type Mutable = {
  state: DaemonState
  timer: ReturnType<typeof setInterval> | null
  pid: number
}

const g = globalThis as unknown as { __nexusDevDaemon?: Mutable }

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function initialState(): DaemonState {
  return {
    alive: false,
    enabled: true,
    running: false,
    startedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    cyclesToday: 0,
    dayKey: dayKey(),
    consecutiveErrors: 0,
    lastError: '',
    lastReport: null,
    ticks: 0,
  }
}

function slot(): Mutable {
  if (!g.__nexusDevDaemon) {
    g.__nexusDevDaemon = { state: initialState(), timer: null, pid: process.pid }
  }
  return g.__nexusDevDaemon
}

// ── Verrou inter-process ─────────────────────────────────────────────────────

import { db } from './db'

const LOCK_KEY = 'dev.daemon.lock'

async function acquireLock(): Promise<boolean> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: LOCK_KEY } })
    const raw = String((row as { value?: unknown })?.value ?? '').trim()
    const now = Date.now()
    if (raw) {
      const parsed = JSON.parse(raw) as { at?: number; pid?: number }
      const at = Number(parsed.at ?? 0)
      if (Number.isFinite(at) && now - at < LOCK_TTL_MS && parsed.pid !== process.pid) return false
    }
    const payload = JSON.stringify({ at: now, pid: process.pid })
    if (row) await db.siteSetting.update({ where: { key: LOCK_KEY }, data: { value: payload } })
    else await db.siteSetting.create({ data: { key: LOCK_KEY, value: payload, updatedBy: 'daemon' } })
    return true
  } catch {
    return false
  }
}

async function releaseLock(): Promise<void> {
  try {
    await db.siteSetting
      .update({ where: { key: LOCK_KEY }, data: { value: JSON.stringify({ at: 0, pid: process.pid }) } })
      .catch(() => {})
  } catch {
    /* rien */
  }
}

// ── Planification ────────────────────────────────────────────────────────────

function inQuietHours(config: TrainerConfig, now = new Date()): boolean {
  const { quietFrom, quietTo } = config
  if (quietFrom === quietTo) return false
  const h = now.getHours()
  return quietFrom < quietTo ? h >= quietFrom && h < quietTo : h >= quietFrom || h < quietTo
}

function computeNextRun(config: TrainerConfig, state: DaemonState, now = Date.now()): number | null {
  if (!config.enabled) return null
  if (state.consecutiveErrors > 0) {
    const backoff = BACKOFF_MS[Math.min(state.consecutiveErrors, BACKOFF_MS.length - 1)]
    return (state.lastRunAt ?? now) + backoff
  }
  return (state.lastRunAt ?? now) + Math.max(5, config.intervalMin) * 60_000
}

// ── Boucle ───────────────────────────────────────────────────────────────────

export async function tick(): Promise<void> {
  const s = slot()
  s.state.ticks++
  if (s.state.running) return

  const config = await getTrainerConfig()
  s.state.enabled = config.enabled
  if (!config.enabled) {
    s.state.nextRunAt = null
    return
  }

  const today = dayKey()
  if (s.state.dayKey !== today) {
    s.state.dayKey = today
    s.state.cyclesToday = 0
  }
  if (s.state.cyclesToday >= Math.max(1, config.maxCyclesPerDay)) return
  if (inQuietHours(config)) {
    s.state.nextRunAt = null
    return
  }

  const now = Date.now()
  const due = s.state.nextRunAt === null ? true : now >= s.state.nextRunAt
  if (!due) return

  const userId = await getDevUserId()
  if (!userId) return // pas encore de compte Dev : on attend

  if (!(await acquireLock())) return

  s.state.running = true
  s.state.lastRunAt = now
  try {
    const report = await runTrainingCycle(userId, { trigger: 'auto' })
    s.state.consecutiveErrors = report.error ? s.state.consecutiveErrors + 1 : 0
    s.state.lastError = report.error ?? ''
    s.state.cyclesToday += 1
    s.state.lastReport = {
      objective: report.objective,
      mode: report.mode,
      pages: report.pages,
      items: report.items,
      scoreBefore: report.scoreBefore,
      scoreAfter: report.scoreAfter,
      at: Date.now(),
    }
    if (!report.error) {
      console.log(
        `[dev-daemon] cycle « ${report.objective} » — ${report.pages} page(s), ${report.items} entrée(s), ` +
          `couverture ${Math.round(report.scoreBefore * 100)} % → ${Math.round(report.scoreAfter * 100)} %`
      )
    }
  } catch (err) {
    s.state.consecutiveErrors += 1
    s.state.lastError = err instanceof Error ? err.message : 'erreur inconnue'
  } finally {
    s.state.running = false
    await releaseLock()
    s.state.nextRunAt = computeNextRun(config, s.state)
  }
}

/** Monte la boucle (idempotent : ne fait rien si elle tourne déjà). */
export function startDevDaemon(): void {
  const s = slot()
  if (s.timer) return
  s.state.alive = true
  s.state.startedAt = Date.now()
  s.timer = setInterval(() => {
    void tick().catch(() => {})
  }, TICK_MS)
  // Ne retient pas le process : le serveur HTTP le maintient en vie.
  if (typeof s.timer.unref === 'function') s.timer.unref()
  console.log('[dev-daemon] entraînement de NEXUS armé (cycles automatiques)')
  // Premier cycle peu après le démarrage, si la cadence l'autorise.
  setTimeout(() => {
    void tick().catch(() => {})
  }, 20_000).unref?.()
}

export function stopDevDaemon(): void {
  const s = slot()
  if (s.timer) clearInterval(s.timer)
  s.timer = null
  s.state.alive = false
  s.state.nextRunAt = null
}

/** Recalcule la prochaine exécution après un changement de configuration. */
export async function reschedule(): Promise<void> {
  const s = slot()
  const config = await getTrainerConfig()
  s.state.enabled = config.enabled
  s.state.consecutiveErrors = 0
  s.state.nextRunAt = config.enabled ? Date.now() : null
}

/** Lance un cycle tout de suite (bouton « Forcer un cycle »). */
export async function runNow(objectiveId?: string): Promise<CycleReport | { error: string }> {
  const s = slot()
  if (s.state.running) return { error: 'Un cycle est déjà en cours.' }
  const userId = await getDevUserId()
  if (!userId) return { error: 'Aucun compte développeur sur cette instance.' }
  s.state.running = true
  try {
    const report = await runTrainingCycle(userId, { trigger: 'manuel', objectiveId })
    s.state.lastRunAt = Date.now()
    s.state.lastError = report.error ?? ''
    s.state.lastReport = {
      objective: report.objective,
      mode: report.mode,
      pages: report.pages,
      items: report.items,
      scoreBefore: report.scoreBefore,
      scoreAfter: report.scoreAfter,
      at: Date.now(),
    }
    const config = await getTrainerConfig()
    s.state.nextRunAt = computeNextRun(config, s.state)
    return report
  } finally {
    s.state.running = false
  }
}

export function getDaemonState(): DaemonState & { minutesToNext: number | null } {
  const s = slot()
  const next = s.state.nextRunAt
  return {
    ...s.state,
    minutesToNext: next ? Math.max(0, Math.round((next - Date.now()) / 60_000)) : null,
  }
}
