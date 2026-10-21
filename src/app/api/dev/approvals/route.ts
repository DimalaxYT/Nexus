// ─── Espace Dev — Confirmations en attente ────────────────────────────────────
// GET  → pending + historique récent.
// POST → { id, decision: 'accept' | 'refuse' } : applique la décision.
// Les liens du webhook passent par /api/dev/approvals/action (token signé).

import { devGuard } from '@/lib/auth'
import { decideApproval } from '@/lib/devapproval'
import { listApprovals } from '@/lib/devwebhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    const [pending, history] = await Promise.all([
      listApprovals(guard.userId, 'pending', 30),
      listApprovals(guard.userId, 'all', 40),
    ])
    return Response.json({ approvals: pending, history })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lecture impossible' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const decision = String(body?.decision ?? '')
  if (!id || (decision !== 'accept' && decision !== 'refuse')) {
    return Response.json({ error: 'Identifiant et décision (accept/refuse) requis.' }, { status: 400 })
  }
  const result = await decideApproval(id, decision, 'dashboard')
  if (!result.ok) return Response.json({ error: result.error ?? 'Décision impossible.' }, { status: 400 })
  return Response.json({ ok: true, message: result.message, approval: result.approval })
}
