// ─── NEXUS — Health check (Render, moniteurs de disponibilité) ────────────────
// Vérifie que le serveur répond ET que la base (SQLite locale ou Turso) est lisible.
// À utiliser comme « Health Check Path » sur Render : /api/health

import { currentDatabase, db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function dbLabel(): string {
  const cur = currentDatabase()
  if (cur.mode === 'local') return 'sqlite (locale)'
  return cur.replica ? (cur.stale ? 'turso (réplique en retard)' : 'turso (réplique locale)') : 'turso (direct)'
}

export async function GET() {
  try {
    await db.siteSetting.count()
    return Response.json({
      status: 'ok',
      db: dbLabel(),
      brain: 'local (aucun service externe)',
      ts: new Date().toISOString(),
    })
  } catch (err) {
    return Response.json(
      {
        status: 'error',
        db: 'base illisible',
        error: err instanceof Error ? err.message : 'erreur inconnue',
      },
      { status: 500 }
    )
  }
}
