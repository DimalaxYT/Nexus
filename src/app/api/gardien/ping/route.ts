// Point d'entrée du bot externe du Gardien (anti-veille). Protégé par jeton.
// Exemple (à appeler toutes les minutes) : GET /api/gardien/ping?token=ng_…
// ou en-tête « Authorization: Bearer ng_… ». Le jeton se crée dans Dev → Réglages.

import { NextRequest } from 'next/server'
import { checkGardienToken, getGardienState, runGardienPing } from '@/lib/gardien'
import { checkRateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handle(req: NextRequest) {
  const header = req.headers.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7) : ''
  const token = bearer || req.nextUrl.searchParams.get('token') || ''
  // Un bot qui ping chaque minute reste loin de cette limite (120 / 10 min).
  if (!checkRateLimit('gardien:ping', 120, 10 * 60 * 1000).allowed) {
    return Response.json({ ok: false, error: 'Trop de pings.' }, { status: 429 })
  }
  if (!(await checkGardienToken(token))) {
    return Response.json({ ok: false, error: 'Jeton invalide.' }, { status: 401 })
  }
  const state = await getGardienState()
  if (!state.enabled) {
    return Response.json({ ok: false, error: 'Gardien désactivé dans les réglages Dev.' }, { status: 403 })
  }
  const result = await runGardienPing('bot-externe')
  return Response.json({ ...result, intervalSec: state.intervalSec }, { status: result.ok ? 200 : 503 })
}

export const GET = handle
export const POST = handle
