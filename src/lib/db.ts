import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'

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
      color: '#a78bfa',
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

function resolveDbPath(): string {
  const defaultPath = path.join(process.cwd(), 'db', 'custom.db')
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw || raw.includes('/home/z/my-project')) return defaultPath
  if (raw.startsWith('file:')) {
    const rel = raw.slice(5)
    // Chemin absolu (ex. `file:/data/custom.db` sur un disque persistant) :
    // on l'utilise tel quel, même si le fichier n'existe pas encore — sinon on
    // retomberait sur le dossier du projet, qui est éphémère en production.
    if (path.isAbsolute(rel)) return rel
    const fromPrisma = path.resolve(process.cwd(), 'prisma', rel)
    if (fs.existsSync(fromPrisma)) return fromPrisma
    return path.resolve(process.cwd(), rel)
  }
  // Chemin absolu brut, sans préfixe `file:`.
  if (path.isAbsolute(raw)) return raw
  return defaultPath
}

function toSqlVal(v: unknown): string | number | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number' || typeof v === 'string') return v
  return JSON.stringify(v)
}

function hydrateRow(row: Record<string, unknown> | undefined, spec: TableSpec, select?: Record<string, boolean>) {
  if (!row) return null
  const out: Record<string, unknown> = {}
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

function buildWhere(where: Record<string, unknown> | undefined): { sql: string; params: (string | number | null)[] } {
  if (!where || Object.keys(where).length === 0) return { sql: '', params: [] }
  const clauses: string[] = []
  const params: (string | number | null)[] = []
  for (const [col, cond] of Object.entries(where)) {
    if (cond === undefined) continue
    if (cond === null) {
      clauses.push(`"${col}" IS NULL`)
    } else if (typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>
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

function createModelDelegate(sqlite: DatabaseSync, spec: TableSpec) {
  return {
    async findMany(args?: {
      where?: Record<string, unknown>
      orderBy?: unknown
      take?: number
      select?: Record<string, boolean>
    }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const orderSql = buildOrderBy(args?.orderBy)
      const limitSql = typeof args?.take === 'number' ? ` LIMIT ${Math.max(0, Math.floor(args.take))}` : ''
      const rows = sqlite.prepare(`SELECT * FROM "${spec.table}"${whereSql}${orderSql}${limitSql}`).all(...params) as Record<string, unknown>[]
      return rows.map((r) => hydrateRow(r, spec, args?.select))
    },

    async findUnique(args: { where: Record<string, unknown>; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args.where)
      const row = sqlite.prepare(`SELECT * FROM "${spec.table}"${whereSql} LIMIT 1`).get(...params) as Record<string, unknown> | undefined
      return hydrateRow(row, spec, args.select)
    },

    async findFirst(args?: { where?: Record<string, unknown>; orderBy?: unknown; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const orderSql = buildOrderBy(args?.orderBy)
      const row = sqlite.prepare(`SELECT * FROM "${spec.table}"${whereSql}${orderSql} LIMIT 1`).get(...params) as Record<string, unknown> | undefined
      return hydrateRow(row, spec, args?.select)
    },

    async count(args?: { where?: Record<string, unknown> }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const row = sqlite.prepare(`SELECT COUNT(*) as cnt FROM "${spec.table}"${whereSql}`).get(...params) as { cnt: number } | undefined
      return Number(row?.cnt ?? 0)
    },

    async create(args: { data: Record<string, unknown> }) {
      const now = Date.now()
      const record: Record<string, unknown> = {
        id: cuid(),
        ...spec.defaults,
        createdAt: now,
        ...(spec.hasUpdatedAt ? { updatedAt: now } : {}),
        ...args.data,
      }
      const cols = Object.keys(record)
      const placeholders = cols.map(() => '?').join(', ')
      const vals = cols.map((c) => toSqlVal(record[c]))
      sqlite
        .prepare(`INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`)
        .run(...vals)
      const row = sqlite.prepare(`SELECT * FROM "${spec.table}" WHERE "id" = ? LIMIT 1`).get(toSqlVal(record.id)) as Record<string, unknown> | undefined
      return hydrateRow(row, spec)
    },

    async update(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const patch: Record<string, unknown> = {
        ...args.data,
        ...(spec.hasUpdatedAt ? { updatedAt: Date.now() } : {}),
      }
      const cols = Object.keys(patch).filter((k) => patch[k] !== undefined)
      const setSql = cols.map((c) => `"${c}" = ?`).join(', ')
      const setVals = cols.map((c) => toSqlVal(patch[c]))
      const { sql: whereSql, params: whereVals } = buildWhere(args.where)
      sqlite.prepare(`UPDATE "${spec.table}" SET ${setSql}${whereSql}`).run(...setVals, ...whereVals)
      const row = sqlite.prepare(`SELECT * FROM "${spec.table}"${whereSql} LIMIT 1`).get(...whereVals) as Record<string, unknown> | undefined
      return hydrateRow(row, spec)
    },

    async upsert(args: {
      where: Record<string, unknown>
      create: Record<string, unknown>
      update: Record<string, unknown>
    }) {
      const existing = await this.findUnique({ where: args.where })
      if (existing) {
        return this.update({ where: args.where, data: args.update })
      }
      return this.create({ data: { ...args.where, ...args.create } })
    },

    async delete(args: { where: Record<string, unknown> }) {
      const existing = await this.findUnique({ where: args.where })
      const { sql: whereSql, params } = buildWhere(args.where)
      sqlite.prepare(`DELETE FROM "${spec.table}"${whereSql}`).run(...params)
      return existing
    },

    async deleteMany(args?: { where?: Record<string, unknown> }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const info = sqlite.prepare(`DELETE FROM "${spec.table}"${whereSql}`).run(...params)
      return { count: Number(info.changes ?? 0) }
    },
  }
}

function createSqliteClient() {
  const dbPath = resolveDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const sqlite = new DatabaseSync(dbPath)
  sqlite.exec('PRAGMA busy_timeout = 5000;')
  sqlite.exec('PRAGMA journal_mode = WAL;')

  // ── Migrations légères : ajoute les colonnes manquantes aux tables existantes
  // (les bases créées avant l'arrivée des comptes/blueprints n'ont pas userId).
  const addColumnIfMissing = (table: string, column: string, ddl: string) => {
    try {
      const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]
      if (!cols.some((c) => c.name === column)) {
        sqlite.exec(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`)
      }
    } catch {
      /* table pas encore créée : le CREATE TABLE ci-dessous la créera complète */
    }
  }
  sqlite.exec(`
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
      "color" TEXT NOT NULL DEFAULT '#a78bfa',
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
  `)

  // Colonnes ajoutées après coup (bases existantes) + index de cloisonnement
  for (const table of USER_SCOPED_TABLES) {
    addColumnIfMissing(table, 'userId', '"userId" TEXT')
    sqlite.exec(`CREATE INDEX IF NOT EXISTS "${table}_userId_idx" ON "${table}"("userId")`)
  }
  addColumnIfMissing('AgentProfile', 'blueprintId', '"blueprintId" TEXT')
  // Agent système (l'agent Dev) : `systemKey` vaut 'dev' — ni supprimable, ni visible
  // depuis un autre compte.
  addColumnIfMissing('AgentProfile', 'systemKey', '"systemKey" TEXT NOT NULL DEFAULT \'\'')
  // Rôle du compte : 'owner' (propriétaire), 'dev' (développeur), 'client'.
  addColumnIfMissing('User', 'role', '"role" TEXT NOT NULL DEFAULT \'client\'')
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")')
  addColumnIfMissing('SiteSetting', 'createdAt', '"createdAt" DATETIME')
  for (const t of ['DevPage', 'TrainingObjective', 'TrainingItem', 'TrainingRun', 'TrainingLesson']) {
    addColumnIfMissing(t, 'createdAt', '"createdAt" DATETIME')
  }
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS "SiteSetting_key_key" ON "SiteSetting"("key")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "DevPatch_userId_idx" ON "DevPatch"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "DevTask_userId_idx" ON "DevTask"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "DevPage_userId_idx" ON "DevPage"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "DevPage_url_idx" ON "DevPage"("url")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "TrainingObjective_userId_idx" ON "TrainingObjective"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "TrainingItem_userId_idx" ON "TrainingItem"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "TrainingRun_userId_idx" ON "TrainingRun"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "TrainingLesson_userId_idx" ON "TrainingLesson"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "ApiKeyLog_keyId_idx" ON "ApiKeyLog"("keyId")')
  sqlite.exec('CREATE INDEX IF NOT EXISTS "Blueprint_userId_idx" ON "Blueprint"("userId")')

  return {
    memory: createModelDelegate(sqlite, TABLES.memory),
    conversation: createModelDelegate(sqlite, TABLES.conversation),
    knowledge: createModelDelegate(sqlite, TABLES.knowledge),
    task: createModelDelegate(sqlite, TABLES.task),
    agentProfile: createModelDelegate(sqlite, TABLES.agentProfile),
    accountConnection: createModelDelegate(sqlite, TABLES.accountConnection),
    agentGroup: createModelDelegate(sqlite, TABLES.agentGroup),
    user: createModelDelegate(sqlite, TABLES.user),
    session: createModelDelegate(sqlite, TABLES.session),
    blueprint: createModelDelegate(sqlite, TABLES.blueprint),
    apiKey: createModelDelegate(sqlite, TABLES.apiKey),
    apiKeyLog: createModelDelegate(sqlite, TABLES.apiKeyLog),
    siteSetting: createModelDelegate(sqlite, TABLES.siteSetting),
    devPatch: createModelDelegate(sqlite, TABLES.devPatch),
    devTask: createModelDelegate(sqlite, TABLES.devTask),
    devPage: createModelDelegate(sqlite, TABLES.devPage),
    trainingObjective: createModelDelegate(sqlite, TABLES.trainingObjective),
    trainingItem: createModelDelegate(sqlite, TABLES.trainingItem),
    trainingRun: createModelDelegate(sqlite, TABLES.trainingRun),
    trainingLesson: createModelDelegate(sqlite, TABLES.trainingLesson),
  }
}

const globalForPrisma = globalThis as unknown as { prisma: any }

export const db = globalForPrisma.prisma ?? createSqliteClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
