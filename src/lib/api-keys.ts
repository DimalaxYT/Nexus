// ─── NEXUS — Clés API pour chatbots revendables ──────────────────────────────
// Chaque clé est liée à un compte et embarque sa PROPRE configuration :
//   • des RÈGLES « quand tu lis X → réponds Y » (prioritaires, exactes)
//   • éventuellement un agent + son BLUEPRINT (le schéma construit à la main)
//   • un prompt système, un message d'accueil, un message de repli
//   • des origines autorisées (CORS) et une limite d'appels par minute
// Le tout s'exécute avec le cerveau LOCAL de NEXUS : aucune dépendance externe,
// donc aucun coût par requête et aucune donnée chez un tiers.

import crypto from 'crypto'
import { db } from '@/lib/db'
import { sanitizeRules, type ReplyRule } from '@/lib/rules'

export const KEY_PREFIX = 'nx_'

export interface ApiKeyConfig {
  /** Règles « déclencheur → réponse exacte », évaluées dans l'ordre. */
  rules: ReplyRule[]
  /** Prompt système propre à cette clé (le « métier » du chatbot vendu). */
  systemPrompt: string
  /** Message renvoyé quand le visiteur ouvre la conversation. */
  welcomeMessage: string
  /** Réponse quand rien n'a été trouvé (ou que le cerveau n'a rien produit). */
  fallbackMessage: string
  /** Origines autorisées (CORS). Vide = toutes. */
  allowedOrigins: string[]
  /** Appels maximum par minute (0 = illimité). */
  rateLimitPerMin: number
  /** Utiliser l'agent lié (sa personnalité / son blueprint) avant le cerveau. */
  useAgent?: boolean
  /** Ne répondre QUE les règles : jamais le cerveau local. */
  strictRulesOnly?: boolean
  /** Renvoyer le détail du parcours (diagnostic) dans la réponse JSON. */
  debug?: boolean
}

export interface ApiKeyInfo {
  id: string
  name: string
  /** Préfixe affichable (jamassecret). */
  prefix: string
  last4: string
  agentId: string
  blueprintId: string
  config: ApiKeyConfig
  enabled: boolean
  totalCalls: number
  createdAt: Date | number
  lastUsedAt: Date | number | null
  updatedAt: Date | number
}

export const DEFAULT_CONFIG: ApiKeyConfig = {
  rules: [],
  systemPrompt: '',
  welcomeMessage: '',
  fallbackMessage: "Je n'ai pas compris votre demande. Pouvez-vous la reformuler ?",
  allowedOrigins: [],
  rateLimitPerMin: 60,
  useAgent: false,
  strictRulesOnly: false,
  debug: false,
}

// ── Fabrication / vérification ───────────────────────────────────────────────

/** Empreinte SHA-256 d'une clé (les clés sont aléatoires : SHA suffit). */
function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

/** Fabrique une clé affichable + son empreinte de stockage. */
export function mintApiKey(): { raw: string; hash: string; prefix: string; last4: string } {
  const body = crypto.randomBytes(24).toString('hex') // 48 caractères
  const raw = `${KEY_PREFIX}${body}`
  return {
    raw,
    hash: sha256(raw),
    prefix: `${KEY_PREFIX}${body.slice(0, 4)}`,
    last4: body.slice(-4),
  }
}

export function extractBearer(req: Request): string {
  const header = req.headers.get('authorization') ?? ''
  const m = header.match(/^Bearer\s+(.+)$/i)
  if (m) return m[1].trim()
  // Tolérance : ?key=… pour les intégrations simples (iframe, webhooks)
  const url = new URL(req.url)
  return (url.searchParams.get('key') ?? '').trim()
}

// ── Limitation de débit (fenêtre glissante, en mémoire) ──────────────────────

const hits = new Map<string, number[]>()

export function rateLimited(keyId: string, perMinute: number): boolean {
  if (!perMinute || perMinute <= 0) return false
  const now = Date.now()
  const window = 60_000
  const list = (hits.get(keyId) ?? []).filter((t) => now - t < window)
  if (list.length >= perMinute) {
    hits.set(keyId, list)
    return true
  }
  list.push(now)
  hits.set(keyId, list)
  // Entretien mémoire : purge des clés inactives
  if (hits.size > 500) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= window)) hits.delete(k)
  }
  return false
}

// ── Lecture / sérialisation ──────────────────────────────────────────────────

export function parseConfig(raw: unknown): ApiKeyConfig {
  if (typeof raw !== 'string' || !raw.trim()) return { ...DEFAULT_CONFIG, rules: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<ApiKeyConfig>
    return normalizeConfig(parsed)
  } catch {
    return { ...DEFAULT_CONFIG, rules: [] }
  }
}

export function normalizeConfig(input: Partial<ApiKeyConfig> | null | undefined): ApiKeyConfig {
  const c = (input ?? {}) as Partial<ApiKeyConfig>
  const origins = Array.isArray(c.allowedOrigins)
    ? c.allowedOrigins.map((o) => String(o).trim()).filter(Boolean).slice(0, 20)
    : []
  const limit = Number(c.rateLimitPerMin)
  return {
    rules: sanitizeRules(c.rules),
    systemPrompt: String(c.systemPrompt ?? '').slice(0, 8000),
    welcomeMessage: String(c.welcomeMessage ?? '').slice(0, 1000),
    fallbackMessage: String(c.fallbackMessage ?? '').slice(0, 2000) || DEFAULT_CONFIG.fallbackMessage,
    allowedOrigins: origins,
    rateLimitPerMin: Number.isFinite(limit) && limit >= 0 ? Math.min(limit, 6000) : 60,
    useAgent: Boolean(c.useAgent),
    strictRulesOnly: Boolean(c.strictRulesOnly),
    debug: Boolean(c.debug),
  }
}

 
export function toApiKeyInfo(row: any, withConfig = true): ApiKeyInfo {
  return {
    id: String(row.id),
    name: String(row.name ?? 'Clé API'),
    prefix: String(row.prefix ?? ''),
    last4: String(row.last4 ?? ''),
    agentId: String(row.agentId ?? ''),
    blueprintId: String(row.blueprintId ?? ''),
    config: withConfig ? parseConfig(row.config) : ({ ...DEFAULT_CONFIG, rules: [] } as ApiKeyConfig),
    enabled: row.enabled !== false,
    totalCalls: Number(row.totalCalls ?? 0),
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt ?? null,
    updatedAt: row.updatedAt,
  }
}

/** Résout une clé présentée dans l'en-tête Authorization (ou ?key=). */
export async function authenticateApiKey(
  req: Request
): Promise<{ ok: true; key: ApiKeyInfo; userId: string } | { ok: false; status: number; error: string }> {
  const raw = extractBearer(req)
  if (!raw.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: 'Clé API absente ou malformée (attendu : Authorization: Bearer nx_…).' }
  }
  try {
    const hash = sha256(raw)
    const row = await db.apiKey.findUnique({ where: { hash } })
    if (!row) return { ok: false, status: 401, error: 'Clé API invalide.' }
    if (row.enabled === false) return { ok: false, status: 403, error: 'Clé API désactivée.' }

    const key = toApiKeyInfo(row)

    // Contrôle d'origine (CORS) : si une liste est définie, elle fait foi.
    const origin = req.headers.get('origin')
    if (origin && key.config.allowedOrigins.length > 0 && !key.config.allowedOrigins.includes(origin)) {
      return { ok: false, status: 403, error: 'Origine non autorisée pour cette clé.' }
    }
    if (rateLimited(key.id, key.config.rateLimitPerMin)) {
      return { ok: false, status: 429, error: `Limite de ${key.config.rateLimitPerMin} appels/minute atteinte.` }
    }
    return { ok: true, key, userId: String(row.userId) }
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : 'Erreur serveur' }
  }
}

/** Journalise un appel (statistiques visibles dans le panneau Clés API). */
export async function logApiCall(
  keyId: string,
  ok: boolean,
  ms: number,
  message: string,
  reply: string
): Promise<void> {
  try {
    await db.apiKeyLog.create({
      data: {
        keyId,
        ok,
        ms: Math.round(ms),
        message: message.slice(0, 400),
        reply: reply.slice(0, 400),
      },
    })
    await db.apiKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date(), totalCalls: Number((await db.apiKey.findUnique({ where: { id: keyId } }))?.totalCalls ?? 0) + 1 },
    })
    // Rotation du journal : on garde les 200 derniers appels par clé
    const logs = await db.apiKeyLog.findMany({ where: { keyId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (logs.length > 200) {
      await db.apiKeyLog.deleteMany({ where: { id: { in: logs.slice(200).map((l) => String(l.id)) } } })
    }
  } catch {
    /* le journal ne doit jamais faire échouer une réponse */
  }
}

/** En-têtes CORS pour les appels navigateur (widget embarqué chez le client). */
export function corsHeaders(key: ApiKeyInfo, origin: string | null): Record<string, string> {
  const allowed = key.config.allowedOrigins
  const okOrigin =
    origin && (allowed.length === 0 || allowed.includes(origin))
      ? origin
      : allowed.length === 1
        ? allowed[0]
        : '*'
  return {
    'Access-Control-Allow-Origin': okOrigin,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
