// ─── NEXUS — Health check (Render, moniteurs de disponibilité) ────────────────
// Vérifie que le serveur répond ET que la base SQLite locale est lisible.
// À utiliser comme « Health Check Path » sur Render : /api/health

import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.siteSetting.count()
    return Response.json({
      status: 'ok',
      db: 'sqlite (locale)',
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
