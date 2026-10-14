// ─── NEXUS — Envoi d'e-mails (SMTP) ───────────────────────────────────────────
// Sert à la double authentification (code à 6 chiffres à la connexion) et à la
// réinitialisation de mot de passe.
//
// Configuration via variables d'environnement :
//   SMTP_HOST   ex. smtp.gmail.com
//   SMTP_PORT   ex. 465 (TLS implicite) ou 587
//   SMTP_USER   compte d'envoi (ex. un mot de passe d'application Gmail)
//   SMTP_PASS   mot de passe / mot de passe d'application
//   MAIL_FROM   ex. "NEXUS <nexus@mondomaine.fr>"
//
// Si SMTP n'est pas configuré, le code de vérification est renvoyé dans la
// réponse API (champ `devCode`) et journalisé côté serveur : l'application
// reste utilisable en développement / preview, sans exposure en production
// configurée.

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
  })
  return cachedTransport
}

export function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || `NEXUS <${String(process.env.SMTP_USER).trim()}>`
}

function codeEmail(code: string, purpose: 'login' | 'reset'): string {
  const action =
    purpose === 'login'
      ? 'confirmer votre connexion'
      : 'réinitialiser votre mot de passe'
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

/** Tente l'envoi du code. Renvoie sent=false (avec le code) si SMTP absent. */
export async function sendVerificationEmail(
  email: string,
  code: string,
  purpose: 'login' | 'reset'
): Promise<{ sent: boolean; error?: string }> {
  if (!mailConfigured()) {
    // Mode développement : le code reste côté serveur (journal) et est renvoyé
    // à l'UI qui l'affiche dans un encart explicite.
    console.log(`[nexus][2fa] code pour ${email} (${purpose}) : ${code}`)
    return { sent: false }
  }
  try {
    await transport().sendMail({
      from: mailFrom(),
      to: email,
      subject: purpose === 'login' ? `Code de connexion NEXUS : ${code}` : `Code de réinitialisation NEXUS : ${code}`,
      html: codeEmail(code, purpose),
      text: `Votre code NEXUS (${purpose === 'login' ? 'connexion' : 'réinitialisation'}) : ${code} — valable 10 minutes.`,
    })
    return { sent: true }
  } catch (err) {
    console.error('[nexus][2fa] envoi SMTP impossible :', err instanceof Error ? err.message : err)
    return { sent: false, error: err instanceof Error ? err.message : 'envoi impossible' }
  }
}
