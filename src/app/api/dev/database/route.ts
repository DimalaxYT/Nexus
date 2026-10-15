// Base de données (Turso ou locale) pilotée depuis l'espace Dev → Réglages.
// GET  → cible courante, réglages enregistrés (jeton jamais renvoyé), statistiques
// POST → { action, url?, token? }
//   • test        : ouvre la cible Turso saisie et vérifie la connexion (sans rien changer)
//   • save        : enregistre Turso comme base active (sans copier les données)
//   • migrate     : copie TOUTES les données de la base actuelle vers Turso, puis bascule
//   • use-local   : repasse sur la base locale (fichier)
//   • forget      : supprime la configuration enregistrée (retour à la résolution par défaut)

import { devGuard } from '@/lib/auth'
import { clearDbConfig, describeSource, localSource, resolveSource, saveDbConfig, tursoSourceFrom, isValidTursoUrl, normalizeTursoUrl, type DbSource } from '@/lib/db-source'
import { copyDatabase, currentClient, currentDatabase, databaseStats, openTarget, switchDatabase } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

async function pingTarget(source: DbSource): Promise<{ latencyMs: number }> {
  const c = await openTarget(source)
  try {
    const t0 = Date.now()
    await c.execute('SELECT 1 AS ok')
    return { latencyMs: Date.now() - t0 }
  } finally {
    try {
      c.close()
    } catch {
      /* déjà fermé */
    }
  }
}

/** Source Turso demandée : le jeton saisi, ou celui déjà enregistré si le champ est vide. */
function requestedTurso(body: Record<string, unknown>): { source: DbSource | null; error?: string } {
  const url = normalizeTursoUrl(String(body.url ?? ''))
  if (!url) return { source: null, error: 'Adresse Turso requise (libsql://…turso.io).' }
  if (!isValidTursoUrl(url)) return { source: null, error: 'Adresse Turso invalide.' }
  let token = String(body.token ?? '').trim()
  if (!token) {
    const current = resolveSource()
    if (current.mode === 'turso') token = current.authToken
  }
  if (!token) return { source: null, error: 'Jeton Turso requis (TURSO_AUTH_TOKEN ou jeton créé dans la console Turso).' }
  return { source: tursoSourceFrom(url, token) }
}

async function snapshot() {
  const saved = describeSource()
  let stats: Awaited<ReturnType<typeof databaseStats>> | null = null
  let statsError = ''
  try {
    stats = await databaseStats()
  } catch (err) {
    statsError = err instanceof Error ? err.message : 'statistiques indisponibles'
  }
  return { current: currentDatabase(), saved, stats, statsError }
}

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    return Response.json(await snapshot())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lecture impossible' }, { status: 500 })
  }
}

/** Ping Turso sans lever d'exception : renvoie null si la cible ne répond pas. */
async function pingUpstream(target: Parameters<typeof pingTarget>[0]): Promise<{ latencyMs: number | null }> {
  try {
    return { latencyMs: (await pingTarget(target)).latencyMs }
  } catch {
    return { latencyMs: null }
  }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const action = String(body?.action ?? '')

  try {
    if (action === 'use-local') {
      saveDbConfig({ mode: 'local' })
      await switchDatabase(localSource())
      return Response.json({ ok: true, message: 'Base locale active.', ...(await snapshot()) })
    }

    if (action === 'forget') {
      clearDbConfig()
      await switchDatabase(resolveSource())
      return Response.json({ ok: true, message: 'Configuration Dev supprimée : retour à la résolution par défaut.', ...(await snapshot()) })
    }

    const wanted = requestedTurso(body ?? {})
    if (!wanted.source) return Response.json({ error: wanted.error }, { status: 400 })
    const target = wanted.source

    if (action === 'test') {
      const { latencyMs } = await pingUpstream(target)
      if (latencyMs === null) return Response.json({ error: 'Turso injoignable : vérifie l’URL et le jeton.' }, { status: 502 })
      return Response.json({ ok: true, latencyMs, message: `Turso joignable (${latencyMs} ms). Rien n'a été changé.` })
    }

    if (action === 'save') {
      if ((await pingUpstream(target)).latencyMs === null) {
        return Response.json({ error: 'Turso injoignable : enregistrement annulé.' }, { status: 502 })
      }
      saveDbConfig({ mode: 'turso', tursoUrl: target.url, tursoToken: target.authToken })
      await switchDatabase(resolveSource())
      return Response.json({ ok: true, message: 'Turso est maintenant la base active.', ...(await snapshot()) })
    }

    if (action === 'migrate') {
      // 1. Vérifie la cible, 2. copie intégrale, 3. enregistre et bascule.
      const from = await currentClient()
      const to = await openTarget(target)
      let copied: { tables: number; rows: number }
      try {
        copied = await copyDatabase(from, to)
      } finally {
        try {
          to.close()
        } catch {
          /* déjà fermé */
        }
      }
      saveDbConfig({ mode: 'turso', tursoUrl: target.url, tursoToken: target.authToken })
      await switchDatabase(resolveSource())
      return Response.json({
        ok: true,
        copied,
        message: `Migration terminée : ${copied.rows} ligne(s) dans ${copied.tables} table(s) copiée(s) vers Turso.`,
        ...(await snapshot()),
      })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Opération impossible' }, { status: 500 })
  }
}
