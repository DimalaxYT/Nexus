import crypto from 'crypto'
import { createClient, type Client, type InValue, type ResultSet } from '@libsql/client'
import { resolveSource, localSource, type DbMode, type DbSource } from '@/lib/db-source'

// ─── NEXUS — Couche de données (libSQL : fichier local OU Turso) ─────────────
// Même API que l'ancien client (findMany / findUnique / create / update /
// upsert / delete / deleteMany / count), désormais ASYNCHRONE : chaque appel
// passe par une connexion libSQL. La cible (SQLite locale ou base Turso) se
// règle depuis l'espace Dev → Réglages, sans redéploiement. Les données sont
// migrables d'une cible à l'autre (copyDatabase).

interface TableSpec {
  table: string
  dateCols: string[]
  boolCols?: string[]
  hasUpdatedAt?: boolean
  defaults: Record<string, unknown>
}

const TABLES: Record<string, TableSpec> = {
  memory: {
    table: 'Memory',
    dateCols: ['createdAt'],
    defaults: { kind: 'fact', source: 'auto' },
  },
  conversation: {
    table: 'Conversation',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: {},
  },
  knowledge: {
    table: 'Knowledge',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: { category: 'Général', tags: '[]', links: '[]', source: 'manual' },
  },
  task: {
    table: 'Task',
    dateCols: ['createdAt', 'updatedAt', 'reportAt'],
    hasUpdatedAt: true,
    defaults: {
      duration: '',
      objectives: '[]',
      description: '',
      status: 'todo',
      progress: '[]',
      report: '',
      reportAt: null,
      agents: '[]',
    },
  },
  agentProfile: {
    table: 'AgentProfile',
    dateCols: ['createdAt', 'updatedAt'],
    boolCols: ['enabled', 'writer'],
    hasUpdatedAt: true,
    defaults: {
      emoji: '🤖',
      role: 'chercheur',
      description: '',
      prompt: '',
      specialties: '[]',
      color: '#ffffff',
      enabled: true,
      writer: false,
    },
  },
  accountConnection: {
    table: 'AccountConnection',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: { handle: '', secret: '', status: 'connected', note: '' },
  },
  agentGroup: {
    table: 'AgentGroup',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: { emoji: '👥', color: '#38bdf8', members: '[]' },
  },

  // ── Comptes & sessions (authentification locale, zéro service externe) ─────
  user: {
    table: 'User',
    dateCols: ['createdAt', 'updatedAt', 'lastSeenAt'],
    boolCols: ['isAdmin'],
    hasUpdatedAt: true,
    defaults: {
      name: '',
      passwordHash: '',
      salt: '',
      isAdmin: false,
      profile: '{}',
      plan: 'free',
      role: 'client',
    },
  },
  session: {
    table: 'Session',
    dateCols: ['createdAt', 'expiresAt', 'lastSeenAt'],
    defaults: { userAgent: '' },
  },
  blueprint: {
    table: 'Blueprint',
    dateCols: ['createdAt', 'updatedAt'],
    boolCols: ['enabled'],
    hasUpdatedAt: true,
    defaults: { agentId: '', description: '', graph: '{}', enabled: true },
  },
  apiKey: {
    table: 'ApiKey',
    dateCols: ['createdAt', 'updatedAt', 'lastUsedAt'],
    boolCols: ['enabled'],
    hasUpdatedAt: true,
    defaults: {
      name: 'Clé API',
      prefix: '',
      hash: '',
      last4: '',
      agentId: '',
      blueprintId: '',
      config: '{}',
      enabled: true,
      totalCalls: 0,
    },
  },
  apiKeyLog: {
    table: 'ApiKeyLog',
    dateCols: ['createdAt'],
    boolCols: ['ok'],
    defaults: { keyId: '', message: '', reply: '', ms: 0 },
  },

  // ── Espace développeur (compte Dev) ────────────────────────────────────────
  /** Codes de vérification e-mail : 2FA à la connexion & mot de passe oublié. */
  verificationCode: {
    table: 'VerificationCode',
    dateCols: ['createdAt', 'expiresAt'],
    boolCols: ['consumed'],
    defaults: { purpose: 'login', attempts: 0, consumed: false },
  },
  /** Réglages du site modifiables depuis le web (une ligne par clé). */
  siteSetting: {
    table: 'SiteSetting',
    dateCols: ['updatedAt'],
    hasUpdatedAt: true,
    defaults: { value: '', updatedBy: '' },
  },
  /** Correctifs proposés par l'agent Dev, appliqués ou refusés. */
  devPatch: {
    table: 'DevPatch',
    dateCols: ['createdAt', 'appliedAt'],
    defaults: {
      userId: '',
      title: '',
      filePath: '',
      before: '',
      after: '',
      rationale: '',
      status: 'propose',
      origin: 'agent',
    },
  },
  /** Bibliothèque du navigateur de l'agent Dev (pages visitées et extraites). */
  devPage: {
    table: 'DevPage',
    dateCols: ['fetchedAt'],
    defaults: {
      userId: '',
      url: '',
      title: '',
      domain: '',
      text: '',
      bytes: 0,
      runId: '',
      origin: 'agent',
      hits: 0,
    },
  },
  /** Objectifs d'entraînement : la file d'apprentissage de NEXUS. */
  trainingObjective: {
    table: 'TrainingObjective',
    dateCols: ['createdAt', 'updatedAt', 'lastRunAt'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      label: '',
      query: '',
      category: 'culture',
      priority: 5,
      status: 'a_faire',
      attempts: 0,
      lastScore: 0,
      origin: 'auto',
    },
  },
  /** Connaissances produites par l'entraînement (candidates, validées ou refusées). */
  trainingItem: {
    table: 'TrainingItem',
    dateCols: ['createdAt', 'appliedAt', 'lastHitAt'],
    defaults: {
      userId: '',
      objectiveId: '',
      runId: '',
      question: '',
      answer: '',
      keywords: '[]',
      sources: '[]',
      score: 0,
      status: 'candidat',
      hits: 0,
      offline: false,
    },
  },
  /** Journal des cycles d'entraînement (un cycle = une ligne). */
  trainingRun: {
    table: 'TrainingRun',
    dateCols: ['startedAt', 'endedAt'],
    defaults: {
      userId: '',
      status: 'en_cours',
      objective: '',
      steps: '[]',
      pages: 0,
      items: 0,
      scoreBefore: 0,
      scoreAfter: 0,
      offline: false,
      error: '',
    },
  },
  /** Leçons de l'entraîneur : ce qui a marché, pour qu'il s'améliore lui-même. */
  trainingLesson: {
    table: 'TrainingLesson',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      kind: '',
      key: '',
      value: 0,
      samples: 0,
      note: '',
    },
  },
  /** File d'améliorations : idées, diagnostics et tâches de l'agent Dev. */
  devTask: {
    table: 'DevTask',
    dateCols: ['createdAt', 'updatedAt'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      title: '',
      detail: '',
      category: 'intelligence',
      priority: 'normale',
      status: 'a_faire',
      filePath: '',
    },
  },

  /** Modèle de langage maison : poids, vocabulaire et configuration (un seul actif). */
  llmModel: {
    table: 'LlmModel',
    dateCols: ['createdAt', 'updatedAt'],
    boolCols: ['active'],
    hasUpdatedAt: true,
    defaults: {
      name: 'nexus-llm',
      config: '{}',
      vocab: '[]',
      weights: '',
      steps: 0,
      loss: 0,
      corpusChars: 0,
      corpusInfo: '{}',
      active: false,
    },
  },
  /** Filtres de conversations (espace Dev) : exclure de l'entraînement ou masquer. */
  conversationFilter: {
    table: 'ConversationFilter',
    dateCols: ['createdAt', 'updatedAt'],
    boolCols: ['enabled'],
    hasUpdatedAt: true,
    defaults: { userId: '', scopeUserId: '', kind: 'keyword', pattern: '', action: 'exclude', enabled: true, hits: 0 },
  },
  /** Notifications in-app (surveillances de sites, planifications de blueprints). */
  notification: {
    table: 'Notification',
    dateCols: ['createdAt'],
    boolCols: ['read'],
    defaults: { userId: '', title: '', body: '', source: 'system', read: false },
  },
  /** Exécution automatique d'un blueprint (assistant qui tourne seul). */
  blueprintSchedule: {
    table: 'BlueprintSchedule',
    dateCols: ['createdAt', 'updatedAt', 'lastRunAt', 'nextRunAt'],
    boolCols: ['enabled'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      blueprintId: '',
      everyMin: 60,
      message: '',
      enabled: true,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: '',
      lastReply: '',
    },
  },
}


/**
 * Tables cloisonnées par compte : une colonne `userId` est ajoutée
 * automatiquement (migration légère) pour que chaque utilisateur ne voie QUE
 * ses conversations, agents, connaissances, mémoires, missions et connexions.
 */
const USER_SCOPED_TABLES = [
  'Conversation',
  'Knowledge',
  'Memory',
  'Task',
  'AgentProfile',
  'AgentGroup',
  'AccountConnection',
] as const

function cuid(): string {
  return `c${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`
}

function toSqlVal(v: unknown): InValue {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  return JSON.stringify(v)
}

type Row = Record<string, unknown>

/** Convertit un ResultSet libSQL en objets { colonne: valeur }. */
function rowsOf(res: ResultSet): Row[] {
  return res.rows.map((r) => {
    const out: Row = {}
    res.columns.forEach((col, i) => {
      out[col] = r[i]
    })
    return out
  })
}

function hydrateRow(row: Row | undefined, spec: TableSpec, select?: Record<string, boolean>) {
  if (!row) return null
  const out: Row = {}
  for (const [k, v] of Object.entries(row)) {
    if (select && !select[k]) continue
    if (spec.dateCols.includes(k)) {
      out[k] = v === null || v === undefined ? null : new Date(typeof v === 'number' ? v : Number(v) || String(v))
    } else if (spec.boolCols?.includes(k)) {
      out[k] = Boolean(v)
    } else {
      out[k] = v
    }
  }
  return out
}

function buildWhere(where: Row | undefined): { sql: string; params: InValue[] } {
  if (!where || Object.keys(where).length === 0) return { sql: '', params: [] }
  const clauses: string[] = []
  const params: InValue[] = []
  for (const [col, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (cond === null) {
      clauses.push(`"${col}" IS NULL`)
    } else if (typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Row
      if (Array.isArray(c.in)) {
        if (c.in.length === 0) {
          clauses.push('1 = 0')
        } else {
          clauses.push(`"${col}" IN (${c.in.map(() => '?').join(', ')})`)
          for (const item of c.in) params.push(toSqlVal(item))
        }
      }
      if (c.lt !== undefined) {
        clauses.push(`"${col}" < ?`)
        params.push(toSqlVal(c.lt))
      }
      if (c.lte !== undefined) {
        clauses.push(`"${col}" <= ?`)
        params.push(toSqlVal(c.lte))
      }
      if (c.gt !== undefined) {
        clauses.push(`"${col}" > ?`)
        params.push(toSqlVal(c.gt))
      }
      if (c.gte !== undefined) {
        clauses.push(`"${col}" >= ?`)
        params.push(toSqlVal(c.gte))
      }
    } else {
      clauses.push(`"${col}" = ?`)
      params.push(toSqlVal(cond))
    }
  }
  return {
    sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}

function buildOrderBy(orderBy: unknown): string {
  if (!orderBy) return ''
  const items = Array.isArray(orderBy) ? orderBy : [orderBy]
  const parts: string[] = []
  for (const it of items) {
    if (it && typeof it === 'object') {
      for (const [col, dir] of Object.entries(it as Record<string, string>)) {
        parts.push(`"${col}" ${String(dir).toUpperCase() === 'DESC' ? 'DESC' : 'ASC'}`)
      }
    }
  }
  return parts.length > 0 ? ` ORDER BY ${parts.join(', ')}` : ''
}

// ── Connexion courante (locale ou Turso) ─────────────────────────────────────

interface Conn {
  client: Client
  source: DbSource
  /** Schéma prêt (promesse résolue) ; remise à null si l'initialisation échoue. */
  ready: Promise<void> | null
}

const g = globalThis as unknown as { __nexusDbConn?: Conn }

function makeConn(source: DbSource): Conn {
  const client =
    source.mode === 'local'
      ? createClient({ url: `file:${source.url}` })
      : createClient({ url: source.url, authToken: source.authToken })
  return { client, source, ready: null }
}

function getConn(): Conn {
  if (!g.__nexusDbConn) g.__nexusDbConn = makeConn(resolveSource())
  return g.__nexusDbConn
}

/** Schéma + migrations légères. Idempotent : sûr à relancer à chaque démarrage. */
async function initSchema(client: Client, mode: DbMode): Promise<void> {
  if (mode === 'local') {
    await client.execute('PRAGMA busy_timeout = 5000')
    await client.execute('PRAGMA journal_mode = WAL')
  }
  await client.executeMultiple(BASE_DDL)

  // Colonnes ajoutées après coup (bases existantes)
  const addColumnIfMissing = async (table: string, column: string, ddl: string) => {
    try {
      const res = await client.execute(`PRAGMA table_info("${table}")`)
      const cols = rowsOf(res).map((c) => String(c.name))
      if (!cols.includes(column)) await client.execute(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`)
    } catch {
      /* table pas encore créée : le CREATE TABLE ci-dessus la créera complète */
    }
  }
  for (const table of USER_SCOPED_TABLES) {
    await addColumnIfMissing(table, 'userId', '"userId" TEXT')
    await client.execute(`CREATE INDEX IF NOT EXISTS "${table}_userId_idx" ON "${table}"("userId")`)
  }
  await addColumnIfMissing('AgentProfile', 'blueprintId', '"blueprintId" TEXT')
  // Agent système (l'agent Dev) : `systemKey` vaut 'dev' — ni supprimable, ni visible
  // depuis un autre compte.
  await addColumnIfMissing('AgentProfile', 'systemKey', '"systemKey" TEXT NOT NULL DEFAULT \'\'')
  // Rôle du compte : 'owner' (propriétaire), 'dev' (développeur), 'client'.
  await addColumnIfMissing('User', 'role', '"role" TEXT NOT NULL DEFAULT \'client\'')
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")')
  await addColumnIfMissing('SiteSetting', 'createdAt', '"createdAt" DATETIME')
  for (const t of ['DevPage', 'TrainingObjective', 'TrainingItem', 'TrainingRun', 'TrainingLesson']) {
    await addColumnIfMissing(t, 'createdAt', '"createdAt" DATETIME')
  }
  for (const sql of INDEX_SQL) await client.execute(sql)
}

const INDEX_SQL = [
  'CREATE UNIQUE INDEX IF NOT EXISTS "SiteSetting_key_key" ON "SiteSetting"("key")',
  'CREATE INDEX IF NOT EXISTS "DevPatch_userId_idx" ON "DevPatch"("userId")',
  'CREATE INDEX IF NOT EXISTS "DevTask_userId_idx" ON "DevTask"("userId")',
  'CREATE INDEX IF NOT EXISTS "DevPage_userId_idx" ON "DevPage"("userId")',
  'CREATE INDEX IF NOT EXISTS "DevPage_url_idx" ON "DevPage"("url")',
  'CREATE INDEX IF NOT EXISTS "TrainingObjective_userId_idx" ON "TrainingObjective"("userId")',
  'CREATE INDEX IF NOT EXISTS "TrainingItem_userId_idx" ON "TrainingItem"("userId")',
  'CREATE INDEX IF NOT EXISTS "TrainingRun_userId_idx" ON "TrainingRun"("userId")',
  'CREATE INDEX IF NOT EXISTS "TrainingLesson_userId_idx" ON "TrainingLesson"("userId")',
  'CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")',
  'CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId")',
  'CREATE INDEX IF NOT EXISTS "ApiKeyLog_keyId_idx" ON "ApiKeyLog"("keyId")',
  'CREATE INDEX IF NOT EXISTS "Blueprint_userId_idx" ON "Blueprint"("userId")',
  'CREATE INDEX IF NOT EXISTS "ConversationFilter_userId_idx" ON "ConversationFilter"("userId")',
  'CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId")',
  'CREATE INDEX IF NOT EXISTS "BlueprintSchedule_userId_idx" ON "BlueprintSchedule"("userId")',
]

/** Garantit que la connexion courante est prête (schéma créé) avant toute requête. */
async function client(): Promise<Client> {
  const conn = getConn()
  if (!conn.ready) {
    const ready: Promise<void> = initSchema(conn.client, conn.source.mode).catch((err: unknown) => {
      if (conn.ready === ready) conn.ready = null
      throw err
    })
    conn.ready = ready
  }
  await conn.ready
  return conn.client
}

async function run(sql: string, args: InValue[] = []): Promise<ResultSet> {
  return (await client()).execute({ sql, args })
}

// ── Délégués de modèles (API identique à l'ancien client) ───────────────────

function createModelDelegate(spec: TableSpec) {
  return {
    async findMany(args?: {
      where?: Row
      orderBy?: unknown
      take?: number
      select?: Record<string, boolean>
    }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const orderSql = buildOrderBy(args?.orderBy)
      const limitSql = typeof args?.take === 'number' ? ` LIMIT ${Math.max(0, Math.floor(args.take))}` : ''
      const res = await run(`SELECT * FROM "${spec.table}"${whereSql}${orderSql}${limitSql}`, params)
      return rowsOf(res).map((r) => hydrateRow(r, spec, args?.select))
    },

    async findUnique(args: { where: Row; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args.where)
      const res = await run(`SELECT * FROM "${spec.table}"${whereSql} LIMIT 1`, params)
      return hydrateRow(rowsOf(res)[0], spec, args.select)
    },

    async findFirst(args?: { where?: Row; orderBy?: unknown; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const orderSql = buildOrderBy(args?.orderBy)
      const res = await run(`SELECT * FROM "${spec.table}"${whereSql}${orderSql} LIMIT 1`, params)
      return hydrateRow(rowsOf(res)[0], spec, args?.select)
    },

    async count(args?: { where?: Row }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const res = await run(`SELECT COUNT(*) as cnt FROM "${spec.table}"${whereSql}`, params)
      return Number(rowsOf(res)[0]?.cnt ?? 0)
    },

    async create(args: { data: Row }) {
      const now = Date.now()
      const record: Row = {
        id: cuid(),
        ...spec.defaults,
        createdAt: now,
        ...(spec.hasUpdatedAt ? { updatedAt: now } : {}),
        ...args.data,
      }
      const cols = Object.keys(record)
      const placeholders = cols.map(() => '?').join(', ')
      const vals = cols.map((c) => toSqlVal(record[c]))
      await run(`INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`, vals)
      const res = await run(`SELECT * FROM "${spec.table}" WHERE "id" = ? LIMIT 1`, [toSqlVal(record.id)])
      return hydrateRow(rowsOf(res)[0], spec)
    },

    async update(args: { where: Row; data: Row }) {
      const patch: Row = {
        ...args.data,
        ...(spec.hasUpdatedAt ? { updatedAt: Date.now() } : {}),
      }
      const cols = Object.keys(patch).filter((k) => patch[k] !== undefined)
      const setSql = cols.map((c) => `"${c}" = ?`).join(', ')
      const setVals = cols.map((c) => toSqlVal(patch[c]))
      const { sql: whereSql, params: whereVals } = buildWhere(args.where)
      await run(`UPDATE "${spec.table}" SET ${setSql}${whereSql}`, [...setVals, ...whereVals])
      const res = await run(`SELECT * FROM "${spec.table}"${whereSql} LIMIT 1`, whereVals)
      return hydrateRow(rowsOf(res)[0], spec)
    },

    async upsert(args: { where: Row; create: Row; update: Row }) {
      const existing = await this.findUnique({ where: args.where })
      if (existing) {
        return this.update({ where: args.where, data: args.update })
      }
      return this.create({ data: { ...args.where, ...args.create } })
    },

    async delete(args: { where: Row }) {
      const existing = await this.findUnique({ where: args.where })
      const { sql: whereSql, params } = buildWhere(args.where)
      await run(`DELETE FROM "${spec.table}"${whereSql}`, params)
      return existing
    },

    async deleteMany(args?: { where?: Row }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const res = await run(`DELETE FROM "${spec.table}"${whereSql}`, params)
      return { count: Number(res.rowsAffected ?? 0) }
    },
  }
}

// ── Outils de migration & de diagnostic (utilisés par l'espace Dev) ─────────

/** Liste des tables utilisateur d'une base. */
export async function listTables(c: Client): Promise<string[]> {
  const res = await c.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return rowsOf(res).map((r) => String(r.name))
}

/**
 * Copie intégrale d'une base vers une autre (local → Turso ou Turso → local).
 * Le schéma de la cible est créé d'abord, puis les lignes sont recopiées par lots
 * (INSERT OR REPLACE : relancer la copie est sans risque).
 */
export async function copyDatabase(from: Client, to: Client): Promise<{ tables: number; rows: number }> {
  await initSchema(to, 'turso')
  const names = await listTables(from)
  let rows = 0
  for (const table of names) {
    const src = await from.execute(`SELECT * FROM "${table}"`)
    if (src.rows.length === 0) continue
    const cols = src.columns
    const sql = `INSERT OR REPLACE INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    for (let i = 0; i < src.rows.length; i += 100) {
      const chunk = src.rows.slice(i, i + 100)
      await to.batch(
        chunk.map((r) => ({ sql, args: cols.map((_c, idx) => (r[idx] as InValue) ?? null) })),
        'write'
      )
    }
    rows += src.rows.length
  }
  return { tables: names.length, rows }
}

/** Nombre de lignes par table + latence (pour l'état de la base dans le dashboard). */
export async function databaseStats(): Promise<{
  latencyMs: number
  tables: { name: string; rows: number }[]
  totalRows: number
}> {
  const t0 = Date.now()
  const c = await client()
  const latencyMs = Date.now() - t0
  const names = await listTables(c)
  const tables: { name: string; rows: number }[] = []
  let totalRows = 0
  for (const name of names) {
    const res = await c.execute(`SELECT COUNT(*) AS cnt FROM "${name}"`)
    const n = Number(rowsOf(res)[0]?.cnt ?? 0)
    tables.push({ name, rows: n })
    totalRows += n
  }
  return { latencyMs, tables, totalRows }
}

/** Connexion courante : mode et hôte (sans jeton). */
export function currentDatabase(): { mode: DbMode; origin: DbSource['origin']; target: string } {
  const { source } = getConn()
  let target = source.url
  if (source.mode === 'turso') {
    try {
      target = new URL(source.url).host
    } catch {
      target = source.url
    }
  }
  return { mode: source.mode, origin: source.origin, target }
}

/** Client de la base courante (pour copier vers l'autre cible). */
export async function currentClient(): Promise<Client> {
  return client()
}

/**
 * Bascule la connexion vers une autre cible. La nouvelle connexion est testée
 * (schéma créé) AVANT le basculement : en cas d'échec, l'ancienne reste active.
 */
export async function switchDatabase(source: DbSource): Promise<void> {
  const next = makeConn(source)
  await (next.ready = initSchema(next.client, source.mode).then(() => undefined))
  const prev = g.__nexusDbConn
  g.__nexusDbConn = next
  if (prev && prev.client !== next.client) {
    try {
      prev.client.close()
    } catch {
      /* déjà fermé */
    }
  }
}

/** Ouvre une cible sans basculer (test de connexion, copie). */
export async function openTarget(source: DbSource): Promise<Client> {
  const c = makeConn(source).client
  try {
    await initSchema(c, source.mode)
    return c
  } catch (err) {
    try {
      c.close()
    } catch {
      /* ignore */
    }
    throw err
  }
}

export { localSource }

const BASE_DDL = `
    CREATE TABLE IF NOT EXISTS "Memory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "content" TEXT NOT NULL,
      "kind" TEXT NOT NULL DEFAULT 'fact',
      "source" TEXT NOT NULL DEFAULT 'auto',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "data" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "Knowledge" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "category" TEXT NOT NULL DEFAULT 'Général',
      "tags" TEXT NOT NULL DEFAULT '[]',
      "links" TEXT NOT NULL DEFAULT '[]',
      "source" TEXT NOT NULL DEFAULT 'manual',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "Task" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "duration" TEXT NOT NULL DEFAULT '',
      "objectives" TEXT NOT NULL DEFAULT '[]',
      "description" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'todo',
      "progress" TEXT NOT NULL DEFAULT '[]',
      "report" TEXT NOT NULL DEFAULT '',
      "reportAt" DATETIME,
      "agents" TEXT NOT NULL DEFAULT '[]',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "AgentProfile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "emoji" TEXT NOT NULL DEFAULT '🤖',
      "role" TEXT NOT NULL DEFAULT 'chercheur',
      "description" TEXT NOT NULL DEFAULT '',
      "prompt" TEXT NOT NULL DEFAULT '',
      "specialties" TEXT NOT NULL DEFAULT '[]',
      "color" TEXT NOT NULL DEFAULT '#ffffff',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "writer" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "AccountConnection" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "provider" TEXT NOT NULL,
      "handle" TEXT NOT NULL DEFAULT '',
      "secret" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'connected',
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "AgentGroup" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "emoji" TEXT NOT NULL DEFAULT '👥',
      "color" TEXT NOT NULL DEFAULT '#38bdf8',
      "members" TEXT NOT NULL DEFAULT '[]',
      "userId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "name" TEXT NOT NULL DEFAULT '',
      "passwordHash" TEXT NOT NULL DEFAULT '',
      "salt" TEXT NOT NULL DEFAULT '',
      "isAdmin" BOOLEAN NOT NULL DEFAULT false,
      "plan" TEXT NOT NULL DEFAULT 'free',
      "profile" TEXT NOT NULL DEFAULT '{}',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "lastSeenAt" DATETIME
    );
    CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "userAgent" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" DATETIME NOT NULL,
      "lastSeenAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "Blueprint" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL DEFAULT '',
      "name" TEXT NOT NULL,
      "description" TEXT NOT NULL DEFAULT '',
      "graph" TEXT NOT NULL DEFAULT '{}',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS "ApiKey" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL DEFAULT 'Clé API',
      "prefix" TEXT NOT NULL DEFAULT '',
      "hash" TEXT NOT NULL DEFAULT '',
      "last4" TEXT NOT NULL DEFAULT '',
      "agentId" TEXT NOT NULL DEFAULT '',
      "blueprintId" TEXT NOT NULL DEFAULT '',
      "config" TEXT NOT NULL DEFAULT '{}',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "totalCalls" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "lastUsedAt" DATETIME
    );
    CREATE TABLE IF NOT EXISTS "ApiKeyLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "keyId" TEXT NOT NULL DEFAULT '',
      "message" TEXT NOT NULL DEFAULT '',
      "reply" TEXT NOT NULL DEFAULT '',
      "ms" INTEGER NOT NULL DEFAULT 0,
      "ok" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "VerificationCode" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "codeHash" TEXT NOT NULL,
      "purpose" TEXT NOT NULL DEFAULT 'login',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "consumed" BOOLEAN NOT NULL DEFAULT false,
      "expiresAt" DATETIME NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "SiteSetting" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "key" TEXT NOT NULL,
      "value" TEXT NOT NULL DEFAULT '',
      "updatedBy" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "DevPatch" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "filePath" TEXT NOT NULL DEFAULT '',
      "before" TEXT NOT NULL DEFAULT '',
      "after" TEXT NOT NULL DEFAULT '',
      "rationale" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'propose',
      "origin" TEXT NOT NULL DEFAULT 'agent',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "appliedAt" DATETIME
    );
    CREATE TABLE IF NOT EXISTS "DevPage" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "url" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "domain" TEXT NOT NULL DEFAULT '',
      "text" TEXT NOT NULL DEFAULT '',
      "bytes" INTEGER NOT NULL DEFAULT 0,
      "runId" TEXT NOT NULL DEFAULT '',
      "origin" TEXT NOT NULL DEFAULT 'agent',
      "hits" INTEGER NOT NULL DEFAULT 0,
      "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "TrainingObjective" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "label" TEXT NOT NULL DEFAULT '',
      "query" TEXT NOT NULL DEFAULT '',
      "category" TEXT NOT NULL DEFAULT 'culture',
      "priority" INTEGER NOT NULL DEFAULT 5,
      "status" TEXT NOT NULL DEFAULT 'a_faire',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "lastScore" REAL NOT NULL DEFAULT 0,
      "origin" TEXT NOT NULL DEFAULT 'auto',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastRunAt" DATETIME
    );
    CREATE TABLE IF NOT EXISTS "TrainingItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "objectiveId" TEXT NOT NULL DEFAULT '',
      "runId" TEXT NOT NULL DEFAULT '',
      "question" TEXT NOT NULL DEFAULT '',
      "answer" TEXT NOT NULL DEFAULT '',
      "keywords" TEXT NOT NULL DEFAULT '[]',
      "sources" TEXT NOT NULL DEFAULT '[]',
      "score" REAL NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'candidat',
      "hits" INTEGER NOT NULL DEFAULT 0,
      "offline" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "appliedAt" DATETIME,
      "lastHitAt" DATETIME
    );
    CREATE TABLE IF NOT EXISTS "TrainingRun" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "status" TEXT NOT NULL DEFAULT 'en_cours',
      "objective" TEXT NOT NULL DEFAULT '',
      "steps" TEXT NOT NULL DEFAULT '[]',
      "pages" INTEGER NOT NULL DEFAULT 0,
      "items" INTEGER NOT NULL DEFAULT 0,
      "scoreBefore" REAL NOT NULL DEFAULT 0,
      "scoreAfter" REAL NOT NULL DEFAULT 0,
      "offline" BOOLEAN NOT NULL DEFAULT false,
      "error" TEXT NOT NULL DEFAULT '',
      "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "TrainingLesson" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL DEFAULT '',
      "key" TEXT NOT NULL DEFAULT '',
      "value" REAL NOT NULL DEFAULT 0,
      "samples" INTEGER NOT NULL DEFAULT 0,
      "note" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "DevTask" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "detail" TEXT NOT NULL DEFAULT '',
      "category" TEXT NOT NULL DEFAULT 'intelligence',
      "priority" TEXT NOT NULL DEFAULT 'normale',
      "status" TEXT NOT NULL DEFAULT 'a_faire',
      "filePath" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "LlmModel" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL DEFAULT 'nexus-llm',
      "config" TEXT NOT NULL DEFAULT '{}',
      "vocab" TEXT NOT NULL DEFAULT '[]',
      "weights" TEXT NOT NULL DEFAULT '',
      "steps" INTEGER NOT NULL DEFAULT 0,
      "loss" REAL NOT NULL DEFAULT 0,
      "corpusChars" INTEGER NOT NULL DEFAULT 0,
      "corpusInfo" TEXT NOT NULL DEFAULT '{}',
      "active" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "ConversationFilter" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "scopeUserId" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL DEFAULT 'keyword',
      "pattern" TEXT NOT NULL DEFAULT '',
      "action" TEXT NOT NULL DEFAULT 'exclude',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "hits" INTEGER NOT NULL DEFAULT 0,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "Notification" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "body" TEXT NOT NULL DEFAULT '',
      "source" TEXT NOT NULL DEFAULT 'system',
      "read" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "BlueprintSchedule" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "blueprintId" TEXT NOT NULL DEFAULT '',
      "everyMin" INTEGER NOT NULL DEFAULT 60,
      "message" TEXT NOT NULL DEFAULT '',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "lastRunAt" DATETIME,
      "nextRunAt" DATETIME,
      "lastStatus" TEXT NOT NULL DEFAULT '',
      "lastReply" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

  `

function buildDb() {
  return {
    memory: createModelDelegate(TABLES.memory),
    conversation: createModelDelegate(TABLES.conversation),
    knowledge: createModelDelegate(TABLES.knowledge),
    task: createModelDelegate(TABLES.task),
    agentProfile: createModelDelegate(TABLES.agentProfile),
    accountConnection: createModelDelegate(TABLES.accountConnection),
    agentGroup: createModelDelegate(TABLES.agentGroup),
    user: createModelDelegate(TABLES.user),
    session: createModelDelegate(TABLES.session),
    blueprint: createModelDelegate(TABLES.blueprint),
    apiKey: createModelDelegate(TABLES.apiKey),
    apiKeyLog: createModelDelegate(TABLES.apiKeyLog),
    siteSetting: createModelDelegate(TABLES.siteSetting),
    devPatch: createModelDelegate(TABLES.devPatch),
    devTask: createModelDelegate(TABLES.devTask),
    devPage: createModelDelegate(TABLES.devPage),
    trainingObjective: createModelDelegate(TABLES.trainingObjective),
    trainingItem: createModelDelegate(TABLES.trainingItem),
    trainingRun: createModelDelegate(TABLES.trainingRun),
    trainingLesson: createModelDelegate(TABLES.trainingLesson),
    verificationCode: createModelDelegate(TABLES.verificationCode),
    llmModel: createModelDelegate(TABLES.llmModel),
    conversationFilter: createModelDelegate(TABLES.conversationFilter),
    notification: createModelDelegate(TABLES.notification),
    blueprintSchedule: createModelDelegate(TABLES.blueprintSchedule),
  }
}

/**
 * Client « db » : délégués asynchrones. Typé `any` pour conserver la souplesse
 * de l'ancien client (les lignes sont des objets dynamiques).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = buildDb()
