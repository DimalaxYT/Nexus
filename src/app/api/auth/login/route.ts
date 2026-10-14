// Connexion à un compte NEXUS — étape 1 : e-mail + mot de passe.
// Si les identifiants sont bons, un code à 6 chiffres est envoyé par e-mail
// (2FA). La session n'est créée qu'après vérification du code (route
// /api/auth/verify). Sans SMTP configuré, le code est renvoyé en `devCode`
// (mode développement / preview).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { publicUserJson, verifyPassword } from '@/lib/auth'
import { ensureDevBootstrap } from '@/lib/dev-seed'
import { issueVerificationCode } from '@/lib/verification'
import { checkRateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!email || !password) {
    return Response.json({ error: 'E-mail et mot de passe requis.' }, { status: 400 })
  }

  // Anti force brute : 10 tentatives / 5 minutes / IP.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  if (!checkRateLimit(`login:${ip}`, 10, 5 * 60 * 1000).allowed) {
    return Response.json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }, { status: 429 })
  }

  try {
    // Le compte Dev est créé à la volée s'il n'existe pas encore : on peut donc
    // se connecter en « dev » même sur un serveur qui vient de démarrer.
    await ensureDevBootstrap()
    const user = await db.user.findUnique({ where: { email } })
    if (!user) return Response.json({ error: 'Identifiants incorrects.' }, { status: 401 })

    const ok = verifyPassword(password, String(user.salt ?? ''), String(user.passwordHash ?? ''))
    if (!ok) return Response.json({ error: 'Identifiants incorrects.' }, { status: 401 })

    // Identifiants valides → envoi du code de vérification (pas encore de session).
    const issued = await issueVerificationCode(email, 'login')
    if (!issued.ok) {
      return Response.json({ error: issued.error ?? 'Envoi du code impossible.' }, { status: 500 })
    }

    return Response.json({
      ok: true,
      needsCode: true,
      email,
      previewName: publicUserJson(user).name,
      devCode: issued.devCode,
      smtp: issued.sent ? 'envoyé' : 'non configuré',
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Connexion impossible' },
      { status: 500 }
    )
  }
}
