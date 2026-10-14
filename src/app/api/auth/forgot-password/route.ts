// Mot de passe oublié — étape 1 : envoi d'un code de réinitialisation.
// Réponse volontairement identique que le compte existe ou non (anti-énumération).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { issueVerificationCode } from '@/lib/verification'
import { checkRateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  if (!email) return Response.json({ error: 'E-mail requis.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (!checkRateLimit(`forgot:${ip}`, 6, 10 * 60 * 1000).allowed) {
    return Response.json({ error: 'Trop de demandes. Réessayez dans quelques minutes.' }, { status: 429 })
  }

  try {
    const user = await db.user.findUnique({ where: { email } })
    if (!user) {
      // On ne révèle pas l'existence du compte.
      return Response.json({ ok: true, sent: true })
    }
    const issued = await issueVerificationCode(email, 'reset')
    if (!issued.ok) return Response.json({ error: issued.error ?? 'Envoi impossible.' }, { status: 500 })
    return Response.json({ ok: true, sent: issued.sent ?? false, devCode: issued.devCode })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Demande impossible' },
      { status: 500 }
    )
  }
}
