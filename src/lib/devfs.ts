// ─── NEXUS — Accès au code source (espace développeur) ───────────────────────
// Toutes les opérations sont confinées à la racine du projet : aucun chemin ne
// peut sortir du dossier, et une liste noire protège les secrets (.env, base
// SQLite, .git, node_modules). Rien n'est écrit sans passer par `writeGuarded`,
// qui réalise d'abord une sauvegarde horodatée.

import fs from 'fs'
import path from 'path'

export const PROJECT_ROOT = process.cwd()

/** Extensions lisibles par l'explorateur et l'agent Dev. */
export const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.json', '.md', '.prisma', '.yml', '.yaml', '.sql', '.sh'])

/** Dossiers jamais parcourus. */
const BLOCKED_DIRS = new Set([
  '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.turbo',
  '.cache', '.venv', 'out', '.arena', 'backups',
])

/** Fichiers jamais lisibles ni modifiables (secrets, bases, clés). */
const BLOCKED_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development', '.npmrc', '.netrc', '.git-credentials',
])

/**
 * Fichiers générés : exclus des statistiques et de l'audite, sinon ils écrasent
 * tout (package-lock.json fait à lui seul 15 000 lignes).
 */
const GENERATED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', '.DS_Store',
])

/** Vrai si le fichier est un artefact généré (à ignorer). */
function isGenerated(name: string): boolean {
  return GENERATED_FILES.has(name) || /\.min\.(js|css)$/.test(name) || /\.map$/.test(name)
}

/**
 * Un TODO n'est un TODO que dans un commentaire : chercher le mot seul
 * remonte des `status: 'todo'` qui n'ont rien à voir.
 */
export const TODO_RE = '^\\s*(//|/\\*|\\*)\\s*(TODO|FIXME|HACK|XXX)\\b'

const BLOCKED_SUFFIX = ['.db', '.db-wal', '.db-shm', '.db-journal', '.pem', '.key', '.p12', '.pfx']

export class DevFsError extends Error {}

/**
 * Résout un chemin relatif vers un absolu confiné au projet.
 * Lève une erreur si le chemin tente une remontée (`../`) ou touche un secret.
 */
export function safePath(rel: string): string {
  const cleaned = String(rel ?? '').trim().replace(/\\/g, '/')
  if (!cleaned) throw new DevFsError('Chemin vide.')
  const abs = path.resolve(PROJECT_ROOT, cleaned.replace(/^\/+/, ''))
  const root = path.resolve(PROJECT_ROOT)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new DevFsError('Accès refusé : le chemin sort du projet.')
  }
  const rel2 = path.relative(root, abs).replace(/\\/g, '/')
  const parts = rel2.split('/')
  for (const p of parts) {
    if (BLOCKED_DIRS.has(p)) throw new DevFsError(`Accès refusé : « ${p} » est protégé.`)
  }
  const base = path.basename(abs)
  if (BLOCKED_FILES.has(base) || (base.startsWith('.env') && base !== '.env.example')) {
    throw new DevFsError(`Accès refusé : « ${base} » contient des secrets.`)
  }
  for (const suf of BLOCKED_SUFFIX) {
    if (base.endsWith(suf)) throw new DevFsError(`Accès refusé : « ${base} » est un fichier sensible.`)
  }
  return abs
}

/** Dossiers parcourus par l'explorateur et la recherche. */
export const SCAN_ROOTS = ['src', 'prisma', 'scripts', 'public', 'docs']

const ROOT_FILES = ['package.json', 'next.config.ts', 'tsconfig.json', 'eslint.config.mjs', 'README.md', 'postcss.config.mjs', 'tailwind.config.ts']

export interface TreeEntry {
  path: string
  name: string
  type: 'dir' | 'file'
  size?: number
  lines?: number
}

function walk(dir: string, relBase: string, out: TreeEntry[], depth: number, maxDepth: number, maxEntries: number) {
  if (depth > maxDepth || out.length >= maxEntries) return
  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const e of entries) {
    if (out.length >= maxEntries) return
    if (e.isDirectory()) {
      if (BLOCKED_DIRS.has(e.name)) continue
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      out.push({ path: rel, name: e.name, type: 'dir' })
      walk(path.join(dir, e.name), rel, out, depth + 1, maxDepth, maxEntries)
    } else if (e.isFile()) {
      if (!CODE_EXT.has(path.extname(e.name).toLowerCase())) continue
      if (BLOCKED_FILES.has(e.name) || isGenerated(e.name)) continue
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      let size = 0
      try {
        size = fs.statSync(path.join(dir, e.name)).size
      } catch {
        /* ignoré */
      }
      out.push({ path: rel, name: e.name, type: 'file', size })
    }
  }
}

/** Arborescence du projet (limitée en profondeur et en nombre d'entrées). */
export function listTree(rel = '', maxDepth = 2, maxEntries = 400): TreeEntry[] {
  const safeRel = String(rel ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  const abs = safeRel ? safePath(safeRel) : PROJECT_ROOT
  const out: TreeEntry[] = []
  if (!safeRel) {
    for (const root of SCAN_ROOTS) {
      const full = path.join(PROJECT_ROOT, root)
      if (!fs.existsSync(full)) continue
      out.push({ path: root, name: root, type: 'dir' })
      walk(full, root, out, 1, maxDepth, maxEntries)
    }
    for (const f of ROOT_FILES) {
      const full = path.join(PROJECT_ROOT, f)
      if (!fs.existsSync(full) || isGenerated(f)) continue
      out.push({ path: f, name: f, type: 'file', size: fs.statSync(full).size })
    }
    return out
  }
  walk(abs, safeRel, out, 0, maxDepth, maxEntries)
  return out
}

export interface FileView {
  path: string
  language: string
  totalLines: number
  /** Portion réellement renvoyée (les gros fichiers sont tronqués). */
  content: string
  from: number
  to: number
  truncated: boolean
}

const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript',
  '.css': 'css', '.json': 'json', '.md': 'markdown', '.prisma': 'prisma', '.yml': 'yaml',
  '.yaml': 'yaml', '.sql': 'sql', '.sh': 'shell',
}

/** Lit un fichier (avec fenêtre de lignes optionnelle 1-indexée). */
export function readFile(rel: string, fromLine?: number, toLine?: number, maxLines = 500): FileView {
  const abs = safePath(rel)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new DevFsError('Fichier introuvable.')
  if (fs.statSync(abs).size > 1_500_000) throw new DevFsError('Fichier trop volumineux (> 1,5 Mo).')
  const raw = fs.readFileSync(abs, 'utf8')
  const all = raw.split('\n')
  const totalLines = all.length
  let from = Math.max(1, Math.floor(fromLine ?? 1))
  let to = Math.min(totalLines, Math.floor(toLine ?? from + maxLines - 1))
  if (to - from + 1 > maxLines) to = from + maxLines - 1
  const content = all.slice(from - 1, to).join('\n')
  return {
    path: String(rel).replace(/\\/g, '/'),
    language: LANG_BY_EXT[path.extname(abs).toLowerCase()] ?? 'texte',
    totalLines,
    content,
    from,
    to: Math.min(to, totalLines),
    truncated: to < totalLines || from > 1,
  }
}

export interface SearchHit {
  path: string
  line: number
  text: string
}

/** Recherche texte dans tout le projet (équivalent d'un `grep` borné). */
export function searchCode(pattern: string, opts: { max?: number; ext?: string[]; regex?: boolean } = {}): SearchHit[] {
  const max = Math.min(Math.max(opts.max ?? 40, 1), 200)
  const query = String(pattern ?? '').trim()
  if (query.length < 2) return []
  const hits: SearchHit[] = []
  let re: RegExp | null = null
  if (opts.regex) {
    try {
      re = new RegExp(query, 'gi')
    } catch {
      re = null
    }
  }
  const needle = query.toLowerCase()
  const allowed = new Set(opts.ext ?? [...CODE_EXT])

  const visit = (dir: string) => {
    if (hits.length >= max) return
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (hits.length >= max) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (BLOCKED_DIRS.has(e.name)) continue
        visit(full)
      } else if (e.isFile()) {
        if (!allowed.has(path.extname(e.name).toLowerCase())) continue
        if (BLOCKED_FILES.has(e.name) || isGenerated(e.name)) continue
        let raw = ''
        try {
          raw = fs.readFileSync(full, 'utf8')
        } catch {
          continue
        }
        const lines = raw.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const text = lines[i]
          const ok = re ? (re.lastIndex = 0, re.test(text)) : text.toLowerCase().includes(needle)
          if (!ok) continue
          hits.push({
            path: path.relative(PROJECT_ROOT, full).replace(/\\/g, '/'),
            line: i + 1,
            text: text.trim().slice(0, 240),
          })
          if (hits.length >= max) return
        }
      }
    }
  }

  for (const root of SCAN_ROOTS) {
    const full = path.join(PROJECT_ROOT, root)
    if (fs.existsSync(full)) visit(full)
  }
  for (const f of ROOT_FILES) {
    const full = path.join(PROJECT_ROOT, f)
    if (fs.existsSync(full) && !isGenerated(f)) {
      let raw = ''
      try {
        raw = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      raw.split('\n').forEach((text, i) => {
        if (hits.length >= max) return
        const ok = re ? (re.lastIndex = 0, re.test(text)) : text.toLowerCase().includes(needle)
        if (ok) hits.push({ path: f, line: i + 1, text: text.trim().slice(0, 240) })
      })
    }
  }
  return hits
}

export interface FileAnalysis {
  path: string
  lines: number
  bytes: number
  imports: string[]
  exports: string[]
  functions: { name: string; line: number; lines: number }[]
  todos: { line: number; text: string }[]
  /** Heuristiques de dette technique. */
  warnings: string[]
}

/** Analyse statique légère d'un fichier TypeScript/TSX. */
export function analyzeFile(rel: string): FileAnalysis {
  const abs = safePath(rel)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new DevFsError('Fichier introuvable.')
  const raw = fs.readFileSync(abs, 'utf8')
  const lines = raw.split('\n')
  const imports: string[] = []
  const exports: string[] = []
  const functions: { name: string; line: number; lines: number }[] = []
  const todos: { line: number; text: string }[] = []
  const warnings: string[] = []

  let open = 0
  let fnStart = -1
  let fnName = ''
  const fnRe = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/i

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    const imp = trimmed.match(/^import\s+(?:type\s+)?.*?from\s+['"]([^'"]+)['"]/)
    if (imp) imports.push(imp[1])
    if (/^import\s+['"]/.test(trimmed)) {
      const m = trimmed.match(/^import\s+['"]([^'"]+)['"]/)
      if (m) imports.push(m[1])
    }

    const exp = trimmed.match(/^export\s+(?:async\s+)?(?:function|const|class|interface|type|enum)\s+([A-Za-z0-9_$]+)/)
    if (exp) exports.push(exp[1])
    const exp2 = trimmed.match(/^export\s*\{([^}]+)\}/)
    if (exp2) exp2[1].split(',').forEach((n) => exports.push(n.trim().split(/\s+as\s+/).pop()?.trim() ?? ''))

    if (new RegExp(TODO_RE, 'i').test(line)) todos.push({ line: i + 1, text: trimmed.slice(0, 160) })

    if (fnStart < 0) {
      const m = trimmed.match(fnRe)
      if (m && /^(export\s+)?(default\s+)?(async\s+)?function|^(const|let)/.test(trimmed)) {
        fnStart = i
        fnName = m[1] || m[2] || '(anonyme)'
      }
    }
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') open++
      else if (ch === '}' || ch === ')' || ch === ']') open--
    }
    if (fnStart >= 0 && open <= 0 && i > fnStart) {
      functions.push({ name: fnName, line: fnStart + 1, lines: i - fnStart + 1 })
      fnStart = -1
      open = 0
    }
  })

  if (lines.length > 900) warnings.push(`Fichier très long (${lines.length} lignes) — à découper.`)
  const huge = functions.filter((f) => f.lines > 150)
  if (huge.length) {
    warnings.push(`Fonctions démesurées : ${huge.slice(0, 3).map((f) => `${f.name} (${f.lines} lignes)`).join(', ')}.`)
  }
  const anyCount = (raw.match(/:\s*any\b/g) ?? []).length
  if (anyCount > 6) warnings.push(`${anyCount} usages de \`any\` — typage à resserrer.`)
  const consoleCount = (raw.match(/console\.log\(/g) ?? []).length
  if (consoleCount > 4) warnings.push(`${consoleCount} \`console.log\` laissés dans le code.`)
  if (/catch\s*\{\s*\}/.test(raw) || /catch\s*\(\w*\)\s*\{\s*\}/.test(raw)) {
    warnings.push('Un `catch` vide avale les erreurs en silence.')
  }
  if (todos.length) warnings.push(`${todos.length} TODO/FIXME en attente.`)

  return {
    path: String(rel).replace(/\\/g, '/'),
    lines: lines.length,
    bytes: Buffer.byteLength(raw),
    imports: [...new Set(imports)],
    exports: [...new Set(exports.filter(Boolean))],
    functions: functions.sort((a, b) => b.lines - a.lines),
    todos,
    warnings,
  }
}

export interface ProjectStats {
  files: number
  lines: number
  bytes: number
  byFolder: { folder: string; files: number; lines: number }[]
  biggest: { path: string; lines: number }[]
}

/** Statistiques du code source (compte les fichiers et les lignes). */
export function projectStats(): ProjectStats {
  let files = 0
  let lines = 0
  let bytes = 0
  const byFolder = new Map<string, { files: number; lines: number }>()
  const biggest: { path: string; lines: number }[] = []

  const visit = (dir: string, relBase: string) => {
    let entries: fs.Dirent[] = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      const rel = relBase ? `${relBase}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (BLOCKED_DIRS.has(e.name)) continue
        visit(full, rel)
      } else if (e.isFile() && CODE_EXT.has(path.extname(e.name).toLowerCase())) {
        if (BLOCKED_FILES.has(e.name) || isGenerated(e.name)) continue
        let raw = ''
        try {
          raw = fs.readFileSync(full, 'utf8')
        } catch {
          continue
        }
        const n = raw.split('\n').length
        files++
        lines += n
        bytes += Buffer.byteLength(raw)
        const folder = relBase.split('/')[0] || '(racine)'
        const cur = byFolder.get(folder) ?? { files: 0, lines: 0 }
        cur.files++
        cur.lines += n
        byFolder.set(folder, cur)
        biggest.push({ path: rel, lines: n })
      }
    }
  }
  visit(PROJECT_ROOT, '')

  return {
    files,
    lines,
    bytes,
    byFolder: [...byFolder.entries()]
      .map(([folder, v]) => ({ folder, ...v }))
      .sort((a, b) => b.lines - a.lines),
    biggest: biggest.sort((a, b) => b.lines - a.lines).slice(0, 12),
  }
}

/** Dossier des sauvegardes (hors de Git : jamais de pollution du dépôt). */
export const BACKUP_DIR = '.arena/dev-backups'

/** Copie de sauvegarde horodatée, retourne le chemin relatif. */
export function backupFile(rel: string): string {
  const abs = safePath(rel)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const relName = String(rel).replace(/\\/g, '/').replace(/\//g, '__')
  const dir = path.join(PROJECT_ROOT, BACKUP_DIR)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, `${stamp}__${relName}`)
  fs.copyFileSync(abs, dest)
  return path.relative(PROJECT_ROOT, dest).replace(/\\/g, '/')
}

/**
 * Écriture gardée : sauvegarde d'abord, écrit ensuite.
 * Refuse les fichiers trop gros et tout ce qui n'est pas dans le projet.
 */
export function writeGuarded(rel: string, content: string, maxBytes = 800_000): { backup: string; bytes: number } {
  const abs = safePath(rel)
  if (Buffer.byteLength(content) > maxBytes) {
    throw new DevFsError('Contenu trop volumineux (limite 800 Ko).')
  }
  if (!fs.existsSync(path.dirname(abs))) fs.mkdirSync(path.dirname(abs), { recursive: true })
  const backup = fs.existsSync(abs) ? backupFile(rel) : '(fichier nouveau)'
  fs.writeFileSync(abs, content, 'utf8')
  return { backup, bytes: Buffer.byteLength(content) }
}
