// Changement du mot de passe du compte courant.

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { destroySession, getCurrentUser, hashPassword, passwordIssue, verifyPassword } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: 'Non connecté.' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const current = String(body?.current ?? '')
  const nextPassword = String(body?.next ?? '')

  const issue = passwordIssue(nextPassword)
  if (issue) return Response.json({ error: issue }, { status: 400 })

  try {
    const row = await db.user.findUnique({ where: { id: user.id } })
    if (!row) return Response.json({ error: 'Compte introuvable.' }, { status: 404 })
    if (!verifyPassword(current, String(row.salt ?? ''), String(row.passwordHash ?? ''))) {
      return Response.json({ error: 'Mot de passe actuel incorrect.' }, { status: 403 })
    }

    const { hash, salt } = hashPassword(nextPassword)
    await db.user.update({ where: { id: user.id }, data: { passwordHash: hash, salt } })
    // Sécurité : on invalide la session courante, l'utilisateur se reconnecte.
    await destroySession()
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Changement impossible' },
      { status: 500 }
    )
  }
}
