// ─── NEXUS — Le Gardien : auto-ping interne & entretien (chaque minute) ─────
// Embarqué, démarré au boot en production :
//   1. ANTI-SOMMEIL : chaque minute, ping du service (/api/health) et ping de
//      l'IA maison (runGardienPing). Sur Render plan gratuit, un service sans
//      trafic s'endort après 15 min : le ping régulier le maintient éveillé.
//      URL déduite de RENDER_EXTERNAL_URL (fourni par Render) ou KEEP_ALIVE_URL.
//   2. ENTRETIEN : purge des sessions expirées et des codes périmés.
// Un bot externe relié depuis Dev → Réglages → Gardien ping aussi, 24h/24.

import { GARDIEN_INTERVAL_SEC, getGardienState, runGardienPing } from '@/lib/gardien'

const INTERVAL_MS = GARDIEN_INTERVAL_SEC * 1000

function selfUrl(): string {
  return (
    process.env.RENDER_EXTERNAL_URL?.trim() ||
    process.env.KEEP_ALIVE_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT ?? '3000'}`
  )
}

let started = false

export function startKeepAlive(): void {
  if (started) return
  started = true
  const url = selfUrl()

  const tick = async () => {
    // 1. Ping du service (keep-alive Render), avec délai maximal.
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'NEXUS-Gardien/1.0' },
      })
      if (!res.ok) console.warn(`[gardien] santé : HTTP ${res.status}`)
    } catch (err) {
      console.warn('[gardien] ping santé échoué :', err instanceof Error ? err.message : err)
    } finally {
      clearTimeout(timer)
    }

    // 2. Ping de l'IA maison (si le Gardien est activé dans les réglages Dev).
    try {
      const state = await getGardienState()
      if (state.enabled) {
        const r = await runGardienPing('interne')
        if (!r.ok) console.warn(`[gardien] ping IA : ${r.error}`)
      }
    } catch {
      /* base pas encore prête : prochain cycle */
    }

    // 3. Planifications des blueprints (assistants qui tournent seuls)
    try {
      const { runDueSchedules } = await import('@/lib/blueprint-scheduler')
      await runDueSchedules()
    } catch {
      /* base pas prête : prochain cycle */
    }

    // 4. Entretien de la base (sessions expirées, codes consommés/périmés)
    try {
      const { db } = await import('@/lib/db')
      const sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: Date.now() } } })).count
      const codes = (await db.verificationCode.deleteMany({ where: { expiresAt: { lt: Date.now() - 60 * 60 * 1000 } } })).count
      if (sessions > 0 || codes > 0) {
        console.log(`[gardien] entretien : ${sessions} session(s) et ${codes} code(s) purgés`)
      }
    } catch {
      /* la base n'est pas encore prête : on retentera au prochain cycle */
    }
  }

  // Premier passage ~15 s après le boot, puis toutes les minutes.
  setTimeout(() => void tick(), 15_000)
  setInterval(() => void tick(), INTERVAL_MS)
  console.log(`[gardien] armé — ping chaque minute (santé + IA) vers ${url}`)
}
