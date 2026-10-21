import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { createClient, type Client, type InValue, type InStatement, type ResultSet } from '@libsql/client'
import {
  importSourcePath,
  localSource,
  resolveSource,
  tursoAutoImportEnabled,
  type DbMode,
  type DbSource,
} from '@/lib/db-source'

// ─── NEXUS — Couche de données (libSQL : fichier local OU Turso) ─────────────
// Même API que l'ancien client (findMany / findUnique / create / update /
// upsert / delete / deleteMany / count), désormais ASYNCHRONE : chaque appel
// passe par une connexion libSQL. La cible (SQLite locale ou base Turso) se
// règle par les variables TURSO_DATABASE_URL / TURSO_AUTH_TOKEN ou depuis
// l'espace Dev → Réglages. Les données sont migrables d'une cible à l'autre
// (copyDatabase), et une base Turso vide reçoit automatiquement la base locale.
//
// Avec Turso, deux connexions travaillent ensemble :
//   • une RÉPLIQUE LOCALE (fichier synchronisé depuis Turso) sert toutes les
//     lectures, sans aller-retour réseau — la vitesse d'une base locale ;
//   • un client DIRECT (HTTP) envoie les écritures à Turso, puis la réplique est
//     resynchronisée avant de rendre la main (on relit toujours ce qu'on vient
//     d'écrire). Passer les écritures par la réplique elle-même bloquerait le
//     serveur pendant chaque aller-retour (~3 par écriture, 20 lignes ≈ 1,7 s).
// Si la réplique ne peut pas s'ouvrir, tout passe par le client direct.

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
  /** Webhooks sortants de l'espace Dev : où NEXUS raconte ce qu'il fait. */
  devWebhook: {
    table: 'DevWebhook',
    dateCols: ['createdAt', 'updatedAt', 'lastDeliveryAt'],
    boolCols: ['enabled'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      name: 'Webhook',
      url: '',
      format: 'auto',
      events: '["*"]',
      secret: '',
      baseUrl: '',
      enabled: true,
      lastStatus: '',
      lastError: '',
      lastDeliveryAt: null,
    },
  },
  /** Journal des livraisons de webhooks (200 dernières par compte). */
  devWebhookLog: {
    table: 'DevWebhookLog',
    dateCols: ['createdAt'],
    boolCols: ['ok'],
    defaults: { userId: '', webhookId: '', event: '', ok: false, status: 0, ms: 0, error: '', preview: '' },
  },
  /** Demandes de confirmation (accepter / refuser) envoyées par webhook. */
  devApproval: {
    table: 'DevApproval',
    dateCols: ['createdAt', 'updatedAt', 'decidedAt', 'notifiedAt'],
    hasUpdatedAt: true,
    defaults: {
      userId: '',
      kind: 'patch',
      refId: '',
      title: '',
      summary: '',
      payload: '{}',
      status: 'pending',
      token: '',
      decidedBy: '',
      decidedAt: null,
      notifiedAt: null,
    },
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
  source: DbSource
  /** Client des lectures : fichier local, réplique locale de Turso, ou Turso direct. */
  client: Client | null
  /** Turso : client direct (HTTP) — écritures, schéma, copies. Null en local. */
  direct: Client | null
  /** Vrai quand `client` est une réplique locale de Turso. */
  replica: boolean
  /** Fichier de la réplique ouverte. */
  replicaFile: string
  /** Réplique en retard (synchro impossible) : lectures envoyées à Turso en attendant. */
  stale: boolean
  /** Synchro de la réplique demandée (partagée par les écritures du même tour). */
  pendingSync: Promise<void> | null
  /** Connexion prête (schéma vérifié, réplique synchronisée) ; null si l'ouverture a échoué. */
  ready: Promise<void> | null
  /** Remarque affichée dans l'espace Dev (repli, import automatique…). */
  note: string
  closed: boolean
}

const g = globalThis as unknown as { __nexusDbConn?: Conn }

/** Synchro périodique de la réplique (secondes), pour les écritures faites ailleurs. */
const REPLICA_SYNC_SEC = 60

function makeConn(source: DbSource): Conn {
  return {
    source,
    client: null,
    direct: null,
    replica: false,
    replicaFile: '',
    stale: false,
    pendingSync: null,
    ready: null,
    note: '',
    closed: false,
  }
}

function getConn(): Conn {
  if (!g.__nexusDbConn) g.__nexusDbConn = makeConn(resolveSource())
  return g.__nexusDbConn
}

function closeQuietly(c: Client | null | undefined): void {
  try {
    c?.close()
  } catch {
    /* déjà fermé */
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Client direct vers Turso (HTTP), sans réplique. */
function directClient(source: DbSource): Client {
  return createClient({ url: source.url, authToken: source.authToken })
}

/** Fichiers d'une réplique (base + métadonnées libSQL). */
function removeReplicaFiles(file: string): void {
  const dir = path.dirname(file)
  const base = path.basename(file)
  try {
    for (const name of fs.readdirSync(dir)) {
      if (name === base || name.startsWith(`${base}-`)) fs.rmSync(path.join(dir, name), { force: true })
    }
  } catch {
    /* dossier absent : rien à nettoyer */
  }
}

/** Chemin libre pour une nouvelle réplique (deux connexions ne partagent jamais un fichier). */
function freeReplicaFile(wanted: string): string {
  const current = g.__nexusDbConn
  if (!current || current.closed || current.replicaFile !== wanted) return wanted
  return wanted.replace(/(\.db)?$/, `-${Date.now().toString(36)}.db`)
}

/**
 * Ouvre la réplique locale et la synchronise une première fois (bloquant, une
 * seule fois par démarrage : quelques centaines de ms pour quelques Mo). Une
 * réplique restée d'une autre base au même chemin est effacée puis recréée.
 */
async function openReplica(source: DbSource): Promise<{ client: Client; file: string }> {
  const file = freeReplicaFile(source.replicaPath ?? '')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const open = async (): Promise<Client> => {
    const c = createClient({
      url: `file:${file}`,
      syncUrl: source.url,
      authToken: source.authToken,
      syncInterval: REPLICA_SYNC_SEC,
    })
    try {
      await c.sync()
      return c
    } catch (err) {
      closeQuietly(c)
      throw err
    }
  }
  try {
    return { client: await open(), file }
  } catch {
    removeReplicaFiles(file)
    return { client: await open(), file }
  }
}

/** Ouvre la connexion : fichier local, ou Turso (schéma, import automatique, réplique). */
async function openConn(conn: Conn, opts: { autoImport: boolean }): Promise<void> {
  const { source } = conn
  if (source.mode === 'local') {
    const local = createClient({ url: `file:${source.url}` })
    try {
      await initSchema(local, 'local')
    } catch (err) {
      closeQuietly(local)
      throw err
    }
    conn.client = local
    return
  }

  const direct = directClient(source)
  try {
    await initSchema(direct, 'turso')
  } catch (err) {
    closeQuietly(direct)
    const hint =
      source.origin === 'env'
        ? 'vérifiez TURSO_DATABASE_URL et TURSO_AUTH_TOKEN (base libSQL)'
        : 'vérifiez l’adresse et le jeton dans Dev → Réglages'
    throw new Error(`Turso injoignable ou refusé (${errorText(err)}) — ${hint}`)
  }
  if (opts.autoImport) {
    // Un import interrompu bloque la connexion : il reprend à la requête suivante,
    // avant toute écriture de l'application (rien ne peut être écrasé).
    try {
      const imported = await importIntoEmptyTurso(direct)
      if (imported) conn.note = imported
    } catch (err) {
      closeQuietly(direct)
      throw new Error(`import de la base locale dans Turso interrompu (${errorText(err)}) — reprise à la prochaine requête`)
    }
  }
  conn.direct = direct
  conn.client = direct
  if (!source.replicaPath) return
  try {
    const t0 = Date.now()
    const { client: replica, file } = await openReplica(source)
    if (conn.closed) {
      closeQuietly(replica)
      return
    }
    conn.client = replica
    conn.replica = true
    conn.replicaFile = file
    console.log(`[nexus] base Turso : réplique locale synchronisée en ${Date.now() - t0} ms (lectures sur place)`)
  } catch (err) {
    conn.note = `réplique locale indisponible (${errorText(err)}) : chaque requête va jusqu'à Turso`
    console.warn(`[nexus] base Turso : ${conn.note}`)
  }
}

function closeConn(conn: Conn): void {
  conn.closed = true
  if (conn.client && conn.client !== conn.direct) closeQuietly(conn.client)
  closeQuietly(conn.direct)
  // Réplique abandonnée (bascule depuis l'espace Dev) : le fichier ne servira plus.
  if (conn.replicaFile && conn.replicaFile !== g.__nexusDbConn?.replicaFile) removeReplicaFiles(conn.replicaFile)
}

/** Connexion courante, ouverte au premier usage (et rouverte si l'ouverture a échoué). */
async function readyConn(): Promise<Conn> {
  const conn = getConn()
  if (!conn.ready) {
    const autoImport = conn.source.origin === 'env' && tursoAutoImportEnabled()
    const ready: Promise<void> = openConn(conn, { autoImport }).catch((err: unknown) => {
      if (conn.ready === ready) conn.ready = null
      throw err
    })
    conn.ready = ready
  }
  await conn.ready
  return conn
}

/**
 * Resynchronise la réplique après une écriture faite sur Turso. Les écritures
 * terminées dans le même tour de boucle partagent une seule synchro.
 */
function syncReplica(conn: Conn): Promise<void> {
  if (!conn.pendingSync) {
    conn.pendingSync = new Promise<void>((resolve) => {
      setImmediate(() => {
        // Une écriture qui se termine après ce point demandera sa propre synchro.
        conn.pendingSync = null
        void syncNow(conn).then(resolve)
      })
    })
  }
  return conn.pendingSync
}

async function syncNow(conn: Conn): Promise<void> {
  if (conn.closed || !conn.replica || !conn.client) return
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await conn.client.sync()
      if (conn.stale) {
        conn.stale = false
        console.log('[nexus] réplique Turso de nouveau à jour : lectures locales rétablies')
      }
      return
    } catch (err) {
      if (attempt === 0) continue
      if (!conn.stale) {
        console.warn(`[nexus] synchro de la réplique Turso impossible (${errorText(err)}) : lectures directes en attendant`)
      }
      conn.stale = true
      const retry = setTimeout(() => void syncNow(conn), 10_000)
      retry.unref?.()
    }
  }
}

const READ_SQL = /^\s*(SELECT|PRAGMA|EXPLAIN)\b/i

/** Colonnes ajoutées après coup (bases existantes) : [table, colonne, définition]. */
const LATE_COLUMNS: [string, string, string][] = [
  ...USER_SCOPED_TABLES.map((t): [string, string, string] => [t, 'userId', '"userId" TEXT']),
  ['AgentProfile', 'blueprintId', '"blueprintId" TEXT'],
  // Agent système (l'agent Dev) : `systemKey` vaut 'dev' — ni supprimable, ni visible
  // depuis un autre compte.
  ['AgentProfile', 'systemKey', '"systemKey" TEXT NOT NULL DEFAULT \'\''],
  // Rôle du compte : 'owner' (propriétaire), 'dev' (développeur), 'client'.
  ['User', 'role', '"role" TEXT NOT NULL DEFAULT \'client\''],
  ['SiteSetting', 'createdAt', '"createdAt" DATETIME'],
  ...['DevPage', 'TrainingObjective', 'TrainingItem', 'TrainingRun', 'TrainingLesson'].map(
    (t): [string, string, string] => [t, 'createdAt', '"createdAt" DATETIME']
  ),
]

/** Tables créées par BASE_DDL. */
function schemaTables(): string[] {
  return [...BASE_DDL.matchAll(/CREATE TABLE IF NOT EXISTS "(\w+)"/g)].map((m) => m[1])
}

/** Index créés à la fin de initSchema. */
function indexStatements(): string[] {
  return [
    ...USER_SCOPED_TABLES.map((t) => `CREATE INDEX IF NOT EXISTS "${t}_userId_idx" ON "${t}"("userId")`),
    'CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email")',
    ...INDEX_SQL,
  ]
}

/**
 * Le schéma est-il déjà complet (tables, colonnes tardives, index) ? Un seul
 * aller-retour en lecture : une base Turso déjà prête démarre sans aucun DDL.
 */
async function schemaComplete(client: Client): Promise<boolean> {
  const lateTables = [...new Set(LATE_COLUMNS.map(([t]) => t))]
  try {
    const [objects, columns] = await client.batch(
      [
        "SELECT type, name FROM sqlite_master WHERE type IN ('table', 'index')",
        {
          sql: `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (${lateTables.map(() => '?').join(', ')})`,
          args: lateTables,
        },
      ],
      'read'
    )
    const have = new Set(rowsOf(objects).map((r) => `${String(r.type)}:${String(r.name)}`))
    if (!schemaTables().every((t) => have.has(`table:${t}`))) return false
    const indexNames = indexStatements().map((sql) => /EXISTS "(\w+)"/.exec(sql)?.[1] ?? '')
    if (!indexNames.every((name) => have.has(`index:${name}`))) return false
    const cols = new Set(rowsOf(columns).map((r) => `${String(r.tbl)}.${String(r.col)}`))
    return LATE_COLUMNS.every(([table, column]) => cols.has(`${table}.${column}`))
  } catch {
    return false // moteur sans pragma_table_info : on applique simplement le DDL
  }
}

/**
 * Schéma + migrations légères. Idempotent : sûr à relancer à chaque démarrage.
 *
 * Une base déjà à jour ne coûte qu'une lecture (schemaComplete). Sinon tout passe
 * en QUATRE allers-retours au plus (au lieu d'environ 80 requêtes séquentielles) :
 * le DDL de base, la lecture groupée des colonnes existantes (`pragma_table_info`),
 * les éventuels ALTER manquants, puis les index. Avec une base distante (Turso),
 * chaque requête coûte un aller-retour réseau.
 */
async function initSchema(client: Client, mode: DbMode): Promise<void> {
  if (mode === 'local') {
    await client.execute('PRAGMA busy_timeout = 5000')
    await client.execute('PRAGMA journal_mode = WAL')
  }
  if (await schemaComplete(client)) return
  await client.executeMultiple(BASE_DDL)

  // Colonnes existantes de toutes les tables concernées, en une seule requête.
  const tables = [...new Set(LATE_COLUMNS.map(([t]) => t))]
  const existing = new Set<string>()
  try {
    const res = await client.execute({
      sql: `SELECT m.name AS tbl, p.name AS col FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (${tables.map(() => '?').join(', ')})`,
      args: tables,
    })
    for (const r of rowsOf(res)) existing.add(`${String(r.tbl)}.${String(r.col)}`)
  } catch {
    // Moteur sans fonctions table (très ancien) : lecture table par table.
    for (const t of tables) {
      try {
        const res = await client.execute(`PRAGMA table_info("${t}")`)
        for (const r of rowsOf(res)) existing.add(`${t}.${String(r.name)}`)
      } catch {
        /* table absente : le CREATE TABLE ci-dessus la crée complète */
      }
    }
  }
  for (const [table, column, ddl] of LATE_COLUMNS) {
    if (existing.has(`${table}.${column}`)) continue
    try {
      await client.execute(`ALTER TABLE "${table}" ADD COLUMN ${ddl}`)
      existing.add(`${table}.${column}`)
    } catch {
      /* colonne ajoutée entre-temps par un autre processus */
    }
  }

  // Index (tous idempotents) : un seul envoi.
  await client.executeMultiple(indexStatements().join(';\n') + ';')
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

/** Client des lectures de la connexion courante, prête (schéma créé) avant toute requête. */
async function client(): Promise<Client> {
  const conn = await readyConn()
  return conn.stale && conn.direct ? conn.direct : (conn.client as Client)
}

/**
 * Exécute une requête. Avec une réplique Turso : lecture sur place, écriture
 * envoyée à Turso puis réplique resynchronisée (relecture immédiate garantie).
 */
async function run(sql: string, args: InValue[] = []): Promise<ResultSet> {
  const conn = await readyConn()
  const stmt: InStatement = { sql, args }
  if (!conn.replica || !conn.direct) return (conn.client as Client).execute(stmt)
  if (READ_SQL.test(sql)) return (conn.stale ? conn.direct : (conn.client as Client)).execute(stmt)
  const res = await conn.direct.execute(stmt)
  await syncReplica(conn)
  return res
}

/** Réplique Turso active et à jour : une lecture ne coûte rien. */
function localReads(): boolean {
  const conn = g.__nexusDbConn
  return Boolean(conn && conn.replica && !conn.stale && !conn.closed)
}

// ── Délégués de modèles (API identique à l'ancien client) ───────────────────

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

// ── Écoute des écritures (caches applicatifs : sessions, nombre de comptes…) ─

type WriteListener = (table: string) => void
const writeListeners = new Set<WriteListener>()

/**
 * Prévient `listener` après chaque écriture passée par les délégués (create,
 * update, upsert, delete, deleteMany), avec le nom de la table touchée. Sert à
 * invalider les petits caches en mémoire dès qu'une donnée change.
 */
export function onTableWrite(listener: WriteListener): () => void {
  writeListeners.add(listener)
  return () => writeListeners.delete(listener)
}

function notifyWrite(table: string): void {
  for (const listener of writeListeners) {
    try {
      listener(table)
    } catch {
      /* un cache défaillant ne doit jamais faire échouer une écriture */
    }
  }
}

/**
 * Colonnes à lire. Avec `select`, seules les colonnes demandées quittent la
 * base : lister les conversations ne télécharge plus le contenu complet de
 * chacune, et vérifier le modèle de langue actif ne relit plus ses poids
 * (plusieurs centaines de Ko) à chaque message.
 */
function columnsSql(select?: Record<string, boolean>): string {
  if (!select) return '*'
  const cols = Object.keys(select).filter((k) => select[k])
  if (cols.length === 0 || !cols.every((c) => IDENT.test(c))) return '*'
  return cols.map((c) => `"${c}"`).join(', ')
}

/** SELECT projeté, avec repli sur `*` si une colonne demandée n'existe pas (base ancienne). */
async function selectRows(spec: TableSpec, select: Record<string, boolean> | undefined, tail: string, params: InValue[]): Promise<Row[]> {
  const cols = columnsSql(select)
  try {
    return rowsOf(await run(`SELECT ${cols} FROM "${spec.table}"${tail}`, params))
  } catch (err) {
    if (cols === '*' || !/no such column/i.test(err instanceof Error ? err.message : String(err))) throw err
    return rowsOf(await run(`SELECT * FROM "${spec.table}"${tail}`, params))
  }
}

/**
 * `INSERT/UPDATE/DELETE … RETURNING *` : la ligne écrite revient dans la même
 * requête (un aller-retour au lieu de deux). Repli automatique sur l'ancienne
 * méthode (écriture puis relecture) si le moteur ne connaît pas RETURNING.
 */
let returningSupported = true

function returningUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /RETURNING/i.test(msg) && /syntax|near/i.test(msg)
}

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
      const rows = await selectRows(spec, args?.select, `${whereSql}${orderSql}${limitSql}`, params)
      return rows.map((r) => hydrateRow(r, spec, args?.select))
    },

    async findUnique(args: { where: Row; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args.where)
      const rows = await selectRows(spec, args.select, `${whereSql} LIMIT 1`, params)
      return hydrateRow(rows[0], spec, args.select)
    },

    async findFirst(args?: { where?: Row; orderBy?: unknown; select?: Record<string, boolean> }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      const orderSql = buildOrderBy(args?.orderBy)
      const rows = await selectRows(spec, args?.select, `${whereSql}${orderSql} LIMIT 1`, params)
      return hydrateRow(rows[0], spec, args?.select)
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
      const insert = `INSERT INTO "${spec.table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`
      try {
        if (returningSupported) {
          try {
            const res = await run(`${insert} RETURNING *`, vals)
            return hydrateRow(rowsOf(res)[0], spec)
          } catch (err) {
            if (!returningUnsupported(err)) throw err
            returningSupported = false
          }
        }
        await run(insert, vals)
        const res = await run(`SELECT * FROM "${spec.table}" WHERE "id" = ? LIMIT 1`, [toSqlVal(record.id)])
        return hydrateRow(rowsOf(res)[0], spec)
      } finally {
        notifyWrite(spec.table)
      }
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
      const update = `UPDATE "${spec.table}" SET ${setSql}${whereSql}`
      let changed = true
      try {
        if (returningSupported) {
          try {
            const res = await run(`${update} RETURNING *`, [...setVals, ...whereVals])
            changed = res.rows.length > 0
            return hydrateRow(rowsOf(res)[0], spec)
          } catch (err) {
            if (!returningUnsupported(err)) throw err
            returningSupported = false
          }
        }
        await run(update, [...setVals, ...whereVals])
        const res = await run(`SELECT * FROM "${spec.table}"${whereSql} LIMIT 1`, whereVals)
        return hydrateRow(rowsOf(res)[0], spec)
      } finally {
        if (changed) notifyWrite(spec.table)
      }
    },

    async upsert(args: { where: Row; create: Row; update: Row }) {
      const { sql: whereSql, params } = buildWhere(args.where)
      const found = await run(`SELECT 1 FROM "${spec.table}"${whereSql} LIMIT 1`, params)
      if (found.rows.length > 0) {
        return this.update({ where: args.where, data: args.update })
      }
      return this.create({ data: { ...args.where, ...args.create } })
    },

    async delete(args: { where: Row }) {
      const { sql: whereSql, params } = buildWhere(args.where)
      let changed = true
      try {
        if (returningSupported) {
          try {
            const res = await run(`DELETE FROM "${spec.table}"${whereSql} RETURNING *`, params)
            changed = res.rows.length > 0
            return hydrateRow(rowsOf(res)[0], spec)
          } catch (err) {
            if (!returningUnsupported(err)) throw err
            returningSupported = false
          }
        }
        const existing = await this.findUnique({ where: args.where })
        await run(`DELETE FROM "${spec.table}"${whereSql}`, params)
        return existing
      } finally {
        if (changed) notifyWrite(spec.table)
      }
    },

    async deleteMany(args?: { where?: Row }) {
      const { sql: whereSql, params } = buildWhere(args?.where)
      // Réplique Turso : vérifier sur place qu'il y a quelque chose à supprimer
      // évite un aller-retour (la purge des sessions tourne chaque minute).
      if (localReads()) {
        const any = await run(`SELECT 1 FROM "${spec.table}"${whereSql} LIMIT 1`, params)
        if (any.rows.length === 0) return { count: 0 }
      }
      let changed = true
      try {
        const res = await run(`DELETE FROM "${spec.table}"${whereSql}`, params)
        const count = Number(res.rowsAffected ?? 0)
        changed = count > 0
        return { count }
      } finally {
        // (la purge des sessions expirées, chaque minute, ne vide plus les caches pour rien)
        if (changed) notifyWrite(spec.table)
      }
    },
  }
}

// ── Outils de migration & de diagnostic (utilisés par l'espace Dev) ─────────

/** Liste des tables utilisateur d'une base. */
export async function listTables(c: Client): Promise<string[]> {
  const res = await c.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' ORDER BY name"
  )
  return rowsOf(res).map((r) => String(r.name))
}

/** Lots d'insertion : 200 lignes ou ~1 Mo au plus par aller-retour. */
const COPY_BATCH_ROWS = 200
const COPY_BATCH_BYTES = 1_000_000

function approxSize(v: unknown): number {
  if (v === null || v === undefined) return 1
  if (typeof v === 'string') return v.length
  if (v instanceof ArrayBuffer) return v.byteLength
  if (ArrayBuffer.isView(v)) return v.byteLength
  return 8
}

/**
 * Copie intégrale d'une base vers une autre (local → Turso ou Turso → local).
 * Le schéma de la cible est créé d'abord (les tables inconnues de NEXUS sont
 * recréées telles quelles), puis les lignes sont recopiées par lots, chaque lot
 * en une transaction (INSERT OR REPLACE : relancer la copie est sans risque).
 * Seules les colonnes communes aux deux bases sont copiées (bases d'âges différents).
 */
export async function copyDatabase(from: Client, to: Client): Promise<{ tables: number; rows: number }> {
  await initSchema(to, 'turso')
  const sourceTables = rowsOf(
    await from.execute(
      "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' ORDER BY name"
    )
  )
  const targetTables = new Set(await listTables(to))
  let rows = 0
  for (const t of sourceTables) {
    const table = String(t.name)
    if (!targetTables.has(table) && t.sql) {
      await to.execute(String(t.sql).replace(/^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS '))
    }
    const src = await from.execute(`SELECT * FROM "${table}"`)
    if (src.rows.length === 0) continue
    const targetCols = new Set(rowsOf(await to.execute(`PRAGMA table_info("${table}")`)).map((r) => String(r.name)))
    const cols = src.columns.map((c, idx) => ({ c, idx })).filter(({ c }) => targetCols.has(c))
    if (cols.length === 0) continue
    const sql = `INSERT OR REPLACE INTO "${table}" (${cols.map(({ c }) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
    let batch: InStatement[] = []
    let bytes = 0
    const flush = async () => {
      if (batch.length === 0) return
      await to.batch(batch, 'write')
      batch = []
      bytes = 0
    }
    for (const r of src.rows) {
      const args = cols.map(({ idx }) => (r[idx] as InValue) ?? null)
      const size = args.reduce<number>((n, v) => n + approxSize(v), 0)
      if (batch.length > 0 && (batch.length >= COPY_BATCH_ROWS || bytes + size > COPY_BATCH_BYTES)) await flush()
      batch.push({ sql, args })
      bytes += size
    }
    await flush()
    rows += src.rows.length
  }
  return { tables: sourceTables.length, rows }
}

/** Marqueur de l'import automatique dans SiteSetting (« pending » puis « done:… »). */
const IMPORT_KEY = 'nexus.turso.import'

async function writeImportMarker(direct: Client, value: string): Promise<void> {
  const now = Date.now()
  await direct.execute({
    sql: 'INSERT INTO "SiteSetting" ("id", "key", "value", "updatedBy", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT("id") DO UPDATE SET "value" = excluded."value", "updatedAt" = excluded."updatedAt"',
    args: ['nexus-turso-import', IMPORT_KEY, value, 'nexus', now, now],
  })
}

/**
 * Première connexion à une base Turso VIDE (configurée par variables
 * d'environnement) : la base locale y est recopiée — celle de DATABASE_URL si le
 * fichier existe, sinon la base livrée avec le dépôt — pour retrouver comptes,
 * savoir, agents et entraînement. Une base qui contient déjà des données n'est
 * jamais touchée ; un import interrompu reprend au démarrage suivant.
 * Renvoie une remarque pour l'espace Dev (ou null s'il n'y avait rien à faire).
 */
async function importIntoEmptyTurso(direct: Client): Promise<string | null> {
  const marker = rowsOf(
    await direct.execute({ sql: 'SELECT "value" FROM "SiteSetting" WHERE "key" = ? LIMIT 1', args: [IMPORT_KEY] })
  )[0]
  const state = marker ? String(marker.value) : ''
  // Seul un import resté « pending » est repris ; toute autre valeur vaut « déjà fait ».
  if (state && state !== 'pending') return null
  if (!state) {
    const counts = await direct.batch(
      schemaTables().map((t) => `SELECT COUNT(*) AS n FROM "${t}"`),
      'read'
    )
    if (counts.some((rs) => Number(rowsOf(rs)[0]?.n ?? 0) > 0)) return null
  }
  const file = importSourcePath()
  if (!file) return null
  const t0 = Date.now()
  await writeImportMarker(direct, 'pending')
  const local = createClient({ url: `file:${file}` })
  try {
    const copied = await copyDatabase(local, direct)
    await writeImportMarker(direct, `done:${new Date().toISOString()}:${copied.rows}`)
    const note = `base Turso vide : ${copied.rows} ligne(s) de ${copied.tables} table(s) importée(s) depuis ${path.basename(file)} en ${Date.now() - t0} ms`
    console.log(`[nexus] ${note}`)
    return note
  } finally {
    closeQuietly(local)
  }
}

/** Nombre de lignes par table + latences (pour l'état de la base dans le dashboard). */
export async function databaseStats(): Promise<{
  latencyMs: number
  remoteLatencyMs: number | null
  tables: { name: string; rows: number }[]
  totalRows: number
}> {
  const conn = await readyConn()
  const c = await client()
  let t0 = performance.now()
  await c.execute('SELECT 1')
  const latencyMs = Math.round((performance.now() - t0) * 10) / 10
  let remoteLatencyMs: number | null = null
  if (conn.direct && conn.direct !== c) {
    t0 = performance.now()
    try {
      await conn.direct.execute('SELECT 1')
      remoteLatencyMs = Math.round(performance.now() - t0)
    } catch {
      remoteLatencyMs = null
    }
  }
  const names = await listTables(c)
  const countSql = names.map((name) => `SELECT COUNT(*) AS cnt FROM "${name}"`)
  // Réplique : lectures une à une, sur place (une transaction ouverte sur la
  // réplique partirait chez Turso). Accès direct : un seul aller-retour.
  const counts: ResultSet[] = []
  if (c === conn.direct && countSql.length > 0) counts.push(...(await c.batch(countSql, 'read')))
  else for (const sql of countSql) counts.push(await c.execute(sql))
  const tables = names.map((name, i) => ({ name, rows: Number(rowsOf(counts[i])[0]?.cnt ?? 0) }))
  const totalRows = tables.reduce((n, t) => n + t.rows, 0)
  return { latencyMs, remoteLatencyMs, tables, totalRows }
}

/** Connexion courante : mode, hôte (sans jeton), réplique et remarques. */
export function currentDatabase(): {
  mode: DbMode
  origin: DbSource['origin']
  target: string
  replica: boolean
  stale: boolean
  note: string
} {
  const conn = getConn()
  const { source } = conn
  let target = source.url
  if (source.mode === 'turso') {
    try {
      target = new URL(source.url).host
    } catch {
      target = source.url
    }
  }
  return { mode: source.mode, origin: source.origin, target, replica: conn.replica, stale: conn.stale, note: conn.note }
}

/** Client de la base courante (pour copier vers l'autre cible). */
export async function currentClient(): Promise<Client> {
  return client()
}

/**
 * Bascule la connexion vers une autre cible. La nouvelle connexion est ouverte
 * et testée (schéma créé, réplique synchronisée) AVANT le basculement : en cas
 * d'échec, l'ancienne reste active.
 */
export async function switchDatabase(source: DbSource): Promise<void> {
  const next = makeConn(source)
  try {
    await (next.ready = openConn(next, { autoImport: false }))
  } catch (err) {
    closeConn(next)
    throw err
  }
  const prev = g.__nexusDbConn
  g.__nexusDbConn = next
  if (prev && prev !== next) closeConn(prev)
}

/** Ouvre une cible sans basculer (test de connexion, copie) — accès direct, sans réplique. */
export async function openTarget(source: DbSource): Promise<Client> {
  const c = source.mode === 'local' ? createClient({ url: `file:${source.url}` }) : directClient(source)
  try {
    await initSchema(c, source.mode)
    return c
  } catch (err) {
    closeQuietly(c)
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
    CREATE TABLE IF NOT EXISTS "DevWebhook" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "name" TEXT NOT NULL DEFAULT 'Webhook',
      "url" TEXT NOT NULL DEFAULT '',
      "format" TEXT NOT NULL DEFAULT 'auto',
      "events" TEXT NOT NULL DEFAULT '["*"]',
      "secret" TEXT NOT NULL DEFAULT '',
      "baseUrl" TEXT NOT NULL DEFAULT '',
      "enabled" BOOLEAN NOT NULL DEFAULT true,
      "lastStatus" TEXT NOT NULL DEFAULT '',
      "lastError" TEXT NOT NULL DEFAULT '',
      "lastDeliveryAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "DevWebhookLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "webhookId" TEXT NOT NULL DEFAULT '',
      "event" TEXT NOT NULL DEFAULT '',
      "ok" BOOLEAN NOT NULL DEFAULT false,
      "status" INTEGER NOT NULL DEFAULT 0,
      "ms" INTEGER NOT NULL DEFAULT 0,
      "error" TEXT NOT NULL DEFAULT '',
      "preview" TEXT NOT NULL DEFAULT '',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS "DevApproval" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL DEFAULT '',
      "kind" TEXT NOT NULL DEFAULT 'patch',
      "refId" TEXT NOT NULL DEFAULT '',
      "title" TEXT NOT NULL DEFAULT '',
      "summary" TEXT NOT NULL DEFAULT '',
      "payload" TEXT NOT NULL DEFAULT '{}',
      "status" TEXT NOT NULL DEFAULT 'pending',
      "token" TEXT NOT NULL DEFAULT '',
      "decidedBy" TEXT NOT NULL DEFAULT '',
      "decidedAt" DATETIME,
      "notifiedAt" DATETIME,
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
    devWebhook: createModelDelegate(TABLES.devWebhook),
    devWebhookLog: createModelDelegate(TABLES.devWebhookLog),
    devApproval: createModelDelegate(TABLES.devApproval),
    blueprintSchedule: createModelDelegate(TABLES.blueprintSchedule),
  }
}

/**
 * Client « db » : délégués asynchrones. Typé `any` pour conserver la souplesse
 * de l'ancien client (les lignes sont des objets dynamiques).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db: any = buildDb()
