// ─── NEXUS — Source de la base de données (SQLite locale ou Turso) ───────────
// NEXUS stocke tout dans une base libSQL. Deux cibles possibles :
//   • « local »  : fichier SQLite (db/custom.db, ou DATABASE_URL en chemin absolu)
//   • « turso »  : base hébergée sur Turso (libsql://…turso.io + jeton)
//
// Priorité de résolution (la première trouvée gagne) :
//   1. la configuration enregistrée depuis l'espace Dev (onglet « Réglages »),
//      stockée dans <dossier de la base>/nexus-db.json — jeton chiffré AES-256-GCM ;
//   2. les variables d'environnement TURSO_DATABASE_URL + TURSO_AUTH_TOKEN ;
//   3. la base locale.
//
// Ce module ne touche jamais à la base : il décrit seulement la cible. Il est
// séparé de db.ts pour éviter les imports circulaires.

import fs from 'fs'
import path from 'path'
import { encryptSecret, decryptSecret } from '@/lib/security'

export type DbMode = 'local' | 'turso'

export interface DbSource {
  mode: DbMode
  /** URL libSQL (pour « local » : chemin du fichier). */
  url: string
  authToken: string
  /** D'où vient la configuration (affiché dans le dashboard). */
  origin: 'dashboard' | 'env' | 'default'
}

interface SavedConfig {
  version: 1
  mode: DbMode
  tursoUrl?: string
  /** Jeton chiffré (préfixe enc:v1:) — jamais en clair sur le disque. */
  tursoToken?: string
  savedAt: string
}

/** Chemin du fichier SQLite local (même logique qu'avant : DATABASE_URL, puis db/custom.db). */
export function localDbPath(): string {
  const defaultPath = path.join(process.cwd(), 'db', 'custom.db')
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw || raw.includes('/home/z/my-project')) {
    // En standalone Next (.next/standalone), le dossier courant est recréé à
    // chaque build → on préfère la base persistante du projet racine.
    if (process.cwd().includes(`${path.sep}.next${path.sep}standalone`)) {
      const rootDb = path.resolve(process.cwd(), '..', '..', 'db', 'custom.db')
      try {
        if (fs.existsSync(rootDb)) return rootDb
      } catch {
        /* FS indisponible : on retombe sur le dossier courant. */
      }
    }
    return defaultPath
  }
  if (raw.startsWith('file:')) {
    const rel = raw.slice(5)
    if (path.isAbsolute(rel)) return rel
    const fromPrisma = path.resolve(process.cwd(), 'prisma', rel)
    if (fs.existsSync(fromPrisma)) return fromPrisma
    return path.resolve(process.cwd(), rel)
  }
  if (path.isAbsolute(raw)) return raw
  return defaultPath
}

/** Dossier où vivent la base locale et le fichier de configuration. */
export function dataDir(): string {
  return path.dirname(localDbPath())
}

export function configFilePath(): string {
  return path.join(dataDir(), 'nexus-db.json')
}

function readSaved(): SavedConfig | null {
  try {
    const file = configFilePath()
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as SavedConfig
    if (!parsed || (parsed.mode !== 'local' && parsed.mode !== 'turso')) return null
    return parsed
  } catch {
    return null
  }
}

/** Source effective (sans ouvrir de connexion). */
export function resolveSource(): DbSource {
  const saved = readSaved()
  if (saved) {
    if (saved.mode === 'local') {
      return { mode: 'local', url: localDbPath(), authToken: '', origin: 'dashboard' }
    }
    const token = saved.tursoToken ? decryptSecret(saved.tursoToken) : ''
    if (saved.tursoUrl && token) {
      return { mode: 'turso', url: normalizeTursoUrl(saved.tursoUrl), authToken: token, origin: 'dashboard' }
    }
  }
  const envUrl = process.env.TURSO_DATABASE_URL?.trim()
  const envToken = process.env.TURSO_AUTH_TOKEN?.trim()
  if (envUrl && envToken) {
    return { mode: 'turso', url: normalizeTursoUrl(envUrl), authToken: envToken, origin: 'env' }
  }
  return { mode: 'local', url: localDbPath(), authToken: '', origin: 'default' }
}

/** Réglages Turso lisibles par le dashboard (le jeton n'est jamais renvoyé). */
export function describeSource(): {
  mode: DbMode
  origin: DbSource['origin']
  tursoUrl: string
  tokenSet: boolean
  localPath: string
  savedAt: string | null
  envTurso: boolean
} {
  const src = resolveSource()
  const saved = readSaved()
  return {
    mode: src.mode,
    origin: src.origin,
    tursoUrl: saved?.tursoUrl ?? (process.env.TURSO_DATABASE_URL?.trim() || ''),
    tokenSet: Boolean(saved?.tursoToken) || Boolean(process.env.TURSO_AUTH_TOKEN?.trim()),
    localPath: localDbPath(),
    savedAt: saved?.savedAt ?? null,
    envTurso: Boolean(process.env.TURSO_DATABASE_URL?.trim() && process.env.TURSO_AUTH_TOKEN?.trim()),
  }
}

/** Accepte « libsql://… », « https://… » ou la forme « xxx.turso.io » nue. */
export function normalizeTursoUrl(raw: string): string {
  let url = raw.trim()
  if (!url) return ''
  if (!/^[a-z]+:\/\//i.test(url)) url = `libsql://${url}`
  if (url.startsWith('libsql://') || url.startsWith('https://') || url.startsWith('http://')) return url.replace(/\/+$/, '')
  return url
}

export function isValidTursoUrl(url: string): boolean {
  return /^(libsql|https?):\/\/[^\s/]+/i.test(url)
}

/** Enregistre la configuration Turso (jeton chiffré). Mode cible : turso ou local. */
export function saveDbConfig(input: { mode: DbMode; tursoUrl?: string; tursoToken?: string }): void {
  const file = configFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const previous = readSaved()
  const url = input.tursoUrl ? normalizeTursoUrl(input.tursoUrl) : previous?.tursoUrl
  const tokenPlain = input.tursoToken?.trim()
  const tokenEnc = tokenPlain ? encryptSecret(tokenPlain) : previous?.tursoToken
  const body: SavedConfig = {
    version: 1,
    mode: input.mode,
    ...(url ? { tursoUrl: url } : {}),
    ...(tokenEnc ? { tursoToken: tokenEnc } : {}),
    savedAt: new Date().toISOString(),
  }
  fs.writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600 })
}

/** Supprime la configuration enregistrée (retour à la résolution par défaut). */
export function clearDbConfig(): void {
  try {
    fs.unlinkSync(configFilePath())
  } catch {
    /* déjà absent */
  }
}

/** Source « Turso » construite à partir d'une saisie (sans l'enregistrer). */
export function tursoSourceFrom(url: string, token: string): DbSource {
  return { mode: 'turso', url: normalizeTursoUrl(url), authToken: token.trim(), origin: 'dashboard' }
}

export function localSource(): DbSource {
  return { mode: 'local', url: localDbPath(), authToken: '', origin: 'default' }
}
