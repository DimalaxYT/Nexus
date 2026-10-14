// Connexion à un compte NEXUS — étape 2 : vérification du code e-mail (2FA).
// Le code correct ouvre la session (cookie httpOnly).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, publicUserJson } from '@/lib/auth'
import { verifyVerificationCode } from '@/lib/verification'
import { checkRateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const code = String(body?.code ?? '').trim()

  if (!email || !code) return Response.json({ error: 'E-mail et code requis.' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (!checkRateLimit(`verify:${ip}`, 20, 5 * 60 * 1000).allowed) {
    return Response.json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }, { status: 429 })
  }

  try {
    const check = await verifyVerificationCode(email, 'login', code)
    if (!check.ok) return Response.json({ error: check.error }, { status: 401 })

    const user = await db.user.findUnique({ where: { email } })
    if (!user) return Response.json({ error: 'Compte introuvable.' }, { status: 404 })

    await createSession(String(user.id), req.headers.get('user-agent') ?? '')
    return Response.json({ ok: true, user: publicUserJson(user) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Vérification impossible' },
      { status: 500 }
    )
  }
}
