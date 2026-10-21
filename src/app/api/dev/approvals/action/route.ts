// ─── Confirmation par lien (webhook) ────────────────────────────────────────
// GET /api/dev/approvals/action?token=…&decision=accept|refuse
// Le jeton est aléatoire (24 octets), à usage unique, lié à une confirmation
// « pending ». Aucune session n'est requise : c'est le jeton qui autorise.
// Réponse : petite page HTML (lisible sur téléphone), pas de JSON brut.

import { decideApproval } from '@/lib/devapproval'
import { getApprovalByToken, resolveBaseUrl } from '@/lib/devwebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function page(opts: { title: string; heading: string; message: string; tone: 'ok' | 'bad' | 'warn'; detail?: string; back: string }): Response {
  const color = opts.tone === 'ok' ? '#16a34a' : opts.tone === 'bad' ? '#dc2626' : '#d97706'
  const icon = opts.tone === 'ok' ? '✅' : opts.tone === 'bad' ? '⛔' : '⏳'
  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${esc(opts.title)} — NEXUS</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #f5f5f5; color: #171717; }
  .card { width: 100%; max-width: 520px; background: #fff; border: 1px solid rgba(0,0,0,.12);
    border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px -30px rgba(0,0,0,.35); }
  .badge { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700;
    letter-spacing: .08em; text-transform: uppercase; color: ${color}; }
  h1 { margin: 14px 0 8px; font-size: 22px; line-height: 1.25; letter-spacing: -.01em; }
  p { margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #404040; }
  .detail { margin: 16px 0; padding: 12px; border-radius: 10px; background: #fafafa;
    border: 1px solid rgba(0,0,0,.08); font-size: 12px; color: #525252; word-break: break-word; }
  a.button { display: inline-block; margin-top: 10px; padding: 10px 16px; border-radius: 10px;
    background: #171717; color: #fff; text-decoration: none; font-size: 13px; font-weight: 600; }
  .foot { margin-top: 18px; font-size: 11px; color: #737373; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d0d0d; color: #fafafa; }
    .card { background: #1a1a1a; border-color: rgba(255,255,255,.12); box-shadow: 0 20px 60px -30px rgba(0,0,0,.9); }
    p { color: #d4d4d4; }
    .detail { background: #111; border-color: rgba(255,255,255,.1); color: #a3a3a3; }
    a.button { background: #fafafa; color: #0d0d0d; }
    .foot { color: #8f8f8f; }
  }
</style>
</head>
<body>
  <main class="card">
    <span class="badge">${icon} ${esc(opts.heading)}</span>
    <h1>${esc(opts.title)}</h1>
    <p>${esc(opts.message)}</p>
    ${opts.detail ? `<div class="detail">${esc(opts.detail)}</div>` : ''}
    <a class="button" href="${esc(opts.back)}">Ouvrir NEXUS</a>
    <p class="foot">NEXUS · action enregistrée automatiquement. Cette page peut être fermée.</p>
  </main>
</body>
</html>`
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token') ?? ''
  const decision = url.searchParams.get('decision') ?? ''
  const back = `${resolveBaseUrl()}/app`

  if (decision !== 'accept' && decision !== 'refuse') {
    return page({
      title: 'Lien incomplet',
      heading: 'Action inconnue',
      message: 'Ce lien ne précise pas la décision attendue (accept ou refuse). Utilise les boutons du message de confirmation.',
      tone: 'warn',
      back,
    })
  }

  const approval = await getApprovalByToken(token)
  if (!approval) {
    return page({
      title: 'Lien invalide',
      heading: 'Confirmation introuvable',
      message: 'Ce lien est incorrect ou a expiré. Ouvre l’espace Dev pour retrouver la confirmation en attente.',
      tone: 'bad',
      back,
    })
  }
  if (approval.status !== 'pending') {
    return page({
      title: 'Déjà traitée',
      heading: 'Aucune action nécessaire',
      message: `Cette confirmation a déjà été ${approval.status === 'accepted' ? 'acceptée' : 'refusée'}. Rien n’a été modifié à nouveau.`,
      tone: 'warn',
      detail: approval.title,
      back,
    })
  }

  const result = await decideApproval(token, decision, 'webhook', { byToken: true })
  return page({
    title: decision === 'accept' ? 'Confirmation acceptée' : 'Confirmation refusée',
    heading: decision === 'accept' ? 'Accepté' : 'Refusé',
    message: result.ok ? result.message : (result.error ?? 'La décision n’a pas pu être appliquée.'),
    tone: result.ok ? (decision === 'accept' ? 'ok' : 'warn') : 'bad',
    detail: approval.title,
    back,
  })
}
