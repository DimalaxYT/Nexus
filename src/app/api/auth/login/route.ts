// Connexion à un compte NEXUS — e-mail + mot de passe, session directe.
// (La double authentification par code e-mail a été retirée : la connexion est
// de nouveau en une seule étape. Le lien « Mot de passe oublié ? » reste dispo.)

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, publicUserJson, verifyPassword } from '@/lib/auth'
import { ensureDevBootstrap } from '@/lib/dev-seed'
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

    await createSession(String(user.id), req.headers.get('user-agent') ?? '')

    return Response.json({ ok: true, user: publicUserJson(user) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Connexion impossible' },
      { status: 500 }
    )
  }
}
