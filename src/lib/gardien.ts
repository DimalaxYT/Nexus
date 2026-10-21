// ─── NEXUS — Le Gardien : bot anti-veille (ping IA toutes les minutes) ──────
// Deux sources de ping, même logique :
//   1. INTERNE : le serveur se réveille lui-même chaque minute (production) ;
//   2. EXTERNE : un bot que tu relies depuis l'espace Dev (Réglages → Gardien)
//      appelle GET /api/gardien/ping?token=… toutes les minutes, 24h/24.
// Chaque ping : fait tourner le modèle maison (le « garde » reste chaud), teste
// la base de données et enregistre l'horodatage. Le jeton n'est stocké que
// haché (SHA-256) : il n'est affiché qu'une seule fois à sa création.

import crypto from 'crypto'
import { db } from '@/lib/db'
import { warmUpLocalModel } from '@/lib/llm/engine'

export const GARDIEN_INTERVAL_SEC = 60
export const GARDIEN_PING_PATH = '/api/gardien/ping'

const K = {
  enabled: 'gardien.enabled',
  tokenHash: 'gardien.tokenHash',
  tokenPrefix: 'gardien.tokenPrefix',
  lastPingAt: 'gardien.lastPingAt',
  lastSource: 'gardien.lastSource',
  pingCount: 'gardien.pingCount',
  lastResult: 'gardien.lastResult',
} as const

export interface GardienResult {
  ok: boolean
  at: string
  source: string
  aiReady: boolean
  aiMs: number
  dbMs: number
  error?: string
}

export interface GardienState {
  enabled: boolean
  tokenSet: boolean
  tokenPrefix: string
  intervalSec: number
  pingPath: string
  lastPingAt: string | null
  lastSource: string
  pingCount: number
  lastResult: GardienResult | null
}

async function readSetting(key: string): Promise<string | null> {
  try {
    const row = (await db.siteSetting.findUnique({ where: { key } })) as { value?: unknown } | null
    return row ? String(row.value ?? '') : null
  } catch {
    return null
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  // Une seule requête dans le cas courant (la ligne existe) : la mise à jour
  // renvoie la ligne modifiée, ou null s'il faut la créer.
  const updated = await db.siteSetting.update({ where: { key }, data: { value, updatedBy: 'gardien' } })
  if (!updated) await db.siteSetting.create({ data: { key, value, updatedBy: 'gardien' } })
}

export async function getGardienState(): Promise<GardienState> {
  const [enabled, tokenHash, tokenPrefix, lastPingAt, lastSource, pingCount, lastResult] = await Promise.all([
    readSetting(K.enabled),
    readSetting(K.tokenHash),
    readSetting(K.tokenPrefix),
    readSetting(K.lastPingAt),
    readSetting(K.lastSource),
    readSetting(K.pingCount),
    readSetting(K.lastResult),
  ])
  let parsedResult: GardienResult | null = null
  try {
    parsedResult = lastResult ? (JSON.parse(lastResult) as GardienResult) : null
  } catch {
    parsedResult = null
  }
  return {
    enabled: enabled === null ? true : enabled === '1',
    tokenSet: Boolean(tokenHash),
    tokenPrefix: tokenPrefix ?? '',
    intervalSec: GARDIEN_INTERVAL_SEC,
    pingPath: GARDIEN_PING_PATH,
    lastPingAt,
    lastSource: lastSource ?? '',
    pingCount: Number(pingCount ?? 0),
    lastResult: parsedResult,
  }
}

export async function setGardienEnabled(enabled: boolean): Promise<void> {
  await writeSetting(K.enabled, enabled ? '1' : '0')
}

const hashToken = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex')

/** Génère un nouveau jeton (remplace l'ancien : le bot doit être reconfiguré). */
export async function rotateGardienToken(): Promise<{ token: string; prefix: string }> {
  const token = `ng_${crypto.randomBytes(24).toString('base64url')}`
  const prefix = token.slice(0, 7)
  await writeSetting(K.tokenHash, hashToken(token))
  await writeSetting(K.tokenPrefix, prefix)
  return { token, prefix }
}

/** Vérifie un jeton présenté par le bot (comparaison à temps constant). */
export async function checkGardienToken(raw: string): Promise<boolean> {
  const stored = await readSetting(K.tokenHash)
  if (!stored || !raw) return false
  const a = Buffer.from(hashToken(raw.trim()), 'hex')
  const b = Buffer.from(stored, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Ping complet : modèle maison chaud + aller-retour base. Ne jette jamais. */
export async function runGardienPing(source: string): Promise<GardienResult> {
  const at = new Date().toISOString()
  let aiReady = false
  let aiMs = 0
  let dbMs = 0
  let error: string | undefined
  try {
    const t0 = Date.now()
    const ai = await warmUpLocalModel()
    aiReady = ai.trained
    aiMs = Date.now() - t0
  } catch (err) {
    error = `IA : ${err instanceof Error ? err.message : 'erreur'}`
  }
  try {
    const t1 = Date.now()
    await db.siteSetting.findUnique({ where: { key: K.enabled } })
    dbMs = Date.now() - t1
  } catch (err) {
    error = `${error ? `${error} · ` : ''}base : ${err instanceof Error ? err.message : 'erreur'}`
  }
  const result: GardienResult = { ok: !error, at, source, aiReady, aiMs, dbMs, ...(error ? { error } : {}) }
  // Le ping fait aussi avancer les planifications des blueprints (sans attendre).
  void import('@/lib/blueprint-scheduler').then((m) => m.runDueSchedules()).catch(() => {})
  try {
    const count = Number((await readSetting(K.pingCount)) ?? 0) + 1
    await Promise.all([
      writeSetting(K.pingCount, String(count)),
      writeSetting(K.lastPingAt, at),
      writeSetting(K.lastSource, source.slice(0, 40)),
      writeSetting(K.lastResult, JSON.stringify(result)),
    ])
  } catch {
    /* la base peut être indisponible : le ping reste valide */
  }
  return result
}
