// Mot de passe oublié — étape 2 : code valide + nouveau mot de passe.
// Le code « reset » vérifié ouvre une fenêtre de 10 minutes (jeton signé en
// base, table VerificationCode, purpose='reset-token') pour poser le mot de
// passe. Toutes les sessions du compte sont révoquées après le changement.

import crypto from 'crypto'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/auth'
import { verifyVerificationCode } from '@/lib/verification'
import { checkRateLimit } from '@/lib/security'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIN_LEN = 8

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const step = String(body?.step ?? 'verify') // 'verify' | 'apply'

  // ── Étape « verify » : le code est vérifié, un jeton de reset est émis. ────
  if (step === 'verify') {
    const email = String(body?.email ?? '').trim().toLowerCase()
    const code = String(body?.code ?? '').trim()
    if (!email || !code) return Response.json({ error: 'E-mail et code requis.' }, { status: 400 })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (!checkRateLimit(`resetv:${ip}`, 20, 5 * 60 * 1000).allowed) {
      return Response.json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' }, { status: 429 })
    }

    try {
      const check = await verifyVerificationCode(email, 'reset', code)
      if (!check.ok) return Response.json({ error: check.error }, { status: 401 })

      const user = await db.user.findUnique({ where: { email } })
      if (!user) return Response.json({ error: 'Compte introuvable.' }, { status: 404 })

      const token = crypto.randomBytes(32).toString('hex')
      await db.verificationCode.create({
        data: {
          email,
          codeHash: crypto.createHash('sha256').update(`reset-token::${token}`).digest('hex'),
          purpose: 'reset-token',
          attempts: 0,
          consumed: false,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      })
      return Response.json({ ok: true, resetToken: token })
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Vérification impossible' },
        { status: 500 }
      )
    }
  }

  // ── Étape « apply » : jeton valide + nouveau mot de passe. ─────────────────
  if (step === 'apply') {
    const email = String(body?.email ?? '').trim().toLowerCase()
    const token = String(body?.resetToken ?? '').trim()
    const password = String(body?.password ?? '')
    if (!email || !token) return Response.json({ error: 'Jeton de réinitialisation manquant.' }, { status: 400 })
    if (password.length < MIN_LEN || !/\d/.test(password)) {
      return Response.json({ error: `Le mot de passe doit contenir au moins ${MIN_LEN} caractères (dont un chiffre).` }, { status: 400 })
    }

    try {
      const rows = await db.verificationCode.findMany({
        where: { email, purpose: 'reset-token', consumed: false },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })
      const row = rows[0] as { id: string; codeHash: string; expiresAt: Date } | undefined
      if (!row) return Response.json({ error: 'Jeton invalide : recommencez la procédure.' }, { status: 401 })
      if (new Date(row.expiresAt as unknown as Date).getTime() < Date.now()) {
        return Response.json({ error: 'Jeton expiré : recommencez la procédure.' }, { status: 401 })
      }

      const given = crypto.createHash('sha256').update(`reset-token::${token}`).digest('hex')
      if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(row.codeHash)))) {
        return Response.json({ error: 'Jeton invalide.' }, { status: 401 })
      }

      const user = await db.user.findUnique({ where: { email } })
      if (!user) return Response.json({ error: 'Compte introuvable.' }, { status: 404 })

      const { hash, salt } = hashPassword(password)
      await db.user.update({ where: { id: String(user.id) }, data: { passwordHash: hash, salt } })
      // Le jeton est consommé + toutes les sessions existantes sont révoquées.
      await db.verificationCode.update({ where: { id: String(row.id) }, data: { consumed: true } }).catch(() => {})
      const sessions = await db.session.findMany({ where: { userId: String(user.id) } })
      for (const s of sessions) {
        await db.session.delete({ where: { id: String((s as { id: string }).id) } }).catch(() => {})
      }
      return Response.json({ ok: true })
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : 'Réinitialisation impossible' },
        { status: 500 }
      )
    }
  }

  return Response.json({ error: 'Étape inconnue.' }, { status: 400 })
}
