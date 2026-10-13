// Création de compte NEXUS (locale, sans service tiers).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  claimLegacyData,
  countUsers,
  createSession,
  hashPassword,
  isValidEmail,
  passwordIssue,
  parseProfile,
} from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const email = String(body?.email ?? '').trim().toLowerCase()
  const name = String(body?.name ?? '').trim().slice(0, 60)
  const password = String(body?.password ?? '')

  if (!isValidEmail(email) || !EMAIL_RE.test(email)) {
    return Response.json({ error: 'Adresse e-mail invalide.' }, { status: 400 })
  }
  const issue = passwordIssue(password)
  if (issue) return Response.json({ error: issue }, { status: 400 })
  if (password.length > 200) {
    return Response.json({ error: 'Mot de passe trop long.' }, { status: 400 })
  }

  try {
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      return Response.json({ error: 'Cette adresse e-mail est déjà utilisée.' }, { status: 409 })
    }

    const { hash, salt } = hashPassword(password)
    const total = await countUsers()
    const isAdmin = total === 0 // le premier compte est administrateur

    const user = await db.user.create({
      data: {
        email,
        name: name || email.split('@')[0],
        passwordHash: hash,
        salt,
        isAdmin,
        plan: 'owner',
        profile: JSON.stringify({
          displayName: name || email.split('@')[0],
          tone: 'chaleureux',
          language: 'fr',
          theme: 'dark',
          assistantName: 'NEXUS',
          avatarColor: '#a78bfa',
        } satisfies Parameters<typeof parseProfile>[0]),
      },
    })

    // Le tout premier compte récupère les données déjà présentes sur l'instance.
    if (isAdmin) await claimLegacyData(String(user?.id ?? ''))

    await createSession(String(user?.id ?? ''), req.headers.get('user-agent') ?? '')

    return Response.json({
      ok: true,
      user: {
        id: user?.id,
        email: user?.email,
        name: user?.name,
        isAdmin: Boolean(user?.isAdmin),
        plan: user?.plan ?? 'free',
        profile: parseProfile(user?.profile),
        createdAt: user?.createdAt,
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Création de compte impossible' },
      { status: 500 }
    )
  }
}
