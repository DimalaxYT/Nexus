// Connexion à un compte NEXUS.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, publicUserJson, verifyPassword } from '@/lib/auth'
import { ensureDevBootstrap } from '@/lib/dev-seed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const password = String(body?.password ?? '')

  if (!email || !password) {
    return Response.json({ error: 'E-mail et mot de passe requis.' }, { status: 400 })
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
