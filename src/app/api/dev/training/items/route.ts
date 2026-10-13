// ─── Entrées produites par l'entraînement ────────────────────────────────────
// PATCH  → { id, status } : valider / refuser / remettre en candidat
// DELETE → ?id=… (une entrée) ou ?purge=1 (les entrées jamais utilisées)

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUSES = ['candidat', 'valide', 'rejete']

export async function PATCH(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const status = String(body?.status ?? '')
  if (!id || !STATUSES.includes(status)) {
    return Response.json({ error: 'Identifiant et statut valides requis.' }, { status: 400 })
  }
  const row = await db.trainingItem.update({
    where: { id },
    data: { status, ...(status === 'valide' ? { appliedAt: new Date() } : {}) },
  })
  if (!row) return Response.json({ error: 'Entrée introuvable.' }, { status: 404 })
  return Response.json({ ok: true, item: row })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (id) {
    await db.trainingItem.delete({ where: { id } })
    return Response.json({ ok: true })
  }
  if (url.searchParams.get('purge') === '1') {
    // Purge les entrées rejetées : elles encombrent le suivi sans rien apporter.
    const res = await db.trainingItem
      .deleteMany({ where: { userId: guard.userId, status: 'rejete' } })
      .catch(() => ({ count: 0 }))
    return Response.json({ ok: true, removed: Number(res?.count ?? 0) })
  }
  return Response.json({ error: 'Paramètre `id` ou `purge` requis.' }, { status: 400 })
}
