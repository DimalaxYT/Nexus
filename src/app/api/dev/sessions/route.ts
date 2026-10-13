// ─── Dashboard Dev — sessions actives ────────────────────────────────────────
// GET    → liste des sessions (avec le compte associé)
// DELETE → ?id= révoque une session (ou ?all=1 pour tout sauf la courante)

import { devGuard } from '@/lib/auth'
import { SESSION_COOKIE } from '@/lib/auth'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  const jar = await cookies()
  const current = jar.get(SESSION_COOKIE)?.value ?? ''
  const [sessions, users] = await Promise.all([
    db.session.findMany({ orderBy: { lastSeenAt: 'desc' }, take: 60 }),
    db.user.findMany({ take: 200 }),
  ])
  const names = new Map<string, string>()
  for (const u of users ?? []) {
    names.set(String(u.id), `${String(u.name ?? '')} · ${String(u.email ?? '')}`)
  }

  return Response.json({
    current,
    sessions: (sessions ?? []).map((s) => ({
      id: String(s.id),
      userId: String(s.userId),
      user: names.get(String(s.userId)) ?? String(s.userId),
      userAgent: String(s.userAgent ?? '').slice(0, 160),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
    })),
  })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const all = url.searchParams.get('all') === '1'
  const jar = await cookies()
  const current = jar.get(SESSION_COOKIE)?.value ?? ''

  if (id) {
    if (id === current) return Response.json({ error: 'Impossible de révoquer la session courante.' }, { status: 400 })
    await db.session.delete({ where: { id } }).catch(() => {})
    return Response.json({ ok: true })
  }

  if (all) {
    const sessions = await db.session.findMany({ take: 500 })
    let revoked = 0
    for (const s of sessions ?? []) {
      if (String(s.id) === current) continue
      await db.session.delete({ where: { id: String(s.id) } }).catch(() => {})
      revoked++
    }
    return Response.json({ ok: true, revoked })
  }

  return Response.json({ error: 'Paramètre `id` ou `all` requis.' }, { status: 400 })
}
