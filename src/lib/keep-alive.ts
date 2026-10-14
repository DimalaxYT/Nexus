// ─── NEXUS — Le Gardien : auto-ping & entretien (bot interne) ────────────────
// Bot multicompétences embarqué, démarré au boot en production :
//   1. ANTI-SOMMEIL : ping /api/health toutes les 10 minutes. Sur Render plan
//      gratuit, un service sans trafic s'endort après 15 min — le ping régulier
//      le maintient éveillé (autorisé par Render). URL déduite de
//      RENDER_EXTERNAL_URL (fourni par Render) ou KEEP_ALIVE_URL.
//   2. ENTRETIEN : purge des sessions expirées et des codes de vérification
//      périmés, et journalisation de la mémoire du process.

const INTERVAL_MS = 10 * 60 * 1000 // toutes les 10 minutes

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
    // 1. Ping du service (keep-alive Render)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(`${url}/api/health`, {
        signal: ctrl.signal,
        headers: { 'user-agent': 'NEXUS-Gardien/1.0' },
      })
      const rss = Math.round(process.memoryUsage().rss / 1024 / 1024)
      console.log(`[gardien] ping ${res.ok ? 'OK' : `HTTP ${res.status}`} — RSS ${rss} Mo`)
    } catch (err) {
      console.warn('[gardien] ping échoué :', err instanceof Error ? err.message : err)
    } finally {
      clearTimeout(timer)
    }

    // 2. Entretien de la base (sessions expirées, codes consommés/périmés)
    try {
      const { db } = await import('@/lib/db')
      const sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: Date.now() } } })).count
      const codes = (
        await db.verificationCode.deleteMany({
          where: { expiresAt: { lt: Date.now() - 60 * 60 * 1000 } },
        })
      ).count
      if (sessions > 0 || codes > 0) {
        console.log(`[gardien] entretien : ${sessions} session(s) et ${codes} code(s) purgés`)
      }
    } catch {
      /* la base n'est pas encore prête : on retentera au prochain cycle */
    }
  }

  // Premier passage ~15 s après le boot, puis toutes les 10 minutes.
  setTimeout(() => void tick(), 15_000)
  setInterval(() => void tick(), INTERVAL_MS)
  console.log(`[gardien] armé — auto-ping toutes les 10 min vers ${url}/api/health`)
}
