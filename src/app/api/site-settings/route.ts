// ─── Réglages du site (lecture publique, écriture réservée au compte Dev) ────
// La lecture est ouverte : l'écran de connexion doit pouvoir afficher le nom et
// les couleurs de l'instance avant même qu'on soit connecté.

import { devGuard } from '@/lib/auth'
import { getSiteSettings, resetSiteSettings, saveSiteSettings } from '@/lib/site-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const settings = await getSiteSettings()
    return Response.json({ settings })
  } catch {
    return Response.json({ settings: null })
  }
}

export async function PUT(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Réglages attendus.' }, { status: 400 })
  }
  try {
    const settings = await saveSiteSettings(body, guard.userId)
    return Response.json({ ok: true, settings })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Enregistrement impossible' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    const settings = await resetSiteSettings(guard.userId)
    return Response.json({ ok: true, settings })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Réinitialisation impossible' },
      { status: 500 }
    )
  }
}
