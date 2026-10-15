// ─── NEXUS — Filtres de conversations (espace Dev) ───────────────────────────
// Règles que le compte Dev crée pour trier les conversations de TOUS les comptes :
//   • kind « all »     : toutes les conversations du compte ciblé
//   • kind « keyword » : conversations dont le titre ou un message contient le motif
//   • kind « conversation » : UNE conversation précise (motif = identifiant)
//   • scopeUserId      : « » = tous les comptes, sinon un compte précis
//   • action « exclude » : la conversation est retirée du corpus d'entraînement du LLM
//   • action « hide »    : la conversation est masquée dans la liste du dashboard Dev
// La suppression est une action explicite (bouton) et n'est pas une règle.

import { db } from '@/lib/db'

export type FilterKind = 'all' | 'keyword' | 'conversation'
export type FilterAction = 'exclude' | 'hide'

export interface ConversationFilterRule {
  id: string
  scopeUserId: string
  kind: FilterKind
  pattern: string
  action: FilterAction
  enabled: boolean
  hits: number
  createdAt: Date | null
}

export interface ConvLike {
  id: string
  userId: string | null
  title: string
  data: string
}

export interface ConvVerdict {
  excluded: boolean
  hidden: boolean
  /** Identifiants des règles qui ont matché. */
  matched: string[]
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function parseMessages(raw: string): { role: string; content: string }[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.content === 'string') : []
  } catch {
    return []
  }
}

/** Une règle s'applique-t-elle à cette conversation ? */
export function ruleMatches(rule: ConversationFilterRule, conv: ConvLike, messages: { content: string }[]): boolean {
  if (!rule.enabled) return false
  if (rule.scopeUserId && rule.scopeUserId !== (conv.userId ?? '')) return false
  if (rule.kind === 'all') return true
  if (rule.kind === 'conversation') return rule.pattern.trim() === conv.id
  const needle = norm(rule.pattern.trim())
  if (!needle) return false
  if (norm(conv.title).includes(needle)) return true
  return messages.some((m) => norm(m.content).includes(needle))
}

/** Charge les règles actives (une seule requête par appel de haut niveau). */
export async function loadFilterRules(): Promise<ConversationFilterRule[]> {
  const rows = await db.conversationFilter.findMany({ orderBy: { createdAt: 'asc' } })
  return (rows ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    scopeUserId: String(r.scopeUserId ?? ''),
    kind: (r.kind === 'all' ? 'all' : r.kind === 'conversation' ? 'conversation' : 'keyword') as FilterKind,
    pattern: String(r.pattern ?? ''),
    action: (r.action === 'hide' ? 'hide' : 'exclude') as FilterAction,
    enabled: Boolean(r.enabled),
    hits: Number(r.hits ?? 0),
    createdAt: (r.createdAt as Date) ?? null,
  }))
}

/** Verdict pour une conversation donnée. */
export function evaluateConversation(conv: ConvLike, rules: ConversationFilterRule[]): ConvVerdict {
  const messages = parseMessages(conv.data)
  const verdict: ConvVerdict = { excluded: false, hidden: false, matched: [] }
  for (const rule of rules) {
    if (!ruleMatches(rule, conv, messages)) continue
    verdict.matched.push(rule.id)
    if (rule.action === 'exclude') verdict.excluded = true
    if (rule.action === 'hide') verdict.hidden = true
  }
  return verdict
}

/** Libellé lisible d'une règle (affichage dashboard). */
export function describeRule(rule: ConversationFilterRule, accountLabel: (id: string) => string): string {
  const scope = rule.scopeUserId ? `compte ${accountLabel(rule.scopeUserId)}` : 'tous les comptes'
  const what =
    rule.kind === 'all'
      ? 'toutes les conversations'
      : rule.kind === 'conversation'
        ? 'cette conversation'
        : `conversations contenant « ${rule.pattern} »`
  const act = rule.action === 'exclude' ? 'exclues de l’entraînement' : 'masquées dans le dashboard'
  return `${what} — ${scope} → ${act}`
}
