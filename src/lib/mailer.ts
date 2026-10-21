// ─── NEXUS — Envoi d'e-mails (SMTP) ───────────────────────────────────────────
// Sert à la réinitialisation de mot de passe (code à 6 chiffres), aux notifications
// des surveillances de sites et à l'envoi de rapports de blueprints. La double
// authentification à la connexion a été retirée.
//
// Configuration via variables d'environnement :
//   SMTP_HOST   ex. smtp.gmail.com
//   SMTP_PORT   ex. 465 (TLS implicite) ou 587
//   SMTP_USER   compte d'envoi (ex. un mot de passe d'application Gmail)
//   SMTP_PASS   mot de passe / mot de passe d'application
//   MAIL_FROM   ex. "NEXUS <nexus@mondomaine.fr>"
//
// Si SMTP n'est pas configuré, le code de vérification est journalisé côté
// serveur ; il n'est renvoyé à l'écran (champ `devCode`) qu'EN DÉVELOPPEMENT.
// En production, l'afficher permettrait à n'importe qui de réinitialiser
// n'importe quel compte (dont « dev ») : il reste lisible dans les journaux
// (Render → Logs), réservés à l'administrateur.
//
// Plan gratuit de Render : les ports 25, 465 et 587 sont bloqués en sortie —
// utilisez le port 2525 d'un fournisseur qui le propose (Brevo, SendGrid, Mailgun…).

import nodemailer from 'nodemailer'

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim())
}

let cachedTransport: nodemailer.Transporter | null = null

function transport(): nodemailer.Transporter {
  if (cachedTransport) return cachedTransport
  const port = Number(process.env.SMTP_PORT?.trim() || '465')
  cachedTransport = nodemailer.createTransport({
    host: String(process.env.SMTP_HOST).trim(),
    port,
    secure: port === 465,
    auth: { user: String(process.env.SMTP_USER).trim(), pass: String(process.env.SMTP_PASS).trim() },
    // Un port bloqué ne répond jamais : échouer vite plutôt qu'au bout de 2 minutes.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return cachedTransport
}

/** Message d'erreur SMTP, avec la cause la plus probable sur Render (ports bloqués). */
function smtpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : 'envoi impossible'
  const port = Number(process.env.SMTP_PORT?.trim() || '465')
  if ([25, 465, 587].includes(port) && /timeout|ETIMEDOUT|ECONNREFUSED|ESOCKET|EHOSTUNREACH|ENETUNREACH/i.test(msg)) {
    return `${msg} — le plan gratuit de Render bloque les ports 25, 465 et 587 : utilisez le port 2525 de votre fournisseur (Brevo, SendGrid, Mailgun…)`
  }
  return msg
}

export function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || `NEXUS <${String(process.env.SMTP_USER).trim()}>`
}

function codeEmail(code: string): string {
  const action = 'réinitialiser votre mot de passe'
  return `<!doctype html>
<html lang="fr"><body style="margin:0;padding:32px;background:#0a0a0a;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;">
    <div style="padding:28px 32px;border-bottom:1px solid #2a2a2a;">
      <span style="font-size:22px;font-weight:800;letter-spacing:6px;color:#ffffff;">NEXUS</span>
      <span style="float:right;font-size:10px;letter-spacing:3px;color:#8a8a8a;padding-top:10px;">FOR YOUR DIGITAL WORLD</span>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 12px;color:#ffffff;font-size:16px;font-weight:600;">Code de vérification</p>
      <p style="margin:0 0 24px;color:#a3a3a3;font-size:14px;line-height:1.6;">
        Utilisez ce code à 6 chiffres pour ${action}. Il expire dans <strong style="color:#ffffff;">10 minutes</strong>.
      </p>
      <div style="text-align:center;background:#0a0a0a;border:1px solid #2a2a2a;border-radius:12px;padding:20px;">
        <span style="font-size:34px;font-weight:800;letter-spacing:12px;color:#ffffff;">${code}</span>
      </div>
      <p style="margin:24px 0 0;color:#6b6b6b;font-size:12px;line-height:1.6;">
        Vous n'êtes pas à l'origine de cette demande ? Ignorez ce message — aucun changement ne sera fait.
      </p>
    </div>
  </div>
</body></html>`
}

/** Tente l'envoi du code de réinitialisation. Renvoie sent=false (avec le code) si SMTP absent. */
export async function sendVerificationEmail(
  email: string,
  code: string
): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) {
    // Mode développement : le code reste côté serveur (journal) et est renvoyé
    // à l'UI qui l'affiche dans un encart explicite.
    console.log(`[nexus][mail] code de réinitialisation pour ${email} : ${code}`)
    return { sent: false }
  }
  try {
    await transport().sendMail({
      from: mailFrom(),
      to: email,
      subject: `Code de réinitialisation NEXUS : ${code}`,
      html: codeEmail(code),
      text: `Votre code NEXUS (réinitialisation) : ${code} — valable 10 minutes.`,
    })
    return { sent: true }
  } catch (err) {
    const error = smtpError(err)
    console.error('[nexus][mail] envoi SMTP impossible :', error)
    return { sent: false, error }
  }
}

/** Envoi d'un e-mail texte simple (notifications de surveillance). Ne jette jamais. */
export async function sendPlainMail(
  to: string,
  subject: string,
  text: string
): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) return { sent: false, error: 'SMTP non configuré (SMTP_HOST / SMTP_USER / SMTP_PASS)' }
  try {
    await transport().sendMail({ from: mailFrom(), to, subject, text })
    return { sent: true }
  } catch (err) {
    return { sent: false, error: smtpError(err) }
  }
}
