// ─── NEXUS — Codes de vérification (mot de passe oublié) ─────────────────────
// Un code à 6 chiffres, haché (SHA-256), valable 10 minutes, 5 essais max.
// Usage unique : « reset » (réinitialisation de mot de passe). La double
// authentification à la connexion a été retirée.

import crypto from 'crypto'
import { db } from '@/lib/db'
import { checkRateLimit } from '@/lib/security'
import { sendVerificationEmail } from '@/lib/mailer'

const TTL_MS = 10 * 60 * 1000
const MAX_ATTEMPTS = 5

function hashCode(email: string, code: string): string {
  return crypto.createHash('sha256').update(`${email.toLowerCase()}::${code}`).digest('hex')
}

/** Génère, stocke et envoie un code. Sans SMTP : devCode en développement, journal seulement en production. */
export async function issueVerificationCode(
  email: string,
  purpose: 'reset'
): Promise<{ ok: boolean; sent?: boolean; devCode?: string; logged?: boolean; error?: string }> {
  // Anti-abus : 3 codes maximum par 10 minutes par e-mail + usage.
  const rl = checkRateLimit(`vcode:${purpose}:${email.toLowerCase()}`, 3, 10 * 60 * 1000)
  if (!rl.allowed) {
    return { ok: false, error: `Trop de codes demandés. Réessayez dans ${rl.retryAfterSec} s.` }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

  // Un seul code actif par e-mail + usage : on consomme les anciens.
  const old = await db.verificationCode.findMany({ where: { email: email.toLowerCase(), purpose } })
  for (const row of old) {
    await db.verificationCode.update({ where: { id: String(row.id) }, data: { consumed: true } }).catch(() => {})
  }

  await db.verificationCode.create({
    data: {
      email: email.toLowerCase(),
      codeHash: hashCode(email, code),
      purpose,
      attempts: 0,
      consumed: false,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  })

  const res = await sendVerificationEmail(email, code)
  if (res.error) {
    return { ok: false, error: `Envoi de l'e-mail impossible (${res.error}). Vérifiez la configuration SMTP.` }
  }
  // Sans SMTP, le code n'est montré à l'écran qu'en développement : en production,
  // n'importe qui pourrait sinon réinitialiser n'importe quel compte (dont « dev »).
  // Il reste lisible dans les journaux du serveur (Render → Logs).
  const showCode = !res.sent && process.env.NODE_ENV !== 'production'
  return { ok: true, sent: res.sent, devCode: showCode ? code : undefined, logged: !res.sent && !showCode }
}

/** Vérifie un code. Le consomme en cas de succès (single-use). */
export async function verifyVerificationCode(
  email: string,
  purpose: 'reset',
  code: string
): Promise<{ ok: boolean; error?: string }> {
  const clean = code.replace(/\D/g, '')
  if (clean.length !== 6) return { ok: false, error: 'Le code doit contenir 6 chiffres.' }

  const rows = await db.verificationCode.findMany({
    where: { email: email.toLowerCase(), purpose, consumed: false },
    orderBy: { createdAt: 'desc' },
    take: 1,
  })
  const row = rows[0] as { id: string; codeHash: string; expiresAt: Date; attempts: number } | undefined
  if (!row) return { ok: false, error: 'Aucun code actif : demandez-en un nouveau.' }

  if (new Date(row.expiresAt as unknown as Date).getTime() < Date.now()) {
    await db.verificationCode.update({ where: { id: String(row.id) }, data: { consumed: true } }).catch(() => {})
    return { ok: false, error: 'Code expiré : demandez-en un nouveau.' }
  }
  if (Number(row.attempts ?? 0) >= MAX_ATTEMPTS) {
    await db.verificationCode.update({ where: { id: String(row.id) }, data: { consumed: true } }).catch(() => {})
    return { ok: false, error: 'Trop d’essais : demandez un nouveau code.' }
  }

  const given = hashCode(email, clean)
  const ok = crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(row.codeHash)))
  if (!ok) {
    await db.verificationCode
      .update({ where: { id: String(row.id) }, data: { attempts: Number(row.attempts ?? 0) + 1 } })
      .catch(() => {})
    return { ok: false, error: 'Code incorrect.' }
  }

  await db.verificationCode.update({ where: { id: String(row.id) }, data: { consumed: true } }).catch(() => {})
  return { ok: true }
}
