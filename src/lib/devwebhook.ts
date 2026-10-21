// ─── NEXUS — Webhooks de l'espace Dev ────────────────────────────────────────
// NEXUS prévient l'opérateur là où il vit (Discord, Slack ou n'importe quelle
// URL) de ce qu'il fait : cycle d'entraînement démarré / terminé, savoir
// compris, correctif proposé, et surtout ACTION À CONFIRMER — avec deux liens
// signés « Accepter » / « Refuser » qui exécutent la décision sans ouvrir le
// dashboard.
//
// Aucun service externe n'est requis par NEXUS : ce module ne fait qu'émettre
// des requêtes HTTP vers l'URL que le compte Dev a explicitement configurée.
// Les livraisons sont journalisées (statut, latence, erreur) pour être
// diagnostiquées depuis l'interface.

import crypto from 'crypto'
import { db } from './db'
import { decryptSecret, encryptSecret, isSafeUrlSync } from './security'

export type DevEvent =
  | 'training.started'
  | 'training.completed'
  | 'training.learned'
  | 'approval.requested'
  | 'approval.decided'
  | 'patch.applied'
  | 'daemon.error'
  | 'test'

export interface DevEventMeta {
  id: DevEvent
  label: string
  description: string
  group: 'Entraînement' | 'Confirmations' | 'Correctifs' | 'Système'
}

export const DEV_EVENTS: DevEventMeta[] = [
  { id: 'training.started', label: 'Entraînement démarré', description: 'Un cycle vient de commencer (objectif, déclencheur).', group: 'Entraînement' },
  { id: 'training.completed', label: 'Cycle terminé', description: 'Bilan du cycle : pages lues, savoirs produits, couverture avant/après.', group: 'Entraînement' },
  { id: 'training.learned', label: 'Ce que l’IA a compris', description: 'Question, réponse retenue, score, sources — le savoir réellement appris.', group: 'Entraînement' },
  { id: 'approval.requested', label: 'Attente de confirmation', description: 'Un correctif ou un savoir attend une décision (boutons Accepter / Refuser).', group: 'Confirmations' },
  { id: 'approval.decided', label: 'Décision enregistrée', description: 'Une confirmation a été acceptée ou refusée (depuis le webhook ou le dashboard).', group: 'Confirmations' },
  { id: 'patch.applied', label: 'Correctif appliqué', description: 'Un fichier a été modifié (avec sauvegarde préalable).', group: 'Correctifs' },
  { id: 'daemon.error', label: 'Incident', description: 'Un cycle ou le daemon a échoué.', group: 'Système' },
  { id: 'test', label: 'Test du webhook', description: 'Message de vérification envoyé depuis l’espace Dev.', group: 'Système' },
]

export const DEFAULT_EVENTS: DevEvent[] = [
  'training.started',
  'training.completed',
  'training.learned',
  'approval.requested',
  'approval.decided',
  'patch.applied',
  'daemon.error',
]

const EVENT_LABEL = Object.fromEntries(DEV_EVENTS.map((e) => [e.id, e.label])) as Record<DevEvent, string>
const MAX_LOGS_PER_USER = 200
const TIMEOUT_MS = 10_000

// ── Types publics ───────────────────────────────────────────────────────────

export interface PublicWebhook {
  id: string
  name: string
  url: string
  format: 'auto' | 'discord' | 'slack' | 'generic'
  events: string[]
  enabled: boolean
  baseUrl: string
  secretSet: boolean
  lastStatus: string
  lastError: string
  lastDeliveryAt: string | null
  createdAt: string | null
}

export interface ApprovalView {
  id: string
  kind: string
  refId: string
  title: string
  summary: string
  status: string
  token: string
  decidedBy: string
  decidedAt: string | null
  createdAt: string | null
  acceptUrl: string
  refuseUrl: string
}

interface WebhookRow {
  id?: unknown
  userId?: unknown
  name?: unknown
  url?: unknown
  format?: unknown
  events?: unknown
  secret?: unknown
  baseUrl?: unknown
  enabled?: unknown
  lastStatus?: unknown
  lastError?: unknown
  lastDeliveryAt?: unknown
  createdAt?: unknown
}

interface ApprovalRow {
  id?: unknown
  userId?: unknown
  kind?: unknown
  refId?: unknown
  title?: unknown
  summary?: unknown
  payload?: unknown
  status?: unknown
  token?: unknown
  decidedBy?: unknown
  decidedAt?: unknown
  createdAt?: unknown
}

export interface EventInput {
  /** Titre court (par défaut le libellé de l'événement). */
  title?: string
  summary: string
  fields?: { name: string; value: string; inline?: boolean }[]
  /** Liens d'action (acceptation / refus) affichés en boutons. */
  links?: { accept?: string; refuse?: string; dashboard?: string }
  /** Données machine ajoutées au payload générique. */
  data?: Record<string, unknown>
}

// ── Utilitaires ─────────────────────────────────────────────────────────────

function str(v: unknown, max = 4000): string {
  return String(v ?? '').slice(0, max)
}

function iso(v: unknown): string | null {
  if (!v) return null
  const t = new Date(v as string | number | Date).getTime()
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function parseList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((x) => String(x))
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
  } catch {
    return []
  }
}

function parseObject(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function publicWebhook(row: WebhookRow): PublicWebhook {
  return {
    id: str(row.id),
    name: str(row.name, 120) || 'Webhook',
    url: str(row.url, 2000),
    format: (['auto', 'discord', 'slack', 'generic'] as const).includes(str(row.format) as 'auto')
      ? (str(row.format) as PublicWebhook['format'])
      : 'auto',
    events: parseList(row.events),
    enabled: Boolean(row.enabled),
    baseUrl: str(row.baseUrl, 500),
    secretSet: Boolean(str(row.secret)),
    lastStatus: str(row.lastStatus, 60),
    lastError: str(row.lastError, 500),
    lastDeliveryAt: iso(row.lastDeliveryAt),
    createdAt: iso(row.createdAt),
  }
}

export function approvalView(row: ApprovalRow): ApprovalView {
  const token = str(row.token, 200)
  const base = resolveBaseUrl()
  return {
    id: str(row.id),
    kind: str(row.kind, 40),
    refId: str(row.refId, 200),
    title: str(row.title, 300),
    summary: str(row.summary, 4000),
    status: str(row.status, 30),
    token,
    decidedBy: str(row.decidedBy, 120),
    decidedAt: iso(row.decidedAt),
    createdAt: iso(row.createdAt),
    acceptUrl: token ? `${base}/api/dev/approvals/action?token=${encodeURIComponent(token)}&decision=accept` : '',
    refuseUrl: token ? `${base}/api/dev/approvals/action?token=${encodeURIComponent(token)}&decision=refuse` : '',
  }
}

/** URL publique de l'application, utilisée pour les liens Accepter / Refuser. */
export function resolveBaseUrl(explicit?: string): string {
  const candidates = [
    explicit,
    process.env.NEXUS_PUBLIC_URL,
    process.env.RENDER_EXTERNAL_URL,
    process.env.KEEP_ALIVE_URL,
  ]
  for (const raw of candidates) {
    const value = String(raw ?? '').trim()
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.protocol}//${url.host}`
    } catch {
      /* valeur invalide : on essaie la suivante */
    }
  }
  return 'http://localhost:3000'
}

/**
 * Validation d'une URL de webhook. Le compte Dev est de confiance, mais on
 * refuse les schémas exotiques, les identifiants embarqués et — en production —
 * les adresses internes (anti-SSRF), sauf autorisation explicite.
 */
export function validateWebhookUrl(raw: string): { ok: boolean; url?: string; reason?: string } {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, reason: 'URL requise.' }
  if (value.length > 2000) return { ok: false, reason: 'URL trop longue.' }

  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { ok: false, reason: 'URL syntaxiquement invalide.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Seuls http(s) sont acceptés.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Identifiants intégrés interdits dans l’URL.' }
  }

  // En développement (et sur autorisation explicite), un webhook local est
  // légitime — c'est même le moyen de tester sans dépendre d'un service tiers.
  // En production, la garde anti-SSRF s'applique par défaut.
  const allowPrivate = process.env.NEXUS_WEBHOOK_ALLOW_PRIVATE === '1' || process.env.NODE_ENV !== 'production'
  if (!allowPrivate) {
    const safe = isSafeUrlSync(value)
    if (!safe.ok) return { ok: false, reason: safe.reason ?? 'URL interne refusée (anti-SSRF).' }
  }
  return { ok: true, url: parsed.toString() }
}

function subscribed(events: string[], event: DevEvent): boolean {
  if (!events.length) return false
  return events.includes('*') || events.includes(event)
}

// ── Configuration ───────────────────────────────────────────────────────────

export async function listWebhooks(userId: string): Promise<PublicWebhook[]> {
  const rows = (await db.devWebhook.findMany({ where: { userId }, orderBy: { createdAt: 'asc' }, take: 20 }).catch(() => [])) as WebhookRow[]
  return (rows ?? []).map(publicWebhook)
}

export interface SaveWebhookInput {
  id?: string
  name?: string
  url: string
  format?: string
  events?: string[]
  secret?: string
  clearSecret?: boolean
  baseUrl?: string
  enabled?: boolean
}

export async function saveWebhook(userId: string, input: SaveWebhookInput): Promise<{ ok: boolean; error?: string; webhook?: PublicWebhook }> {
  const check = validateWebhookUrl(input.url)
  if (!check.ok || !check.url) return { ok: false, error: check.reason ?? 'URL invalide.' }

  const known = new Set<string>(DEV_EVENTS.map((e) => e.id))
  const requested = Array.isArray(input.events) ? input.events.map(String) : []
  const filtered = [...new Set(requested.filter((e) => e === '*' || known.has(e)))]
  const events = requested.length ? (filtered.length ? filtered : ['*']) : ['*']
  const format = ['auto', 'discord', 'slack', 'generic'].includes(String(input.format)) ? String(input.format) : 'auto'
  const baseUrl = String(input.baseUrl ?? '').trim().slice(0, 500)
  if (baseUrl) {
    try {
      const u = new URL(baseUrl)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'URL publique : http(s) attendu.' }
    } catch {
      return { ok: false, error: 'URL publique invalide.' }
    }
  }

  const data: Record<string, unknown> = {
    name: String(input.name ?? '').trim().slice(0, 120) || 'Webhook',
    url: check.url,
    format,
    events: JSON.stringify(events),
    baseUrl,
    enabled: input.enabled !== false,
  }
  if (input.clearSecret) data.secret = ''
  else if (typeof input.secret === 'string' && input.secret.trim()) data.secret = encryptSecret(input.secret.trim())

  let row: WebhookRow | null = null
  if (input.id) {
    const existing = (await db.devWebhook.findUnique({ where: { id: String(input.id) } }).catch(() => null)) as WebhookRow | null
    if (!existing || String(existing.userId ?? '') !== userId) return { ok: false, error: 'Webhook introuvable.' }
    row = (await db.devWebhook.update({ where: { id: String(input.id) }, data })) as WebhookRow
  } else {
    row = (await db.devWebhook.create({ data: { userId, lastStatus: '', lastError: '', lastDeliveryAt: null, ...data } })) as WebhookRow
  }
  return { ok: true, webhook: publicWebhook(row ?? {}) }
}

export async function deleteWebhook(userId: string, id: string): Promise<boolean> {
  const row = (await db.devWebhook.findUnique({ where: { id } }).catch(() => null)) as WebhookRow | null
  if (!row || String(row.userId ?? '') !== userId) return false
  await db.devWebhook.delete({ where: { id } }).catch(() => null)
  await db.devWebhookLog.deleteMany({ where: { webhookId: id } }).catch(() => ({}))
  return true
}

export async function toggleWebhook(userId: string, id: string, enabled: boolean): Promise<boolean> {
  const row = (await db.devWebhook.findUnique({ where: { id } }).catch(() => null)) as WebhookRow | null
  if (!row || String(row.userId ?? '') !== userId) return false
  await db.devWebhook.update({ where: { id }, data: { enabled } })
  return true
}

// ── Construction du message ─────────────────────────────────────────────────

interface DeliveryInput extends EventInput {
  event: DevEvent
}

interface BuiltBody {
  body: string
  headers: Record<string, string>
  preview: string
}

function detectFormat(hook: PublicWebhook, url: string): 'discord' | 'slack' | 'generic' {
  if (hook.format !== 'auto') return hook.format
  try {
    const host = new URL(url).hostname
    if (host === 'discord.com' || host === 'discordapp.com' || host.endsWith('.discord.com')) return 'discord'
    if (host === 'hooks.slack.com') return 'slack'
  } catch {
    /* URL déjà validée : improbable */
  }
  return 'generic'
}

function buildBody(hook: PublicWebhook, url: string, input: DeliveryInput): BuiltBody {
  const title = input.title || EVENT_LABEL[input.event] || input.event
  const summary = String(input.summary ?? '').slice(0, 3500)
  const fields = (input.fields ?? []).filter((f) => f && f.name).slice(0, 12)
  const links = input.links ?? {}
  const format = detectFormat(hook, url)
  const at = new Date().toISOString()
  const approval = input.data?.approvalId
    ? {
        id: String(input.data.approvalId),
        kind: String(input.data.approvalKind ?? ''),
        refId: String(input.data.refId ?? ''),
        acceptUrl: links.accept ?? '',
        refuseUrl: links.refuse ?? '',
      }
    : null

  if (format === 'discord') {
    const color = input.event === 'daemon.error'
      ? 0xef4444
      : input.event === 'approval.requested'
        ? 0xfbbf24
        : input.event === 'approval.decided'
          ? 0x22c55e
          : 0xffffff
    const components = links.accept && links.refuse
      ? [
          {
            type: 1,
            components: [
              { type: 2, style: 5, label: '✅ Accepter', url: links.accept },
              { type: 2, style: 5, label: '❌ Refuser', url: links.refuse },
            ],
          },
        ]
      : undefined
    const body = {
      username: 'NEXUS',
      content: `**${title}**`,
      embeds: [
        {
          title,
          description: summary,
          color,
          timestamp: at,
          fields: fields.map((f) => ({ name: String(f.name).slice(0, 256), value: String(f.value).slice(0, 1000), inline: Boolean(f.inline) })),
          footer: { text: 'NEXUS · espace Dev' },
          ...(links.dashboard ? { url: links.dashboard } : {}),
        },
      ],
      ...(components ? { components } : {}),
    }
    return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, preview: body.embeds[0].description }
  }

  if (format === 'slack') {
    const lines = [`*${title}*`, summary]
    for (const f of fields) lines.push(`• *${f.name}* : ${f.value}`)
    if (links.accept || links.refuse) {
      lines.push(
        [links.accept ? `<${links.accept}|✅ Accepter>` : '', links.refuse ? `<${links.refuse}|❌ Refuser>` : ''].filter(Boolean).join('   ·   ')
      )
    }
    if (links.dashboard) lines.push(`<${links.dashboard}|Ouvrir l’espace Dev>`)
    const body = { text: lines.join('\n'), mrkdwn: true }
    return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, preview: summary }
  }

  const generic = {
    source: 'nexus',
    event: input.event,
    label: EVENT_LABEL[input.event] ?? input.event,
    title,
    summary,
    at,
    fields,
    approval,
    links: { ...links },
    data: input.data ?? {},
  }
  const body = JSON.stringify(generic)
  return { body, headers: { 'content-type': 'application/json' }, preview: summary }
}

async function postBody(url: string, built: BuiltBody, secret: string, event: string): Promise<{ ok: boolean; status: number; ms: number; error: string }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers: Record<string, string> = {
    'user-agent': 'Nexus-Webhook/1.0',
    'x-nexus-event': event,
    ...built.headers,
  }
  if (secret) {
    headers['x-nexus-signature'] = `sha256=${crypto.createHmac('sha256', secret).update(built.body).digest('hex')}`
  }
  try {
    const res = await fetch(url, { method: 'POST', headers, body: built.body, signal: controller.signal })
    return { ok: res.ok, status: res.status, ms: Date.now() - started, error: res.ok ? '' : `HTTP ${res.status}` }
  } catch (err) {
    const message = err instanceof Error ? (err.name === 'AbortError' ? 'Délai dépassé (10 s)' : err.message) : 'Erreur réseau'
    return { ok: false, status: 0, ms: Date.now() - started, error: message }
  } finally {
    clearTimeout(timer)
  }
}

async function deliver(
  hook: PublicWebhook,
  url: string,
  input: DeliveryInput,
  ctx: { userId: string; secret: string }
): Promise<{ ok: boolean; status: number; ms: number; error: string }> {
  const built = buildBody(hook, url, input)
  const secret = ctx.secret
  // Une seconde tentative couvre les erreurs réseau transitoires et les 5xx.
  let result = await postBody(url, built, secret, input.event)
  if (!result.ok && (result.status === 0 || result.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    result = await postBody(url, built, secret, input.event)
  }

  await db.devWebhookLog
    .create({
      data: {
        userId: ctx.userId,
        webhookId: hook.id,
        event: input.event,
        ok: result.ok,
        status: result.status,
        ms: result.ms,
        error: result.error.slice(0, 500),
        preview: built.preview.slice(0, 600),
      },
    })
    .catch(() => null)
  await db.devWebhook
    .update({
      where: { id: hook.id },
      data: {
        lastStatus: result.ok ? `OK ${result.status} · ${result.ms} ms` : `Échec ${result.status || 'réseau'} · ${result.ms} ms`,
        lastError: result.error.slice(0, 500),
        lastDeliveryAt: new Date(),
      },
    })
    .catch(() => null)
  void trimLogs(hook)
  return result
}

async function trimLogs(hook: PublicWebhook): Promise<void> {
  try {
    const total = await db.devWebhookLog.count({ where: { webhookId: hook.id } })
    if (total <= MAX_LOGS_PER_USER) return
    const old = (await db.devWebhookLog.findMany({ where: { webhookId: hook.id }, orderBy: { createdAt: 'asc' }, take: total - MAX_LOGS_PER_USER })) as { id?: unknown }[]
    const ids = (old ?? []).map((r) => String(r.id ?? '')).filter(Boolean)
    if (ids.length) await db.devWebhookLog.deleteMany({ where: { id: { in: ids } } })
  } catch {
    /* la purge est opportuniste */
  }
}

// ── Émission ────────────────────────────────────────────────────────────────

/** Envoie un événement à tous les webhooks actifs du compte qui l'ont demandé. */
export async function emitDevEvent(userId: string, event: DevEvent, input: EventInput): Promise<{ sent: number; failed: number }> {
  if (!userId) return { sent: 0, failed: 0 }
  try {
    const rows = (await db.devWebhook.findMany({ where: { userId, enabled: true }, take: 20 }).catch(() => [])) as WebhookRow[]
    const targets = (rows ?? [])
      .map((row) => ({ row, hook: publicWebhook(row) }))
      .filter(({ hook }) => subscribed(hook.events, event))
    let sent = 0
    let failed = 0
    for (const { row, hook } of targets) {
      const url = String(row.url ?? '')
      if (!url) continue
      const result = await deliver(hook, url, { ...input, event }, {
        userId,
        secret: decryptSecret(str(row.secret)),
      })
      if (result.ok) sent++
      else failed++
    }
    return { sent, failed }
  } catch {
    return { sent: 0, failed: 0 }
  }
}

/** Envoie un message de test (ignores les abonnements, respecte `enabled`). */
export async function testWebhook(userId: string, id: string): Promise<{ ok: boolean; status: number; ms: number; error: string }> {
  const row = (await db.devWebhook.findUnique({ where: { id } }).catch(() => null)) as WebhookRow | null
  if (!row || String(row.userId ?? '') !== userId) return { ok: false, status: 0, ms: 0, error: 'Webhook introuvable.' }
  const hook = publicWebhook(row)
  const result = await deliver(hook, String(row.url ?? ''), {
    event: 'test',
    title: 'Test du webhook NEXUS',
    summary:
      'Si tu lis ce message, les alertes sont correctement câblées. Les prochains messages raconteront l’entraînement, ce que NEXUS a compris et les confirmations en attente — avec deux boutons Accepter / Refuser.',
    fields: [
      { name: 'Format détecté', value: detectFormat(hook, String(row.url ?? '')), inline: true },
      { name: 'Événements', value: hook.events.includes('*') ? 'tous' : `${hook.events.length} sélectionné(s)`, inline: true },
    ],
    links: { dashboard: `${resolveBaseUrl(hook.baseUrl)}/app` },
    data: { test: true },
  }, { userId, secret: decryptSecret(str(row.secret)) })
  return result
}

export async function listWebhookLogs(userId: string, take = 30): Promise<Record<string, unknown>[]> {
  const rows = (await db.devWebhookLog.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take }).catch(() => [])) as Record<string, unknown>[]
  return (rows ?? []).map((r) => ({
    id: str(r.id),
    webhookId: str(r.webhookId),
    event: str(r.event),
    ok: Boolean(r.ok),
    status: Number(r.status ?? 0),
    ms: Number(r.ms ?? 0),
    error: str(r.error, 300),
    preview: str(r.preview, 600),
    createdAt: iso(r.createdAt),
  }))
}

// ── Confirmations (Accepter / Refuser) ──────────────────────────────────────

const APPROVAL_KIND_LABEL: Record<string, string> = {
  patch: 'Correctif de code',
  item: 'Savoir à valider',
  task: 'Amélioration à traiter',
}

export interface RequestApprovalInput {
  userId: string
  kind: 'patch' | 'item' | 'task'
  refId: string
  title: string
  summary?: string
  payload?: Record<string, unknown>
  baseUrl?: string
}

/** Crée (ou réutilise) une demande de confirmation et prévient les webhooks. */
export async function requestApproval(input: RequestApprovalInput): Promise<ApprovalView | null> {
  if (!input.userId || !input.refId) return null
  try {
    const existing = (await db.devApproval
      .findFirst({ where: { userId: input.userId, kind: input.kind, refId: input.refId, status: 'pending' } })
      .catch(() => null)) as ApprovalRow | null
    if (existing) return approvalView(existing)

    const token = crypto.randomBytes(24).toString('hex')
    const row = (await db.devApproval.create({
      data: {
        userId: input.userId,
        kind: input.kind,
        refId: input.refId.slice(0, 200),
        title: input.title.slice(0, 300),
        summary: String(input.summary ?? '').slice(0, 4000),
        payload: JSON.stringify(input.payload ?? {}),
        status: 'pending',
        token,
        decidedBy: '',
        decidedAt: null,
      },
    })) as ApprovalRow

    const view = approvalView(row)
    const webhooks = (await db.devWebhook.findMany({ where: { userId: input.userId, enabled: true }, take: 20 }).catch(() => [])) as WebhookRow[]
    const base = input.baseUrl?.trim() || String((webhooks?.[0]?.baseUrl as string | undefined) ?? '')
    const acceptUrl = `${resolveBaseUrl(base)}/api/dev/approvals/action?token=${encodeURIComponent(token)}&decision=accept`
    const refuseUrl = `${resolveBaseUrl(base)}/api/dev/approvals/action?token=${encodeURIComponent(token)}&decision=refuse`

    await emitDevEvent(input.userId, 'approval.requested', {
      title: `Confirmation attendue — ${input.title}`,
      summary:
        String(input.summary ?? '').slice(0, 1200) ||
        'Une action attend ta décision. Les deux boutons ci-dessous exécutent immédiatement la décision, sans ouvrir l’application.',
      fields: [
        { name: 'Type', value: APPROVAL_KIND_LABEL[input.kind] ?? input.kind, inline: true },
        { name: 'Référence', value: input.refId.slice(0, 80), inline: true },
        { name: 'Décision', value: 'Accepter applique l’action · Refuser l’écarte', inline: false },
      ],
      links: { accept: acceptUrl, refuse: refuseUrl, dashboard: `${resolveBaseUrl(base)}/app` },
      data: { approvalId: view.id, approvalKind: input.kind, refId: input.refId, acceptUrl, refuseUrl },
    })

    await db.notification
      .create({
        data: {
          userId: input.userId,
          title: `Confirmation : ${input.title}`.slice(0, 200),
          body: String(input.summary ?? '').slice(0, 500),
          source: 'dev',
          read: false,
        },
      })
      .catch(() => null)
    await db.devApproval.update({ where: { id: view.id }, data: { notifiedAt: new Date() } }).catch(() => null)
    return { ...view, acceptUrl, refuseUrl }
  } catch {
    return null
  }
}

export async function listApprovals(userId: string, status = 'pending', take = 30): Promise<ApprovalView[]> {
  const where: Record<string, unknown> = { userId }
  if (status !== 'all') where.status = status
  const rows = (await db.devApproval.findMany({ where, orderBy: { createdAt: 'desc' }, take }).catch(() => [])) as ApprovalRow[]
  return (rows ?? []).map(approvalView)
}

export async function getApprovalByToken(token: string): Promise<ApprovalView | null> {
  const clean = String(token ?? '').trim()
  if (!/^[0-9a-f]{32,128}$/i.test(clean)) return null
  const row = (await db.devApproval.findFirst({ where: { token: clean } }).catch(() => null)) as ApprovalRow | null
  return row ? approvalView(row) : null
}

/** Met à jour le statut d'une confirmation et prévient les webhooks. */
export async function markApproval(id: string, status: 'accepted' | 'refused', decidedBy: string): Promise<ApprovalView | null> {
  const row = (await db.devApproval.findUnique({ where: { id } }).catch(() => null)) as ApprovalRow | null
  if (!row) return null
  const current = String(row.status ?? 'pending')
  if (current !== 'pending') return approvalView(row)
  const next = (await db.devApproval.update({
    where: { id },
    data: { status, decidedBy: decidedBy.slice(0, 120), decidedAt: new Date() },
  })) as ApprovalRow
  const view = approvalView(next)
  await emitDevEvent(String(row.userId ?? ''), 'approval.decided', {
    title: `${status === 'accepted' ? 'Accepté' : 'Refusé'} — ${str(row.title, 200)}`,
    summary: `La confirmation « ${str(row.title, 200)} » a été ${status === 'accepted' ? 'acceptée' : 'refusée'} par ${decidedBy}.`,
    fields: [
      { name: 'Type', value: APPROVAL_KIND_LABEL[str(row.kind)] ?? str(row.kind), inline: true },
      { name: 'Référence', value: str(row.refId, 80), inline: true },
    ],
    data: { approvalId: view.id, approvalKind: str(row.kind), refId: str(row.refId), decision: status },
  })
  return view
}

/** Ferme les confirmations en attente liées à une référence (patch, item, tâche). */
export async function syncApprovalForRef(refId: string, status: 'accepted' | 'refused', decidedBy: string): Promise<number> {
  if (!refId) return 0
  const rows = (await db.devApproval.findMany({ where: { refId, status: 'pending' }, take: 20 }).catch(() => [])) as ApprovalRow[]
  let n = 0
  for (const row of rows ?? []) {
    const updated = await markApproval(String(row.id), status, decidedBy).catch(() => null)
    if (updated) n++
  }
  return n
}

export const APPROVAL_LABEL = APPROVAL_KIND_LABEL
