// ─── Le navigateur de l'agent Dev ────────────────────────────────────────────
// GET    → bibliothèque (pages lues) + statistiques
// POST   → { url } : visiter une page avec le navigateur de l'agent
// DELETE → ?id=… (une page) ou ?all=1 (vider la bibliothèque)

import { devGuard } from '@/lib/auth'
import { browsePage, clearPages, deletePage, listPages, pagesStats } from '@/lib/devbrowser'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  // Liste légère : le tableau de bord n'affiche pas le texte des pages (1,2 Mo renvoyés avant pour 28 pages).
  const [pages, stats] = await Promise.all([listPages(guard.userId, 60, { withText: false }), pagesStats(guard.userId)])
  return Response.json({ pages, stats })
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const url = String(body?.url ?? '').trim()
  if (!url) return Response.json({ error: 'URL requise.' }, { status: 400 })

  const outcome = await browsePage(url, {
    userId: guard.userId,
    origin: 'manuel',
    force: Boolean(body?.force),
  })
  if (!outcome.ok) return Response.json({ error: outcome.error ?? 'Lecture impossible.' }, { status: 400 })
  return Response.json({ ok: true, cached: Boolean(outcome.cached), page: outcome.page })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (id) {
    await deletePage(id)
    return Response.json({ ok: true })
  }
  if (url.searchParams.get('all') === '1') {
    const removed = await clearPages(guard.userId)
    return Response.json({ ok: true, removed })
  }
  return Response.json({ error: 'Paramètre `id` ou `all` requis.' }, { status: 400 })
}
