// Réglages du Gardien (espace Dev) : activation, jeton du bot externe, test.
// GET  → état (sans le jeton, seulement son préfixe)
// POST → { action: 'enable' | 'token' | 'test', enabled? }

import { devGuard } from '@/lib/auth'
import { getGardienState, rotateGardienToken, runGardienPing, setGardienEnabled } from '@/lib/gardien'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  return Response.json(await getGardienState())
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const action = String(body?.action ?? '')
  try {
    if (action === 'enable') {
      await setGardienEnabled(Boolean(body?.enabled))
      return Response.json({ ok: true, state: await getGardienState() })
    }
    if (action === 'token') {
      // Le jeton n'est affiché QU'UNE FOIS : il faut le copier dans le bot tout de suite.
      const { token, prefix } = await rotateGardienToken()
      return Response.json({ ok: true, token, prefix, state: await getGardienState() })
    }
    if (action === 'test') {
      const result = await runGardienPing('test-dashboard')
      return Response.json({ ok: result.ok, result, state: await getGardienState() })
    }
    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Action impossible' }, { status: 500 })
  }
}
