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
}

function cuid(): string {
  return `c${Date.now().toString(36)}${crypto.randomBytes(6).toString('hex')}`
}

function resolveDbPath(): string {
  const defaultPath = path.join(process.cwd(), 'db', 'custom.db')
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw || raw.includes('/home/z/my-project')) return defaultPath
  if (raw.startsWith('file:')) {
    const rel = raw.slice(5)
    if (path.isAbsolute(rel)) return fs.existsSync(rel) ? rel : defaultPath
    const fromPrisma = path.resolve(process.cwd(), 'prisma', rel)
    if (fs.existsSync(fromPrisma)) return fromPrisma
    return path.resolve(process.cwd(), rel)
  }
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
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
  `)
  return {
    memory: createModelDelegate(sqlite, TABLES.memory),
    conversation: createModelDelegate(sqlite, TABLES.conversation),
    knowledge: createModelDelegate(sqlite, TABLES.knowledge),
    task: createModelDelegate(sqlite, TABLES.task),
    agentProfile: createModelDelegate(sqlite, TABLES.agentProfile),
    accountConnection: createModelDelegate(sqlite, TABLES.accountConnection),
    agentGroup: createModelDelegate(sqlite, TABLES.agentGroup),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalForPrisma = globalThis as unknown as { prisma: any }

export const db = globalForPrisma.prisma ?? createSqliteClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
