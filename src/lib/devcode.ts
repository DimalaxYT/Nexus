// ─── NEXUS — Atelier de modifications de l'agent Dev ─────────────────────────
// Transforme une demande de modification écrite en français en correctifs
// concrets, ancrés sur le contenu RÉEL des fichiers du projet. Aucun modèle
// externe : chaque opération est reconnue, vérifiée contre le disque, puis
// transformée en couple `before` / `after` applicable sans ambiguïté.
//
// Opérations reconnues (voir README, section « Agent Dev ») :
//   • remplace "A" par "B" [dans FICHIER]      → remplacement ciblé
//   • change la ligne contenant "A" en "B"     → remplacement de ligne
//   • renomme `ancien` en `nouveau`            → renommage, un correctif/fichier
//   • supprime la ligne contenant "A"          → suppression de ligne(s)
//   • supprime la fonction `nom`               → suppression du bloc complet
//   • ajoute "texte" après "ancre"             → insertion ciblée
//   • ajoute "texte" à la fin de FICHIER       → ajout en fin de fichier
//   • crée FICHIER + bloc de code              → création de fichier
//   • nettoie / supprime les console.log       → nettoyage (multi-fichiers)
//
// Rien n'est écrit ici : on fabrique des propositions. L'écriture passe par
// `devpatch.ts`, après validation (ou application explicite).

import fs from 'fs'
import path from 'path'
import { DevFsError, listTree, safePath } from './devfs'

export interface CodePatchDraft {
  title: string
  filePath: string
  before: string
  after: string
  rationale: string
}

export type CodeOperation =
  | 'remplacer'
  | 'remplacer-ligne'
  | 'renommer'
  | 'supprimer-ligne'
  | 'supprimer-symbole'
  | 'inserer'
  | 'ajouter-fin'
  | 'creer-fichier'
  | 'reecrire'
  | 'nettoyer-console'
  | 'corriger-defaut'
  | 'multiple'

export interface CodePlan {
  /** Une opération d'édition a bien été reconnue (même si elle échoue). */
  matched: boolean
  operation: CodeOperation | null
  /** Résumé lisible de ce qui a été compris. */
  summary: string
  patches: CodePatchDraft[]
  /** Explications des points de blocage (fichier ambigu, ancre absente…). */
  notes: string[]
  /** Fichiers visés par la demande. */
  targets: string[]
}

const MAX_PATCHES = 24
const MAX_EDIT_BYTES = 700_000

// ── Résolution des fichiers ──────────────────────────────────────────────────

let fileIndex: { at: number; files: string[] } | null = null
const FILE_INDEX_TTL_MS = 10_000

/** Tous les fichiers modifiables du projet (indexé quelques secondes). */
function projectFiles(): string[] {
  const now = Date.now()
  if (fileIndex && now - fileIndex.at < FILE_INDEX_TTL_MS) return fileIndex.files
  try {
    const files = listTree('', 10, 8000)
      .filter((e) => e.type === 'file')
      .map((e) => e.path)
    fileIndex = { at: now, files }
    return files
  } catch {
    return []
  }
}

function normalizeRel(input: string): string {
  let rel = String(input ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^["'`«\s]+|["'`»\s]+$/g, '')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '')
  if (rel.startsWith('@/')) rel = `src/${rel.slice(2)}`
  return rel
}

/** Résout un nom de fichier (chemin complet, partiel ou simple nom). */
export function resolveCodeFile(raw: string): { path: string | null; candidates: string[] } {
  const rel = normalizeRel(raw)
  if (!rel) return { path: null, candidates: [] }

  // Fichier présent sur le disque mais pas encore dans l'index (créé il y a
  // moins de quelques secondes) : on le reconnaît quand même.
  try {
    const abs = safePath(rel)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return { path: rel, candidates: [rel] }
  } catch {
    /* chemin interdit : on laisse la résolution habituelle expliquer l'échec */
  }

  const files = projectFiles()

  const exact = files.find((f) => f === rel)
  if (exact) return { path: exact, candidates: [exact] }

  const suffix = files.filter((f) => f.endsWith(`/${rel}`))
  if (suffix.length === 1) return { path: suffix[0], candidates: suffix }
  if (suffix.length > 1) return { path: null, candidates: suffix.slice(0, 10) }

  const base = path.posix.basename(rel)
  let candidates = files.filter((f) => path.posix.basename(f) === base)
  if (candidates.length === 0 && !path.posix.extname(base)) {
    candidates = files.filter((f) => {
      const ext = path.posix.extname(f)
      return /^\.(tsx?|jsx?|mjs|cjs)$/.test(ext) && path.posix.basename(f, ext) === base
    })
  }
  if (candidates.length === 1) return { path: candidates[0], candidates }
  // Ambiguïté : on privilégie les sources applicatives.
  const preferred = candidates.filter((f) => f.startsWith('src/'))
  const pool = preferred.length ? preferred : candidates
  if (pool.length === 1) return { path: pool[0], candidates: pool }
  return { path: null, candidates: pool.slice(0, 10) }
}

function looksLikePath(value: string): boolean {
  const v = value.trim()
  if (!v || /\s/.test(v)) return false
  if (/^(?:@\/)?(?:src|scripts|prisma|public|docs|llm|db)\//.test(v)) return true
  if (/^[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|prisma|ya?ml|sql|sh)$/.test(v)) return true
  return /^(?:package\.json|tsconfig\.json|next\.config\.ts|eslint\.config\.mjs|postcss\.config\.mjs|tailwind\.config\.ts|README\.md|render\.yaml|Caddyfile)$/.test(v)
}

/** Retire les blocs de code et les guillemets qui ne désignent pas un fichier. */
function stripContentSpans(input: string): string {
  const withoutFences = input.replace(/```[\s\S]*?```/g, ' ')
  return withoutFences.replace(/("[^"]*"|`[^`]*`|«[^»]*»|“[^”]*”)/g, (full) => {
    const inner = full.slice(1, -1).trim()
    return looksLikePath(inner) ? full : ' '
  })
}

const PATH_TOKEN = /(?:src|scripts|prisma|public|docs|llm|db)\/[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|prisma|ya?ml|sql|sh)/gi
const ROOT_TOKEN = /\b(?:package\.json|tsconfig\.json|next\.config\.ts|eslint\.config\.mjs|postcss\.config\.mjs|tailwind\.config\.ts|README\.md|render\.yaml|Caddyfile)\b/g
const BASE_TOKEN = /(?<![\w/@.-])([\w.-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|prisma|ya?ml|sql|sh))(?![\w/-])/g

/** Fichiers explicitement nommés dans la demande (hors contenu ajouté). */
function explicitTargets(message: string): { paths: string[]; notes: string[] } {
  const scope = stripContentSpans(message)
  const tokens = new Set<string>()
  for (const m of scope.matchAll(PATH_TOKEN)) tokens.add(m[0])
  for (const m of scope.matchAll(ROOT_TOKEN)) tokens.add(m[0])
  for (const m of scope.matchAll(BASE_TOKEN)) {
    if (/^(?:package-lock|pnpm-lock|yarn)\./.test(m[1])) continue
    tokens.add(m[1])
  }

  const paths = new Set<string>()
  const notes: string[] = []
  for (const token of tokens) {
    const resolved = resolveCodeFile(token)
    if (resolved.path) paths.add(resolved.path)
    else if (resolved.candidates.length > 1) {
      notes.push(`« ${token} » est ambigu : ${resolved.candidates.join(', ')}. Donne le chemin complet.`)
    } else {
      notes.push(`Je ne trouve aucun fichier nommé « ${token} » dans le projet.`)
    }
  }
  return { paths: [...paths], notes }
}

function stripIndent(value: string): string {
  const lines = value.split('\n')
  const indents = lines.filter((l) => l.trim()).map((l) => (l.match(/^\s*/) ?? [''])[0].length)
  const min = indents.length ? Math.min(...indents) : 0
  return lines.map((l) => l.slice(min)).join('\n')
}

function readEditable(file: string): string {
  const abs = safePath(file)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw new DevFsError(`Le fichier ${file} n'existe pas.`)
  }
  const size = fs.statSync(abs).size
  if (size > MAX_EDIT_BYTES) {
    throw new DevFsError(`${file} dépasse ${Math.round(MAX_EDIT_BYTES / 1000)} Ko : modification refusée.`)
  }
  return fs.readFileSync(abs, 'utf8')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Fichiers dont le contenu vérifie le prédicat (lecture réelle du disque). */
function scanProject(predicate: (raw: string) => boolean, limit = MAX_PATCHES): string[] {
  const out: string[] = []
  for (const file of projectFiles()) {
    if (out.length >= limit) break
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(file)) continue
    try {
      const raw = readEditable(file)
      if (predicate(raw)) out.push(file)
    } catch {
      /* fichier illisible ou trop gros : ignoré */
    }
  }
  return out
}

function filesContaining(text: string, limit = MAX_PATCHES): string[] {
  if (!text || text.trim().length < 2) return []
  const needle = text
  return scanProject((raw) => raw.includes(needle), limit)
}

function filesMatching(regex: RegExp, limit = MAX_PATCHES): string[] {
  return scanProject((raw) => {
    regex.lastIndex = 0
    return regex.test(raw)
  }, limit)
}

// ── Parseurs de demande ──────────────────────────────────────────────────────
// Chaque guillemet soutenu est un groupe de 4 captures :
//   1 = "…", 2 = `…`, 3 = « … », 4 = “ … ”

const Q = '(?:"([^"]+)"|`([^`]+)`|«\\s*([^»]+?)\\s*»|“([^”]+?)”)'
const Q_EMPTY = '(?:"([^"]*)"|`([^`]*)`|«\\s*([^»]*?)\\s*»|“([^”]*?)”)'

function qval(m: RegExpMatchArray, base: number): string | null {
  for (let i = 0; i < 4; i++) {
    const value = m[base + i]
    if (value !== undefined) return value
  }
  return null
}

const SYMBOL = '(?:[`"\'«]\\s*)?([A-Za-z_$][\\w$]*)(?:\\s*[`"\'»])?'
/** Mots qui ne sont jamais des symboles : évite les demandes vagues. */
const SYMBOL_STOP = new Set([
  'de', 'du', 'des', 'le', 'la', 'les', 'un', 'une', 'mon', 'ma', 'mes',
  'ce', 'cette', 'ces', 'fichier', 'code', 'ligne', 'texte', 'chose',
])

function isRealSymbol(name: string): boolean {
  if (!name || name.length < 2) return false // un renommage global d'une lettre est trop risqué
  return !SYMBOL_STOP.has(name.toLowerCase())
}

const RE_RENAME = new RegExp(
  `\\brenomme(?:r)?\\s+(?:la\\s+|le\\s+|les\\s+)?(?:fonction|m[ée]thode|variable|constante|classe|composant|type|interface|symbole)?\\s*${SYMBOL}\\s+(?:en|par|vers)\\s+${SYMBOL}`,
  'i'
)
const RE_DELETE_LINE = new RegExp(
  `\\b(?:supprime(?:r)?|enl[èe]ve(?:r)?|retire(?:r)?)\\s+(?:(?:toutes|les|la|le)\\s+)*lignes?\\s+(?:contenant\\s+|qui\\s+contiennent?\\s+|avec\\s+)?${Q}`,
  'i'
)
const RE_DELETE_LINE_RAW = /\b(?:supprime(?:r)?|enl[èe]ve(?:r)?|retire(?:r)?)\s+(?:(?:toutes|les|la|le)\s+)*lignes?\s+(?:contenant|qui\s+contiennent?|avec)\s+(.+?)(?:\s+dans\s+(.+))?$/i
const RE_DELETE_SYMBOL = new RegExp(
  `\\b(?:supprime(?:r)?|enl[èe]ve(?:r)?|retire(?:r)?)\\s+(?:la\\s+|le\\s+|les\\s+)?(?:fonction|m[ée]thode|constante|const|variable|classe|composant|type|interface|export)\\s+${SYMBOL}`,
  'i'
)
const RE_INSERT = new RegExp(
  `\\b(?:ajoute|ajouter|ins[èe]re|ins[ée]rer)\\s+(?:le\\s+texte\\s+|la\\s+ligne\\s+|ce\\s+texte\\s+)?${Q}\\s+(?:juste\\s+)?(apr[èe]s|avant)\\s+(?:la\\s+ligne\\s+|le\\s+texte\\s+)?${Q}`,
  'i'
)
const RE_APPEND = new RegExp(
  `\\b(?:ajoute|ajouter|ins[èe]re|ins[ée]rer)\\s+(?:le\\s+texte\\s+|la\\s+ligne\\s+|ce\\s+texte\\s+)?${Q}\\s+(?:à\\s+la\\s+fin\\s+(?:de|du\\s+fichier)\\s+|au\\s+fichier\\s+|dans\\s+(?:le\\s+fichier\\s+)?)(.+?)\\s*$`,
  'i'
)
const RE_APPEND_COLON = new RegExp(
  `\\b(?:ajoute|ajouter|ins[èe]re|ins[ée]rer)\\s+(?:le\\s+texte\\s+|la\\s+ligne\\s+)?(?:à\\s+la\\s+fin\\s+(?:de|du\\s+fichier)\\s+|au\\s+fichier\\s+|dans\\s+(?:le\\s+fichier\\s+)?)([\\w./@-]+\\.[a-z]+)\\s*[:,-]\\s*${Q_EMPTY}`,
  'i'
)
const RE_REPLACE_LINE = new RegExp(
  `\\b(?:remplace(?:r)?|change(?:r)?|modifie(?:r)?|corrige(?:r)?)\\s+(?:le\\s+contenu\\s+de\\s+)?la\\s+ligne\\s+(?:contenant\\s+|qui\\s+contient\\s+|avec\\s+)?${Q}\\s+(?:par|avec|en)\\s+${Q_EMPTY}`,
  'i'
)
const RE_REPLACE = new RegExp(
  `\\b(?:remplace(?:r)?|change(?:r)?|corrige(?:r)?)\\s+(?:toutes\\s+les\\s+occurrences\\s+(?:de\\s+)?|le\\s+texte\\s+|la\\s+cha[iî]ne\\s+)?${Q}\\s+(?:par|avec|en)\\s+${Q_EMPTY}`,
  'i'
)
const RE_REPLACE_RAW = /\b(?:remplace(?:r)?|change(?:r)?|corrige(?:r)?|modifie(?:r)?)\s+(?:toutes\s+les\s+occurrences\s+(?:de\s+)?)?(.+?)\s+(?:par|en)\s+(.+?)(?:\s+dans\s+(.+))?$/i
const RE_CREATE = /\b(?:cr[ée]e|cr[ée]er)\s+(?:le\s+fichier\s+|un\s+fichier\s+)?((?:src|scripts|docs|public|prisma|llm)\/[\w./@-]+|[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md))\b/i
const RE_CLEAN_CONSOLE = /\b(?:nettoie|nettoyer|supprime|supprimer|enl[èe]ve|enlever|retire|retirer)\s+(?:tous\s+)?(?:les\s+)?console\.(log|debug|info|warn)\b/i

/** Vrai si la demande est une question ou un apprentissage : on n'édite pas. */
function isNotAnEditRequest(message: string): boolean {
  const m = message.trim()
  if (/^\s*(apprends?|enseigne|m[ée]morise|retiens|sache)\b/i.test(m)) return true
  // « peux-tu … ? » / « est-ce que tu peux … ? » sont des demandes, pas des questions.
  if (/^\s*(?:est[- ]ce\s+que\s+)?(?:tu\s+peux|peux[- ]tu|vous\s+pouvez|pouvez[- ]vous)\b/i.test(m)) return false
  const question = /^\s*(comment|pourquoi|quand|o[ùu]\b|est[- ]ce que|qu['’]est[- ]ce|que fait|à quoi sert|explique(?:-moi)?|d[ée]cris|montre-moi comment)/i
  if (!question.test(m)) return false
  // Une question qui demande explicitement d'agir reste une action.
  return !/\b(?:corrige|applique|modifie|fais|cr[ée]e|ajoute|supprime|renomme|remplace)\b/i.test(m)
}

function finish(plan: Omit<CodePlan, 'notes'> & { notes?: string[] }): CodePlan {
  return { ...plan, notes: plan.notes ?? [] }
}

// ── 1. Nettoyage des console.* ───────────────────────────────────────────────

function planCleanConsole(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_CLEAN_CONSOLE)
  if (!m) return null
  const kind = (m[1] || 'log').toLowerCase()
  const call = `console.${kind}(`
  const scope = stripContentSpans(message)
  const wholeProject = /\b(?:projet|partout|tous\s+les\s+fichiers|dans\s+tout)\b/i.test(scope)

  const files = targets.length ? targets : wholeProject ? filesContaining(call) : []
  const localNotes = [...notes]
  if (!files.length) {
    localNotes.push(
      `Aucun fichier ciblé. Précise « dans tout le projet » ou un fichier : « nettoie les console.${kind} de src/lib/x.ts ».`
    )
    return finish({
      matched: true,
      operation: 'nettoyer-console',
      summary: `Nettoyage des console.${kind}`,
      patches: [],
      notes: localNotes,
      targets: [],
    })
  }

  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const lines = raw.split('\n')
      const kept = lines.filter((line) => !isConsoleLine(line, call))
      if (kept.length === lines.length) continue
      patches.push({
        title: `Nettoyer les console.${kind} — ${path.posix.basename(file)}`,
        filePath: file,
        before: raw,
        after: kept.join('\n'),
        rationale: `${lines.length - kept.length} ligne(s) console.${kind} supprimée(s). Demande : « ${message.slice(0, 180)} ».`,
      })
    } catch {
      /* fichier ignoré */
    }
  }
  if (!patches.length) localNotes.push(`Aucune ligne console.${kind}(...) trouvée dans les fichiers visés.`)

  return finish({
    matched: true,
    operation: 'nettoyer-console',
    summary: `Suppression des console.${kind} dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

function isConsoleLine(line: string, call: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith(call)) return false
  // Une ligne de la forme `console.log(...)` ou `console.log(...);`, éventuellement
  // suivie d'un commentaire : on ne touche pas aux appels multilignes ni aux
  // `if (x) console.log(...)` qui changeraient la logique.
  return /\)\s*;?\s*(?:\/\/.*)?$/.test(trimmed)
}

// ── 2. Création de fichier ───────────────────────────────────────────────────

function planCreate(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_CREATE)
  if (!m) return null
  const requested = normalizeRel(m[1])
  const localNotes = notes.filter((n) => !n.includes(m[1]))

  // Pour une CRÉATION, le fichier n'existe pas encore : on accepte un chemin
  // valide sous les dossiers autorisés, sans exiger qu'il soit déjà indexé.
  let file = resolveCodeFile(requested).path
  if (!file) {
    const allowed = /^(?:src|scripts|docs|public|prisma|llm)\/[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|prisma|ya?ml|sql|sh)$/.test(requested)
    if (!allowed) {
      return finish({
        matched: true,
        operation: 'creer-fichier',
        summary: `Création de ${requested}`,
        patches: [],
        notes: [...localNotes, `Chemin refusé : « ${requested} ». Utilise un chemin sous src/, scripts/, docs/, public/, prisma/ ou llm/.`],
        targets: [],
      })
    }
    try {
      safePath(requested)
    } catch (err) {
      return finish({
        matched: true,
        operation: 'creer-fichier',
        summary: `Création de ${requested}`,
        patches: [],
        notes: [...localNotes, err instanceof Error ? err.message : 'Chemin refusé.'],
        targets: [],
      })
    }
    file = requested
  }
  if (targets.length && !targets.includes(file)) {
    // Le fichier nommé est déjà désigné par le verbe : pas de conflit.
  }
  if (projectFiles().includes(file)) {
    return finish({
      matched: true,
      operation: 'creer-fichier',
      summary: `Création de ${file}`,
      patches: [],
      notes: [...localNotes, `${file} existe déjà : je ne l'écrase pas. Utilise « ajoute … à la fin de ${file} » ou « remplace … par … dans ${file} ».`],
      targets: [file],
    })
  }

  const fence = message.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/)
  let content = fence ? fence[1] : ''
  if (!content) {
    // Repli : contenu entre guillemets après « avec ».
    const after = message.replace(/```[\s\S]*?```/g, ' ')
    const quoted = new RegExp(`\\bavec\\s+${Q}`, 'i').exec(after)
    content = quoted ? qval(quoted, 1) ?? '' : ''
  }
  if (!content.trim()) {
    return finish({
      matched: true,
      operation: 'creer-fichier',
      summary: `Création de ${file}`,
      patches: [],
      notes: [...localNotes, `Aucun contenu fourni. Ajoute un bloc de code (\`\`\`…) après le nom du fichier.`],
      targets: [file],
    })
  }
  const normalized = content.endsWith('\n') ? content : `${content}\n`
  return finish({
    matched: true,
    operation: 'creer-fichier',
    summary: `Création de ${file} (${normalized.split('\n').length - 1} lignes)`,
    patches: [
      {
        title: `Créer ${file}`,
        filePath: file,
        before: '',
        after: normalized,
        rationale: `Nouveau fichier demandé : « ${message.slice(0, 180)} ».`,
      },
    ],
    notes: localNotes,
    targets: [file],
  })
}

// ── 2 bis. Remplacement complet du contenu (code fourni) ─────────────────────

/**
 * « remplace le contenu de src/x.ts par : ```…``` », « mets à jour src/x.ts
 * avec : ```…``` », « réécris src/x.ts : ```…``` ». Permet de faire appliquer
 * un correctif écrit à la main (ou par un autre outil) tout en gardant la
 * sauvegarde, le diff et la validation.
 */
function planRewrite(message: string, targets: string[], notes: string[]): CodePlan | null {
  const intent =
    /\b(?:remplace(?:r)?\s+le\s+contenu|remplace(?:r)?\s+tout\s+le\s+contenu|r[ée][ée]cris|reecris|[ée]crase|ecrase|mets?\s+(?:à|a)\s+jour|nouveau\s+contenu|voici\s+le\s+(?:nouveau\s+)?contenu)\b/i.test(
      message
    )
  if (!intent) return null
  const fence = message.match(/```[a-zA-Z0-9_+-]*\n([\s\S]*?)```/)
  if (!fence) {
    return finish({
      matched: true,
      operation: 'reecrire',
      summary: 'Remplacement du contenu d’un fichier',
      patches: [],
      notes: [
        ...notes,
        targets.length
          ? 'Colle le contenu complet dans un bloc de code : « mets à jour ' +
            targets[0] +
            ' avec : ```…``` ».'
          : 'Indique le fichier et colle son contenu complet dans un bloc de code.',
      ],
      targets,
    })
  }
  if (!targets.length) {
    return finish({
      matched: true,
      operation: 'reecrire',
      summary: 'Remplacement du contenu d’un fichier',
      patches: [],
      notes: [...notes, 'Indique le fichier à réécrire : « mets à jour src/lib/x.ts avec : ```…``` ».'],
      targets: [],
    })
  }
  if (targets.length > 1) {
    return finish({
      matched: true,
      operation: 'reecrire',
      summary: 'Remplacement du contenu d’un fichier',
      patches: [],
      notes: [...notes, `Un seul fichier à la fois : ${targets.slice(0, 4).join(', ')}.`],
      targets,
    })
  }

  const file = targets[0]
  let raw = ''
  try {
    raw = readEditable(file)
  } catch {
    // Fichier encore absent : la réécriture le crée (chemin déjà validé).
    raw = ''
  }
  let next = fence[1]
  if (!next.trim()) {
    return finish({
      matched: true,
      operation: 'reecrire',
      summary: `Réécriture de ${file}`,
      patches: [],
      notes: [...notes, 'Le bloc de code est vide : rien à écrire.'],
      targets: [file],
    })
  }
  if (!next.endsWith('\n')) next += '\n'
  if (raw === next) {
    return finish({
      matched: true,
      operation: 'reecrire',
      summary: `Réécriture de ${file}`,
      patches: [],
      notes: [...notes, `Le contenu fourni est identique à ${file} : aucun correctif nécessaire.`],
      targets: [file],
    })
  }
  const added = next.split('\n').length
  return finish({
    matched: true,
    operation: 'reecrire',
    summary: `${raw ? 'Réécriture' : 'Création'} de ${file} (${added} ligne(s))`,
    patches: [
      {
        title: `${raw ? 'Réécrire' : 'Créer'} ${path.posix.basename(file)}`,
        filePath: file,
        before: raw,
        after: next,
        rationale: `${raw ? 'Contenu complet remplacé' : 'Fichier créé'} à partir du bloc de code fourni. Demande : « ${message.slice(0, 180)} ».`,
      },
    ],
    notes,
    targets: [file],
  })
}

/**
 * Fenêtre minimale autour des lignes modifiées, unique dans le fichier.
 * Permet à deux correctifs d'un même fichier de coexister (ancres disjointes)
 * au lieu de remplacer tout le fichier. Repli sur le fichier complet.
 */
function minimalChangeWindow(
  raw: string,
  lines: string[],
  indexes: number[],
  transform: (window: string[], start: number) => string[],
  minMargin = 0
): { before: string; after: string } {
  const changed = indexes.filter((i) => i >= 0 && i < lines.length)
  if (!changed.length) return { before: raw, after: raw }
  const first = Math.min(...changed)
  const last = Math.max(...changed)
  for (let margin = minMargin; margin <= 4; margin++) {
    const start = Math.max(0, first - margin)
    const end = Math.min(lines.length - 1, last + margin)
    const before = lines.slice(start, end + 1).join('\n')
    if (raw.split(before).length - 1 !== 1) continue
    return { before, after: transform(lines.slice(start, end + 1), start).join('\n') }
  }
  return { before: raw, after: transform(lines, 0).join('\n') }
}

// ── 3. Suppression de lignes ─────────────────────────────────────────────────

function planDeleteLine(message: string, targets: string[], notes: string[]): CodePlan | null {
  const quoted = message.match(RE_DELETE_LINE)
  const raw = quoted ? null : message.match(RE_DELETE_LINE_RAW)
  if (!quoted && !raw) return null
  const needle = quoted ? qval(quoted, 1) : String(raw?.[1] ?? '').trim()
  if (!needle) return null
  // Pour la forme sans guillemets, le « dans FICHIER » éventuel est dans le
  // groupe 2 : on s'appuie sur les cibles déjà résolues par l'appelant.
  const files = targets.length ? targets : filesContaining(needle)
  const localNotes = [...notes]
  if (!files.length) {
    localNotes.push(`Aucune ligne contenant « ${needle} » n'a été trouvée.`)
    return finish({
      matched: true,
      operation: 'supprimer-ligne',
      summary: `Suppression des lignes contenant « ${needle} »`,
      patches: [],
      notes: localNotes,
      targets: [],
    })
  }

  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const lines = raw.split('\n')
      const hits = lines.map((line, i) => (line.includes(needle) ? i : -1)).filter((i) => i >= 0)
      if (!hits.length) continue
      const window = minimalChangeWindow(
        raw,
        lines,
        hits,
        (slice) => slice.filter((line) => !line.includes(needle)),
        1
      )
      patches.push({
        title: `Supprimer ${hits.length} ligne(s) — ${path.posix.basename(file)}`,
        filePath: file,
        before: window.before,
        after: window.after,
        rationale: `${hits.length} ligne(s) contenant « ${needle} » supprimée(s).`,
      })
    } catch {
      /* ignoré */
    }
  }
  return finish({
    matched: true,
    operation: 'supprimer-ligne',
    summary: `Suppression des lignes contenant « ${needle} » dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

// ── 4. Suppression d'un symbole (bloc complet) ───────────────────────────────

function declarationRegex(name: string): RegExp {
  const n = escapeRegExp(name)
  return new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${n}\\b|` +
      `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\s*[=:]|` +
      `^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${n}\\b|` +
      `^\\s*(?:export\\s+)?(?:interface|type)\\s+${n}\\b`
  )
}

function planDeleteSymbol(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_DELETE_SYMBOL)
  if (!m) return null
  const name = m[1]
  if (!isRealSymbol(name)) {
    return finish({
      matched: true,
      operation: 'supprimer-symbole',
      summary: `Suppression de ${name}`,
      patches: [],
      notes: [
        ...notes,
        `« ${name} » n’est pas un nom de symbole exploitable. Donne le nom exact : « supprime la fonction \`nomExact\` ».`,
      ],
      targets: [],
    })
  }
  const decl = declarationRegex(name)
  const files = targets.length ? targets : filesMatching(new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${escapeRegExp(name)}\\b|^\\s*(?:export\\s+)?(?:const|let|var)\\s+${escapeRegExp(name)}\\s*[=:]|^\\s*(?:export\\s+)?(?:interface|type)\\s+${escapeRegExp(name)}\\b`, 'm'))
  const localNotes = [...notes]
  if (!files.length) {
    localNotes.push(`Aucune déclaration de « ${name} » trouvée (fonction, constante, classe, type ou interface).`)
    return finish({
      matched: true,
      operation: 'supprimer-symbole',
      summary: `Suppression de « ${name} »`,
      patches: [],
      notes: localNotes,
      targets: [],
    })
  }

  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const lines = raw.split('\n')
      const start = lines.findIndex((line) => decl.test(line))
      if (start < 0) continue
      const end = findStatementEnd(lines, start)
      let stop = end
      if (stop + 1 < lines.length && lines[stop + 1].trim() === '') stop++
      const kept = [...lines.slice(0, start), ...lines.slice(stop + 1)]
      patches.push({
        title: `Supprimer ${name} — ${path.posix.basename(file)}`,
        filePath: file,
        before: raw,
        after: kept.join('\n'),
        rationale: `Bloc de « ${name} » supprimé (lignes ${start + 1} à ${end + 1}).`,
      })
    } catch {
      /* ignoré */
    }
  }
  return finish({
    matched: true,
    operation: 'supprimer-symbole',
    summary: `Suppression de « ${name} » dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

/** Trouve la fin d'un bloc démarrant à `start` (accolades équilibrées). */
function findStatementEnd(lines: string[], start: number): number {
  let depth = 0
  let sawBrace = false
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code'

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    // Les chaînes simple/double ne franchissent pas une ligne : on repart en
    // mode code. Les commentaires de bloc et les gabarits, eux, continuent.
    if (state === 'single' || state === 'double' || state === 'line') state = 'code'
    for (let j = 0; j < line.length; j++) {
      const c = line[j]
      const next = line[j + 1]

      if ((state as string) === 'line') break
      if (state === 'block') {
        if (c === '*' && next === '/') {
          state = 'code'
          j++
        }
        continue
      }
      if (state === 'single' || state === 'double' || state === 'template') {
        if (c === '\\') {
          j++
          continue
        }
        if (state === 'single' && c === "'") state = 'code'
        else if (state === 'double' && c === '"') state = 'code'
        else if (state === 'template' && c === '`') state = 'code'
        continue
      }

      if (c === '/' && next === '/') {
        state = 'line'
        break
      }
      if (c === '/' && next === '*') {
        state = 'block'
        j++
        continue
      }
      if (c === "'") {
        state = 'single'
        continue
      }
      if (c === '"') {
        state = 'double'
        continue
      }
      if (c === '`') {
        state = 'template'
        continue
      }
      if (c === '{') {
        depth++
        sawBrace = true
      } else if (c === '}') {
        depth--
      }
    }

    if ((state as string) === 'line') state = 'code'
    if (sawBrace && depth <= 0) return i
    if (!sawBrace && depth <= 0 && /;\s*(?:\/\/.*)?$/.test(line)) return i
  }
  return Math.min(lines.length - 1, start + 1)
}

// ── 5. Renommage ─────────────────────────────────────────────────────────────

function planRename(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_RENAME)
  if (!m) return null
  const oldName = m[1]
  const newName = m[2]
  if (!isRealSymbol(oldName) || !isRealSymbol(newName)) {
    return finish({
      matched: true,
      operation: 'renommer',
      summary: `Renommage de ${oldName}`,
      patches: [],
      notes: [
        ...notes,
        `« ${oldName} » n’est pas un nom de symbole exploitable. Donne le nom exact : « renomme \`ancienNom\` en \`nouveauNom\` ».`,
      ],
      targets: [],
    })
  }
  if (oldName === newName) {
    return finish({
      matched: true,
      operation: 'renommer',
      summary: `Renommage de ${oldName}`,
      patches: [],
      notes: [...notes, 'L’ancien et le nouveau nom sont identiques.'],
      targets: [],
    })
  }

  const identifier = new RegExp(`(?<![\\w$])${escapeRegExp(oldName)}(?![\\w$])`, 'g')
  const files = targets.length ? targets : filesMatching(new RegExp(`(?<![\\w$])${escapeRegExp(oldName)}(?![\\w$])`))
  const localNotes = [...notes]
  if (!files.length) {
    localNotes.push(`Le symbole « ${oldName} » n'apparaît nulle part dans les sources.`)
    return finish({
      matched: true,
      operation: 'renommer',
      summary: `Renommage de ${oldName} → ${newName}`,
      patches: [],
      notes: localNotes,
      targets: [],
    })
  }

  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      identifier.lastIndex = 0
      const count = (raw.match(identifier) ?? []).length
      if (!count) continue
      identifier.lastIndex = 0
      const after = raw.replace(identifier, newName)
      if (after === raw) continue
      patches.push({
        title: `Renommer ${oldName} → ${newName} — ${path.posix.basename(file)}`,
        filePath: file,
        before: raw,
        after,
        rationale: `${count} occurrence(s) de « ${oldName} » renommée(s) en « ${newName} ».`,
      })
    } catch {
      /* ignoré */
    }
  }
  return finish({
    matched: true,
    operation: 'renommer',
    summary: `Renommage de « ${oldName} » en « ${newName} » dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

// ── 6. Insertion ciblée ──────────────────────────────────────────────────────

function planInsert(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_INSERT)
  if (!m) return null
  const content = qval(m, 1)
  const direction = (m[5] ?? '').toLowerCase().startsWith('avant') ? 'avant' : 'apres'
  const anchor = qval(m, 6)
  if (!content || !anchor) return null

  const localNotes = [...notes]
  let files = targets
  if (!files.length) {
    const found = scanProject((raw) => raw.includes(anchor), 6)
    if (found.length === 1) files = found
    else if (found.length > 1) {
      localNotes.push(
        `L’ancre « ${anchor} » apparaît dans ${found.length} fichiers (${found.join(', ')}). Indique le fichier cible.`
      )
      return finish({
        matched: true,
        operation: 'inserer',
        summary: `Insertion ${direction === 'avant' ? 'avant' : 'après'} « ${anchor} »`,
        patches: [],
        notes: localNotes,
        targets: found,
      })
    } else {
      localNotes.push(`Ancre « ${anchor} » introuvable dans les sources.`)
      return finish({
        matched: true,
        operation: 'inserer',
        summary: `Insertion ${direction === 'avant' ? 'avant' : 'après'} « ${anchor} »`,
        patches: [],
        notes: localNotes,
        targets: [],
      })
    }
  }

  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const lines = raw.split('\n')
      const anchorLine = lines.findIndex((line) => line.includes(anchor))
      if (anchorLine < 0) {
        localNotes.push(`Ancre « ${anchor} » absente de ${file}.`)
        continue
      }
      const block = stripIndent(content).split('\n')
      const indent = (lines[anchorLine].match(/^\s*/) ?? [''])[0]
      const window = minimalChangeWindow(
        raw,
        lines,
        [anchorLine],
        (slice, start) => {
          const offset = anchorLine - start
          const insertAt = direction === 'avant' ? offset : offset + 1
          return [
            ...slice.slice(0, insertAt),
            ...block.map((l) => (l.trim() ? indent + l : '')),
            ...slice.slice(insertAt),
          ]
        },
        1
      )
      patches.push({
        title: `Insérer ${direction === 'avant' ? 'avant' : 'après'} « ${anchor.slice(0, 40)} » — ${path.posix.basename(file)}`,
        filePath: file,
        before: window.before,
        after: window.after,
        rationale: `Insertion ${direction === 'avant' ? 'avant' : 'après'} la ligne contenant « ${anchor} ».`,
      })
    } catch {
      /* ignoré */
    }
  }

  return finish({
    matched: true,
    operation: 'inserer',
    summary: `Insertion ${direction === 'avant' ? 'avant' : 'après'} « ${anchor} » dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

// ── 7. Ajout en fin de fichier ───────────────────────────────────────────────

function planAppend(message: string, targets: string[], notes: string[]): CodePlan | null {
  let content: string | null = null
  let target = ''

  const colon = message.match(RE_APPEND_COLON)
  if (colon) {
    target = colon[1]
    content = qval(colon, 2)
  } else {
    const m = message.match(RE_APPEND)
    if (!m) return null
    content = qval(m, 1)
    target = m[5] ?? ''
  }
  if (!content || !target) return null

  const resolved = resolveCodeFile(target)
  const localNotes = [...notes]
  if (!resolved.path) {
    return finish({
      matched: true,
      operation: 'ajouter-fin',
      summary: `Ajout à la fin de ${target}`,
      patches: [],
      notes: [...localNotes, `Fichier cible introuvable ou ambigu : ${resolved.candidates.join(', ') || target}.`],
      targets: [],
    })
  }
  const file = resolved.path
  try {
    const raw = readEditable(file)
    const block = stripIndent(content).replace(/\s*$/, '')
    const next = `${raw.replace(/\s*$/, '')}\n\n${block}\n`
    return finish({
      matched: true,
      operation: 'ajouter-fin',
      summary: `Ajout de ${block.split('\n').length} ligne(s) à la fin de ${file}`,
      patches: [
        {
          title: `Ajouter du contenu à la fin de ${path.posix.basename(file)}`,
          filePath: file,
          before: raw,
          after: next,
          rationale: `Contenu ajouté en fin de fichier. Demande : « ${message.slice(0, 180)} ».`,
        },
      ],
      notes: localNotes,
      targets: [file],
    })
  } catch (err) {
    return finish({
      matched: true,
      operation: 'ajouter-fin',
      summary: `Ajout à la fin de ${file}`,
      patches: [],
      notes: [...localNotes, err instanceof Error ? err.message : 'Lecture impossible.'],
      targets: [file],
    })
  }
}

// ── 8. Remplacements ─────────────────────────────────────────────────────────

function planReplaceLine(message: string, targets: string[], notes: string[]): CodePlan | null {
  const m = message.match(RE_REPLACE_LINE)
  if (!m) return null
  const needle = qval(m, 1)
  const replacement = qval(m, 5)
  if (!needle || replacement === null) return null

  const files = targets.length ? targets : filesContaining(needle)
  const localNotes = [...notes]
  const patches: CodePatchDraft[] = []
  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const lines = raw.split('\n')
      const hits = lines.map((line, i) => (line.includes(needle) ? i : -1)).filter((i) => i >= 0)
      if (!hits.length) continue
      const indent = (lines[hits[0]].match(/^\s*/) ?? [''])[0]
      const block = stripIndent(replacement).replace(/\s*$/, '').split('\n')
      const window = minimalChangeWindow(
        raw,
        lines,
        hits,
        (slice, start) =>
          slice.flatMap((line, idx) =>
            hits.includes(start + idx) ? block.map((l) => (l.trim() ? indent + l : '')) : [line]
          ),
        1
      )
      patches.push({
        title: `Remplacer la ligne contenant « ${needle.slice(0, 40)} » — ${path.posix.basename(file)}`,
        filePath: file,
        before: window.before,
        after: window.after,
        rationale: `${hits.length} ligne(s) remplacée(s).`,
      })
    } catch {
      /* ignoré */
    }
  }
  if (!patches.length) localNotes.push(`Aucune ligne contenant « ${needle} » trouvée.`)

  return finish({
    matched: true,
    operation: 'remplacer-ligne',
    summary: `Remplacement des lignes contenant « ${needle} » dans ${patches.length} fichier(s)`,
    patches,
    notes: localNotes,
    targets: files,
  })
}

function buildReplacePatches(
  files: string[],
  oldText: string,
  newText: string,
  message: string,
  firstOnly: boolean,
  notes: string[]
): { patches: CodePatchDraft[]; notes: string[] } {
  const patches: CodePatchDraft[] = []
  const localNotes = [...notes]
  if (!oldText.trim()) {
    localNotes.push('Le texte à remplacer est vide.')
    return { patches, notes: localNotes }
  }

  for (const file of files.slice(0, MAX_PATCHES)) {
    try {
      const raw = readEditable(file)
      const count = raw.split(oldText).length - 1
      if (count === 0) continue
      if (firstOnly) {
        const after = raw.replace(oldText, () => newText)
        if (after === raw) continue
        patches.push({
          title: `Remplacer « ${oldText.slice(0, 40)} » — ${path.posix.basename(file)}`,
          filePath: file,
          before: oldText,
          after: newText,
          rationale: `Première occurrence remplacée. Demande : « ${message.slice(0, 180)} ».`,
        })
        continue
      }
      if (count === 1) {
        // Ancre minimale : plus lisible et déjà unique.
        patches.push({
          title: `Remplacer « ${oldText.slice(0, 40)} » — ${path.posix.basename(file)}`,
          filePath: file,
          before: oldText,
          after: newText,
          rationale: `1 occurrence remplacée. Demande : « ${message.slice(0, 180)} ».`,
        })
        continue
      }
      // Plusieurs occurrences : le fichier complet sert d'ancre, et on les
      // remplace toutes (comportement « remplacer partout » des éditeurs).
      const after = raw.split(oldText).join(newText)
      if (after === raw) continue
      patches.push({
        title: `Remplacer ${count} occurrences de « ${oldText.slice(0, 40)} » — ${path.posix.basename(file)}`,
        filePath: file,
        before: raw,
        after,
        rationale: `${count} occurrence(s) remplacée(s). Demande : « ${message.slice(0, 180)} ».`,
      })
    } catch {
      /* ignoré */
    }
  }
  if (!patches.length && files.length) {
    localNotes.push(
      `Aucune occurrence de « ${oldText.slice(0, 80)} » dans ${files.slice(0, 3).join(', ')}${files.length > 3 ? '…' : ''}.`
    )
  }
  return { patches, notes: localNotes }
}

function planReplace(message: string, targets: string[], notes: string[]): CodePlan | null {
  // Forme entre guillemets (la plus précise).
  const quoted = message.match(RE_REPLACE)
  if (quoted) {
    const oldText = qval(quoted, 1)
    const newText = qval(quoted, 5)
    if (oldText !== null && newText !== null) {
      const firstOnly = /\b(?:premi[èe]re|1re|une\s+seule)\s+occurrence\b/i.test(message)
      const files = targets.length ? targets : filesContaining(oldText)
      const localNotes = [...notes]
      if (!files.length) {
        localNotes.push(`Texte « ${oldText} » introuvable dans les sources.`)
        return finish({
          matched: true,
          operation: 'remplacer',
          summary: `Remplacement de « ${oldText.slice(0, 80)} »`,
          patches: [],
          notes: localNotes,
          targets: [],
        })
      }
      const built = buildReplacePatches(files, oldText, newText, message, firstOnly, localNotes)
      return finish({
        matched: true,
        operation: 'remplacer',
        summary: `Remplacement de « ${oldText.slice(0, 60)} » dans ${built.patches.length} fichier(s)`,
        patches: built.patches,
        notes: built.notes,
        targets: files,
      })
    }
  }

  // Forme sans guillemets : on exige un fichier cible explicite.
  const raw = message.match(RE_REPLACE_RAW)
  if (!raw) return null
  const oldText = raw[1].trim()
  const newText = raw[2].trim()
  if (!oldText || oldText.length > 240 || !newText) return null
  if (!targets.length) {
    return finish({
      matched: true,
      operation: 'remplacer',
      summary: `Remplacement de « ${oldText.slice(0, 60)} »`,
      patches: [],
      notes: [
        ...notes,
        `Pour modifier du code sans guillemets, indique le fichier : « remplace ${oldText} par ${newText} dans src/….ts ».`,
      ],
      targets: [],
    })
  }
  const built = buildReplacePatches(targets, oldText, newText, message, false, notes)
  return finish({
    matched: true,
    operation: 'remplacer',
    summary: `Remplacement de « ${oldText.slice(0, 60)} » dans ${built.patches.length} fichier(s)`,
    patches: built.patches,
    notes: built.notes,
    targets,
  })
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Analyse une demande et fabrique les correctifs correspondants.
 * Ne lève jamais ; en cas d'ambiguïté, renseigne `notes`.
 */
function planCodeEditsSingle(message: string): CodePlan {
  const text = String(message ?? '').trim()
  const empty: CodePlan = { matched: false, operation: null, summary: '', patches: [], notes: [], targets: [] }
  if (!text) return empty
  if (isNotAnEditRequest(text)) return empty

  const { paths, notes } = explicitTargets(text)
  const run = [
    () => planCleanConsole(text, paths, notes),
    () => planCreate(text, paths, notes),
    () => planRewrite(text, paths, notes),
    () => planDeleteLine(text, paths, notes),
    () => planDeleteSymbol(text, paths, notes),
    () => planRename(text, paths, notes),
    () => planInsert(text, paths, notes),
    () => planAppend(text, paths, notes),
    () => planReplaceLine(text, paths, notes),
    () => planReplace(text, paths, notes),
  ]
  for (const step of run) {
    const plan = step()
    if (plan) {
      // Déduplication défensive des correctifs identiques.
      const seen = new Set<string>()
      plan.patches = plan.patches.filter((p) => {
        const key = `${p.filePath}::${p.title}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return plan
    }
  }
  return empty
}

// ── Demandes en plusieurs étapes ────────────────────────────────────────────
// « remplace X par Y dans a.ts puis supprime la ligne Z dans a.ts » : le
// planificateur simple ne voit que la première instruction. On découpe donc la
// demande sur les séparateurs explicites, on planifie chaque étape, puis on
// fusionne les correctifs d'un même fichier en une écriture atomique.

const EDIT_VERB =
  /(?:remplace|change|corrige|modifie|ajoute|supprime|renomme|nettoie|cr[ée]e|mets|ins[èe]re)\b/i

const INSTRUCTION_SPLIT = new RegExp(
  `\\s*(?:;\\s*|\\n+\\s*|\\s+(?:puis|ensuite|et\\s+ensuite)\\s+|\\s+et\\s+)(?=${EDIT_VERB.source})`,
  'i'
)

/** Masque les blocs de code et les citations pour ne pas y découper. */
function maskSpans(text: string): { masked: string; restore: (value: string) => string } {
  const saved: string[] = []
  const masked = text.replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|«[^»\n]*»/g, (match) => {
    saved.push(match)
    return `\u0000${saved.length - 1}\u0000`
  })
  return {
    masked,
    restore: (value: string) => value.replace(/\u0000(\d+)\u0000/g, (_all, i: string) => saved[Number(i)] ?? ''),
  }
}

function hasPathToken(text: string): boolean {
  const scope = stripContentSpans(text)
  for (const re of [PATH_TOKEN, ROOT_TOKEN, BASE_TOKEN]) {
    re.lastIndex = 0
    const ok = re.test(scope)
    re.lastIndex = 0
    if (ok) return true
  }
  return false
}

/** Fusionne les correctifs qui touchent le même fichier, dans l'ordre. */
function composePatches(plans: CodePlan[]): { patches: CodePatchDraft[]; notes: string[] } {
  const ordered: CodePatchDraft[] = []
  const seen = new Set<string>()
  for (const plan of plans) {
    for (const patch of plan.patches) {
      const key = `${patch.filePath}\u0000${patch.before}\u0000${patch.after}`
      if (seen.has(key)) continue
      seen.add(key)
      ordered.push(patch)
    }
  }

  const byFile = new Map<string, CodePatchDraft[]>()
  for (const patch of ordered) {
    const list = byFile.get(patch.filePath) ?? []
    list.push(patch)
    byFile.set(patch.filePath, list)
  }

  const patches: CodePatchDraft[] = []
  const notes: string[] = []
  for (const [file, list] of byFile) {
    if (list.length === 1) {
      patches.push(list[0])
      continue
    }
    try {
      const raw = readEditable(file)
      let next = raw
      let ok = true
      for (const patch of list) {
        if (!patch.before) {
          ok = false
          break
        }
        if (remaining(next, patch.before) === 1) {
          next = next.split(patch.before).join(patch.after)
          continue
        }
        // Les ancres se chevauchent : on rejoue le changement (diff ligne à
        // ligne) sur le contenu déjà modifié, comme un rebasage Git.
        const rebased = rebaseHunk(next, patch.before, patch.after)
        if (rebased === null) {
          ok = false
          break
        }
        next = rebased
      }
      if (ok && next !== raw) {
        const window = compactWindow(raw, next)
        patches.push({
          title: `${list.length} modifications — ${path.posix.basename(file)}`,
          filePath: file,
          before: window.before,
          after: window.after,
          rationale: list
            .map((p) => p.rationale)
            .filter(Boolean)
            .join(' '),
        })
        continue
      }
      notes.push(
        `Les ${list.length} modifications de ${file} se chevauchent : elles sont proposées séparément, à appliquer l’une après l’autre.`
      )
    } catch {
      notes.push(`Impossible de relire ${file} pour fusionner ses modifications.`)
    }
    patches.push(...list)
  }
  return { patches, notes }
}

/**
 * Réduit un couple avant/après à la plus petite fenêtre de lignes englobant
 * toutes les différences (et unique dans `before`). Évite de proposer un
 * fichier entier quand deux retouches ponctuelles suffisent.
 */
export function compactWindow(
  before: string,
  after: string
): { before: string; after: string } {
  const a = before.split('\n')
  const b = after.split('\n')
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  for (let margin = 0; margin <= 4; margin++) {
    const start = Math.max(0, prefix - margin)
    const endA = Math.min(a.length - 1, a.length - 1 - suffix + margin)
    const endB = Math.min(b.length - 1, b.length - 1 - suffix + margin)
    const sliceA = a.slice(start, endA + 1).join('\n')
    if (!sliceA || before.split(sliceA).length - 1 !== 1) continue
    return { before: sliceA, after: b.slice(start, endB + 1).join('\n') }
  }
  return { before, after }
}

function remaining(haystack: string, needle: string): number {
  return needle ? haystack.split(needle).length - 1 : 0
}

/** Rejoue un correctif sur un contenu déjà modifié, par hunk de lignes. */
function rebaseHunk(current: string, before: string, after: string): string | null {
  const a = before.split('\n')
  const b = after.split('\n')
  let prefix = 0
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++
  let suffix = 0
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++
  }
  const oldHunk = a.slice(prefix, a.length - suffix)
  const newHunk = b.slice(prefix, b.length - suffix)
  const lines = current.split('\n')

  if (!oldHunk.length) {
    // Insertion pure : on s'appuie sur la ligne précédente comme ancre.
    if (prefix === 0) return null
    const at = findSequence(lines, [a[prefix - 1]])
    if (at < 0) return null
    lines.splice(at + 1, 0, ...newHunk)
    return lines.join('\n')
  }
  const at = findSequence(lines, oldHunk)
  if (at < 0) return null
  lines.splice(at, oldHunk.length, ...newHunk)
  return lines.join('\n')
}

function findSequence(lines: string[], needle: string[]): number {
  if (!needle.length) return -1
  for (let i = 0; i + needle.length <= lines.length; i++) {
    let ok = true
    for (let j = 0; j < needle.length; j++) {
      if (lines[i + j] !== needle[j]) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

function planComposed(message: string): CodePlan | null {
  const { masked, restore } = maskSpans(message)
  const segments = masked
    .split(INSTRUCTION_SPLIT)
    .map((part) => restore(part).trim())
    .filter(Boolean)
  if (segments.length < 2) return null

  const inherited = explicitTargets(message).paths
  const fallback = inherited.length === 1 ? inherited[0] : null
  const plans: CodePlan[] = []
  for (const segment of segments) {
    let plan = planCodeEditsSingle(segment)
    if (!hasPathToken(segment) && fallback) {
      const withTarget = planCodeEditsSingle(`${segment} dans ${fallback}`)
      if (withTarget.matched) plan = withTarget
    }
    if (plan.matched) plans.push(plan)
  }
  // Une seule étape reconnue : le plan simple est déjà le bon.
  if (plans.length < 2) return null

  const merged = composePatches(plans)
  const notes = [...new Set(plans.flatMap((p) => p.notes))]
    .concat(merged.notes)
    .filter((note, i, all) => all.indexOf(note) === i)
  const operations = new Set(plans.map((p) => p.operation).filter(Boolean))
  return finish({
    matched: true,
    operation: operations.size === 1 ? [...operations][0]! : 'multiple',
    summary: `${merged.patches.length} correctif(s) dans ${new Set(merged.patches.map((p) => p.filePath)).size} fichier(s) — demande en ${plans.length} étape(s)`,
    patches: merged.patches,
    notes,
    targets: [...new Set(merged.patches.map((p) => p.filePath))],
  })
}

/** Analyse une demande (une ou plusieurs instructions) et fabrique les correctifs. */
export function planCodeEdits(message: string): CodePlan {
  const single = planCodeEditsSingle(message)
  const composed = planComposed(message)
  if (composed && composed.patches.length > 0) {
    const singleScore = single.patches.length * 10 + new Set(single.patches.map((p) => p.filePath)).size
    const composedScore =
      composed.patches.length * 10 + new Set(composed.patches.map((p) => p.filePath)).size + 1
    if (composedScore > singleScore) return composed
  }
  return single
}

/** Extrait la portion modifiée d'un couple avant/après (pour la réponse). */
export function patchExcerpt(before: string, after: string, context = 220): {
  prefix: string
  removed: string
  added: string
  suffix: string
} {
  const min = Math.min(before.length, after.length)
  let start = 0
  while (start < min && before[start] === after[start]) start++
  let endA = before.length
  let endB = after.length
  while (endA > start && endB > start && before[endA - 1] === after[endB - 1]) {
    endA--
    endB--
  }
  return {
    prefix: (start > context ? '…\n' : '') + before.slice(Math.max(0, start - context), start),
    removed: before.slice(start, endA),
    added: after.slice(start, endB),
    suffix: after.slice(endB, endB + context) + (endB + context < after.length ? '\n…' : ''),
  }
}

/** Normalise une valeur issue du formulaire en chemin relatif sûr. */
export function cleanCodePath(value: string): string {
  return normalizeRel(value)
}
