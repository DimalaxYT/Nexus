// Connexion à un compte NEXUS.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { createSession, parseProfile, verifyPassword } from '@/lib/auth'

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
    const user = await db.user.findUnique({ where: { email } })
    if (!user) return Response.json({ error: 'Identifiants incorrects.' }, { status: 401 })

    const ok = verifyPassword(password, String(user.salt ?? ''), String(user.passwordHash ?? ''))
    if (!ok) return Response.json({ error: 'Identifiants incorrects.' }, { status: 401 })

    await createSession(String(user.id), req.headers.get('user-agent') ?? '')

    return Response.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: Boolean(user.isAdmin),
        plan: user.plan ?? 'free',
        profile: parseProfile(user.profile),
        createdAt: user.createdAt,
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Connexion impossible' },
      { status: 500 }
    )
  }
}
