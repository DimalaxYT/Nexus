// Filtres de conversations (espace Dev), par compte.
// GET  → règles, comptes, dernières conversations avec leur verdict
// POST → { action: 'add' | 'toggle' | 'remove' | 'preview' | 'delete-conversation', … }
//   add    : { scopeUserId?, kind: 'all'|'keyword'|'conversation', pattern?, conversationId?, effect: 'exclude'|'hide' }
//   toggle : { id, enabled }      remove : { id }
//   preview: { scopeUserId?, kind, pattern? } → nombre de conversations concernées
//   delete-conversation : { id } → suppression DÉFINITIVE d'une conversation

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { describeRule, evaluateConversation, loadFilterRules, parseMessages, ruleMatches, type ConversationFilterRule } from '@/lib/conversation-filters'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT = 150

function accountLabel(users: Map<string, string>) {
  return (id: string) => users.get(id) ?? (id ? `${id.slice(0, 8)}…` : 'tous')
}

async function loadAccounts(): Promise<{ id: string; label: string }[]> {
  const rows = (await db.user.findMany({ select: { id: true, email: true, name: true } })) as { id: string; email: string; name?: string }[]
  return rows.map((u) => ({ id: String(u.id), label: String(u.name || u.email || u.id) }))
}

async function snapshot() {
  const [rules, accounts, convs] = await Promise.all([
    loadFilterRules(),
    loadAccounts(),
    db.conversation.findMany({ orderBy: { updatedAt: 'desc' }, take: LIST_LIMIT }),
  ])
  const users = new Map(accounts.map((a) => [a.id, a.label]))
  const label = accountLabel(users)
  const list = (convs as Record<string, unknown>[]).map((c) => {
    const conv = { id: String(c.id), userId: c.userId ? String(c.userId) : null, title: String(c.title ?? ''), data: String(c.data ?? '[]') }
    const verdict = evaluateConversation(conv, rules)
    const messages = parseMessages(conv.data)
    return {
      id: conv.id,
      title: conv.title,
      account: conv.userId ? label(conv.userId) : 'sans compte',
      userId: conv.userId,
      messages: messages.length,
      updatedAt: c.updatedAt ? new Date(c.updatedAt as Date).toISOString() : null,
      excluded: verdict.excluded,
      hidden: verdict.hidden,
      matched: verdict.matched,
    }
  })
  return {
    accounts,
    rules: rules.map((r) => ({ ...r, createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null, description: describeRule(r, label) })),
    conversations: list,
    totals: {
      all: await db.conversation.count(),
      excluded: list.filter((c) => c.excluded).length,
      hidden: list.filter((c) => c.hidden).length,
    },
  }
}

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    return Response.json(await snapshot())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lecture impossible' }, { status: 500 })
  }
}

function parseRule(body: Record<string, unknown>, accountIds: Set<string>): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const kind = String(body.kind ?? '')
  if (kind !== 'all' && kind !== 'keyword' && kind !== 'conversation') return { ok: false, error: 'Type de filtre inconnu.' }
  const effect = String(body.effect ?? '')
  if (effect !== 'exclude' && effect !== 'hide') return { ok: false, error: 'Effet inconnu (exclure ou masquer).' }
  const scopeUserId = String(body.scopeUserId ?? '')
  if (scopeUserId && !accountIds.has(scopeUserId)) return { ok: false, error: 'Compte introuvable.' }
  let pattern = ''
  if (kind === 'keyword') {
    pattern = String(body.pattern ?? '').trim().slice(0, 120)
    if (pattern.length < 2) return { ok: false, error: 'Mot-clé requis (au moins 2 caractères).' }
  }
  if (kind === 'conversation') {
    pattern = String(body.conversationId ?? body.pattern ?? '').trim()
    if (!pattern) return { ok: false, error: 'Conversation requise.' }
  }
  return { ok: true, value: { scopeUserId, kind, pattern, action: effect, enabled: true } }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const action = String(body.action ?? '')
  try {
    const accounts = await loadAccounts()
    const accountIds = new Set(accounts.map((a) => a.id))

    if (action === 'add' || action === 'preview') {
      const parsed = parseRule(body, accountIds)
      if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
      if (action === 'preview') {
        const rule = { id: 'preview', ...parsed.value, hits: 0, createdAt: null } as unknown as ConversationFilterRule
        const rows = (await db.conversation.findMany({ orderBy: { updatedAt: 'desc' }, take: 1000 })) as Record<string, unknown>[]
        let count = 0
        for (const c of rows) {
          const conv = { id: String(c.id), userId: c.userId ? String(c.userId) : null, title: String(c.title ?? ''), data: String(c.data ?? '[]') }
          if (ruleMatches(rule, conv, parseMessages(conv.data))) count++
        }
        return Response.json({ ok: true, count, scanned: rows.length })
      }
      await db.conversationFilter.create({ data: { ...parsed.value, userId: guard.userId, hits: 0 } })
      return Response.json({ ok: true, ...(await snapshot()) })
    }

    if (action === 'toggle') {
      const id = String(body.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      await db.conversationFilter.update({ where: { id }, data: { enabled: Boolean(body.enabled) } })
      return Response.json({ ok: true, ...(await snapshot()) })
    }

    if (action === 'remove') {
      const id = String(body.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      await db.conversationFilter.delete({ where: { id } })
      return Response.json({ ok: true, ...(await snapshot()) })
    }

    if (action === 'delete-conversation') {
      const id = String(body.id ?? '')
      if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
      await db.conversation.delete({ where: { id } })
      return Response.json({ ok: true, ...(await snapshot()) })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Opération impossible' }, { status: 500 })
  }
}
