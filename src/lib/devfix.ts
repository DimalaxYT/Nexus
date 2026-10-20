// ─── NEXUS — Réparation guidée par l'intention ───────────────────────────────
// « corrige le bug du bouton », « améliore src/lib/devfs.ts », « enlève les
// imports inutilisés » : ces demandes ne décrivent pas l'édition à faire, elles
// décrivent le RÉSULTAT attendu. Ce module comble ce trou : il repère le ou les
// fichiers visés (chemin explicite, symbole, module connu), puis cherche dans
// leur contenu réel des défauts **vérifiables et corrigeables sans ambiguïté**.
//
// Chaque défaut trouvé devient un correctif `before` / `after` exact, ancré sur
// une portion unique du fichier. Rien n'est deviné : si aucun défaut connu
// n'existe dans la cible, on ne fabrique pas de faux correctif — on explique ce
// qui a été contrôlé et on demande l'ancre précise.
//
// Catalogue volontairement restreint à des corrections sûres :
//   • lignes `console.log(...)` / `console.debug(...)` résiduelles,
//   • instructions `debugger`,
//   • imports nommés déclarés mais jamais utilisés,
//   • `parseInt(x)` sans base (base 10 explicite),
//   • `target="_blank"` sans `rel="noopener noreferrer"`,
//   • `<img>` sans attribut `alt`.

import fs from 'fs'
import path from 'path'
import { listTree, safePath, searchCode } from './devfs'
import { compactWindow, resolveCodeFile, type CodeOperation, type CodePlan, type CodePatchDraft } from './devcode'

const MAX_FILE_BYTES = 700_000
const MAX_FIX_PATCHES = 12

type FixKind = 'console' | 'debugger' | 'imports' | 'parseint' | 'target-blank' | 'img-alt'

interface Candidate {
  kind: FixKind
  filePath: string
  /** Ligne 1-based, pour la lisibilité du compte rendu. */
  line: number
  title: string
  rationale: string
  before: string
  after: string
  /** Édition au niveau ligne (0-based) : fusion sans chevauchement d'ancres. */
  edit: { start: number; end: number; replacement: string[] }
}

// ── Lecture ─────────────────────────────────────────────────────────────────

function readCode(file: string): string | null {
  try {
    const abs = safePath(file)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return null
    if (fs.statSync(abs).size > MAX_FILE_BYTES) return null
    return fs.readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

function codeFiles(): string[] {
  try {
    return listTree('', 10, 8000)
      .filter((e) => e.type === 'file' && /\.(?:tsx?|jsx?|mjs|cjs)$/.test(e.path))
      .map((e) => e.path)
  } catch {
    return []
  }
}

// ── Résolution de la cible ──────────────────────────────────────────────────

const PATH_TOKEN =
  /(?:src|scripts|prisma|public|docs|llm|db)\/[\w./@-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md|prisma|ya?ml|sql|sh)/gi
const DIR_TOKEN = /(?:src|scripts|docs|public)(?:\/[\w.@-]+)*\//g
const BASE_TOKEN = /(?<![\w/@.-])([\w.-]+\.(?:tsx?|jsx?|mjs|cjs|css|json|md))(?![-\w/])/g

/** Modules connus → fichiers où intervenir (miroir resserré de l'architecture). */
const MODULES: { words: string[]; files: string[] }[] = [
  {
    words: ['agent dev', 'dev agent', 'dashboard dev', 'espace dev', 'correctif', 'correctifs'],
    files: [
      'src/lib/devbrain.ts',
      'src/lib/devcode.ts',
      'src/lib/devpatch.ts',
      'src/components/nexus/DevAgentPanel.tsx',
      'src/components/nexus/DevDashboard.tsx',
    ],
  },
  { words: ['auth', 'connexion', 'session', 'login', 'compte', 'profil'], files: ['src/lib/auth.ts', 'src/app/api/auth/login/route.ts'] },
  { words: ['base de données', 'base de donnees', 'sqlite', 'schéma', 'schema', 'table', 'migration'], files: ['src/lib/db.ts', 'prisma/schema.prisma'] },
  { words: ['cerveau', 'intelligence', 'brain', 'réponses', 'reponses', 'classifieur'], files: ['src/lib/brain/brain.ts', 'src/lib/brain/classifier.ts', 'src/lib/brain/responder.ts'] },
  { words: ['connaissance', 'mémoire', 'memoire', 'savoir'], files: ['src/lib/brain/knowledge-bank.ts', 'src/lib/brain/memory-rules.ts'] },
  { words: ['blueprint', 'nœud', 'noeud', 'workflow'], files: ['src/lib/blueprint.ts', 'src/components/nexus/BlueprintEditor.tsx'] },
  { words: ['clé api', 'cle api', 'api key', 'chatbot', 'client api'], files: ['src/lib/api-keys.ts', 'src/app/api/v1/chat/route.ts'] },
  {
    words: ['interface', 'ui', 'sidebar', 'menu', 'bouton', 'boutons', 'clic', 'onglet', 'écran', 'ecran', 'page'],
    files: [
      'src/components/nexus/AppShell.tsx',
      'src/components/nexus/Hub.tsx',
      'src/components/nexus/AgentChat.tsx',
      'src/components/nexus/DevDashboard.tsx',
    ],
  },
  { words: ['studio', 'éditeur', 'editeur', 'image', 'vidéo', 'video', '3d'], files: ['src/components/nexus/studios/CodeStudio.tsx', 'src/components/nexus/studios/ImageStudio.tsx'] },
  { words: ['mission', 'missions', 'arrière-plan', 'arriere-plan'], files: ['src/lib/mission-runner.ts', 'src/components/nexus/MissionsPanel.tsx'] },
  { words: ['personnalisation', 'persona', 'ton', 'instructions'], files: ['src/lib/persona.ts', 'src/lib/auth.ts'] },
]

function filesFromPaths(message: string): { files: string[]; notes: string[] } {
  const tokens = new Set<string>()
  for (const m of message.matchAll(PATH_TOKEN)) tokens.add(m[0])
  for (const m of message.matchAll(BASE_TOKEN)) tokens.add(m[1])
  const files = new Set<string>()
  const notes: string[] = []
  for (const token of tokens) {
    const r = resolveCodeFile(token)
    if (r.path) files.add(r.path)
    else if (r.candidates.length > 1) notes.push(`« ${token} » est ambigu : ${r.candidates.join(', ')}.`)
  }
  // Dossiers explicites : « corrige les console.log dans src/components/ ».
  // On ignore un préfixe de fichier (« docs/fichier.ts » ne vise pas docs/).
  for (const m of message.matchAll(DIR_TOKEN)) {
    const after = message.slice((m.index ?? 0) + m[0].length)
    if (/^[\w.@-]/.test(after)) continue
    const dir = m[0].replace(/\/+$/, '')
    try {
      const abs = safePath(dir)
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) files.add(dir)
    } catch {
      /* chemin interdit ou absent */
    }
  }
  return { files: [...files], notes }
}

const STOP_SYMBOLS = new Set([
  'code',
  'bug',
  'bugs',
  'fichier',
  'fichiers',
  'fonction',
  'fonctions',
  'composant',
  'composants',
  'erreur',
  'erreurs',
  'ligne',
  'lignes',
  'projet',
  'page',
  'pages',
  'bouton',
  'boutons',
  'site',
  'application',
  'nexus',
  'agent',
  'dev',
  'imports',
  'import',
  'console',
  'debugger',
  'parseint',
  'alt',
  'rel',
  'target',
  'tout',
  'tous',
  'toutes',
  'fichier.ts',
  'index.ts',
])

function filesFromSymbols(message: string): string[] {
  const symbols = new Set<string>()
  for (const m of message.matchAll(/`([A-Za-z_$][\w$]*)`/g)) symbols.add(m[1])
  for (const m of message.matchAll(/\b(?:fonction|fonctions|composant|composants|symbole|m[ée]thode)\s+`?([A-Za-z_$][\w$]*)`?/gi)) symbols.add(m[1])
  for (const m of message.matchAll(/\b(?:dans|de|du)\s+`([A-Za-z_$][\w$]*)`/g)) symbols.add(m[1])

  const files: string[] = []
  for (const raw of symbols) {
    const symbol = raw.trim()
    if (!symbol || symbol.length < 3 || STOP_SYMBOLS.has(symbol.toLowerCase())) continue
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const declarationRe = new RegExp(`\\b(?:function|const|let|class|interface|type|enum)\\s+${escaped}\\b`)
    const hits = searchCode(symbol, { max: 200 })
    // Priorité au fichier qui DÉCLARE le symbole, pas à ceux qui l'utilisent.
    const declaration =
      hits.find((h) => declarationRe.test(h.text)) ??
      searchCode(`(?:function|const|let|class|interface|type|enum)\\s+${escaped}\\b`, { regex: true, max: 10 }).find(
        (h) => declarationRe.test(h.text)
      )
    const chosen = declaration?.path ?? hits[0]?.path
    if (chosen && !files.includes(chosen)) files.push(chosen)
  }
  return files
}

function filesFromModules(message: string): string[] {
  const m = message.toLowerCase()
  let best: { score: number; files: string[] } | null = null
  for (const mod of MODULES) {
    let score = 0
    for (const w of mod.words) if (m.includes(w)) score += Math.max(1, w.length / 4)
    if (score > 0 && (!best || score > best.score)) best = { score, files: mod.files }
  }
  return best?.files ?? []
}

// ── Intention ───────────────────────────────────────────────────────────────

const FIX_VERB =
  /\b(?:corrige(?:r)?|r[ée]pare(?:r)?|fixe(?:r)?|am[ée]liore(?:r)?|optimise(?:r)?|all[èe]ge(?:r)?|nettoie(?:r)?|nettoyer|s[ée]curise(?:r)?|d[ée]barrasse(?:r)?|enl[èe]ve(?:r)?|supprime(?:r)?)\b/i

const GENERAL_IMPROVEMENT =
  /\b(?:am[ée]liore(?:r)?|optimise(?:r)?|all[èe]ge(?:r)?|nettoie(?:r)?|nettoyer|s[ée]curise(?:r)?|propre|qualit[ée]|d[ée]barrasse(?:r)?)\b/i

const KIND_WORDS: { kind: FixKind; re: RegExp }[] = [
  { kind: 'console', re: /\b(?:console(?:\.log)?|logs?|traces?|debug)\b/i },
  { kind: 'debugger', re: /debugger|point\s+d['’]arr[êe]t/i },
  { kind: 'imports', re: /\b(?:imports?|importations?|inutilis[ée]\w*)\b/i },
  { kind: 'parseint', re: /parse\s*int|\bradix\b|\bbase\s*10\b/i },
  { kind: 'target-blank', re: /\b(?:target|blank|noopener|noreferrer|rel|liens?|s[ée]curis\w*)\b/i },
  { kind: 'img-alt', re: /\balt\b|accessibilit[ée]|\ba11y\b|images?\s+sans/i },
]

function requestedKinds(message: string): FixKind[] {
  const kinds = KIND_WORDS.filter((k) => k.re.test(message)).map((k) => k.kind)
  return kinds.length ? kinds : ['console', 'debugger', 'imports', 'parseint', 'target-blank', 'img-alt']
}

/** Une demande de réparation, formulée comme une action et non comme une question. */
export function isFixRequest(message: string): boolean {
  const text = String(message ?? '').trim()
  if (!text) return false
  if (/^\s*(?:comment|pourquoi|quand|o[ùu]\b|qu['’]est[- ]ce|est[- ]ce\s+que\s+(?:tu|le|la|les)|que\s+fait|à\s+quoi\s+sert)/i.test(text)) {
    // « comment corriger X ? » reste une question ; « corrige X » est une action.
    if (!FIX_VERB.test(text) || /^(?:comment|pourquoi|quand|o[ùu]\b)/i.test(text)) return false
  }
  if (/^\s*(?:apprends?|enseigne|m[ée]morise|retiens|sache)\b/i.test(text)) return false
  if (/\?\s*$/.test(text) && !/\b(?:peux[- ]tu|est[- ]ce\s+que\s+tu\s+peux)\b/i.test(text)) return false
  return FIX_VERB.test(text)
}

// ── Ancrage exact ───────────────────────────────────────────────────────────

function count(raw: string, needle: string): number {
  return needle ? raw.split(needle).length - 1 : 0
}

/**
 * Trouve la plus petite fenêtre de lignes autour de `index` qui est unique dans
 * le fichier. `transform` fabrique la version corrigée de cette fenêtre.
 */
function anchoredWindow(
  lines: string[],
  raw: string,
  index: number,
  transform: (window: string[], start: number) => string[],
  minPad = 0
): { before: string; after: string } | null {
  for (let pad = minPad; pad <= 4; pad++) {
    // Fenêtre bornée au fichier : près du début ou de la fin, elle s'étend
    // d'un seul côté plutôt que d'être rejetée.
    const start = Math.max(0, index - pad)
    const end = Math.min(lines.length - 1, index + pad)
    if (start === index && end === index) continue
    const window = lines.slice(start, end + 1)
    const before = window.join('\n')
    if (count(raw, before) !== 1) continue
    const after = transform(window, start).join('\n')
    if (after === before) continue
    return { before, after }
  }
  return null
}

// ── Détecteurs ──────────────────────────────────────────────────────────────

function detectConsole(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!/^console\.(?:log|debug)\(/.test(trimmed)) return
    if (!/\)\s*;?\s*(?:\/\/.*)?$/.test(trimmed)) return
    const anchor = anchoredWindow(
      lines,
      raw,
      i,
      (w, start) => {
        const copy = [...w]
        copy.splice(i - start, 1)
        return copy
      },
      1
    )
    if (!anchor) return
    out.push({
      kind: 'console',
      filePath: file,
      line: i + 1,
      title: `Supprimer un console.log résiduel — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : trace de mise au point laissée dans le code.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [] },
    })
  })
  return out
}

function detectDebugger(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    if (!/^\s*debugger;?\s*$/.test(line)) return
    const anchor = anchoredWindow(
      lines,
      raw,
      i,
      (w, start) => {
        const copy = [...w]
        copy.splice(i - start, 1)
        return copy
      },
      1
    )
    if (!anchor) return
    out.push({
      kind: 'debugger',
      filePath: file,
      line: i + 1,
      title: `Retirer l'instruction debugger — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : point d'arrêt oublié, il bloque l'exécution dans les outils du navigateur.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [] },
    })
  })
  return out
}

function localNameOf(specifier: string): string | null {
  const clean = specifier.trim().replace(/^type\s+/, '')
  if (!clean) return null
  const m = clean.match(/(?:as\s+)?([A-Za-z_$][\w$]*)$/)
  return m ? m[1] : null
}

function detectImports(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    const m = line.match(/^(\s*)import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"][^'"]+['"];?\s*$/)
    if (!m) return
    const specifiers = m[2]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (!specifiers.length) return

    // Le nom est cherché HORS de la ligne d'import : sinon le chemin du module
    // (« from 'fs' ») serait compté comme une utilisation de `fs`.
    const withoutLine = raw.replace(line, '\u0000')
    const used = (name: string): boolean =>
      new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(withoutLine)
    const unused = specifiers.filter((spec) => {
      const local = localNameOf(spec)
      return local ? !used(local) : false
    })
    if (!unused.length) return

    const kept = specifiers.filter((s) => !unused.includes(s))
    // On reconstruit la ligne en gardant strictement préfixe, guillemets et
    // ponctuation d'origine : seul le contenu des accolades change.
    const open = line.indexOf('{')
    const close = line.lastIndexOf('}')
    const prefix = line.slice(0, open + 1)
    const suffix = line.slice(close)
    const transform = (w: string[], start: number): string[] => {
      const copy = [...w]
      const target = i - start
      if (kept.length) copy[target] = `${prefix} ${kept.join(', ')} ${suffix}`
      else copy.splice(target, 1)
      return copy
    }
    const anchor = anchoredWindow(lines, raw, i, transform, kept.length ? 0 : 1)
    if (!anchor) return
    out.push({
      kind: 'imports',
      filePath: file,
      line: i + 1,
      title: kept.length
        ? `Retirer ${unused.length} import(s) inutilisé(s) — ${path.posix.basename(file)}`
        : `Supprimer un import inutilisé — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : ${unused.join(', ')} déclaré(s) mais jamais utilisé(s) dans le fichier.`,
      before: anchor.before,
      after: anchor.after,
      edit: {
        start: i,
        end: i,
        replacement: kept.length ? [`${prefix} ${kept.join(', ')} ${suffix}`] : [],
      },
    })
  })

  // Import par défaut seul : `import Truc from 'module'`.
  lines.forEach((line, i) => {
    const m = line.match(/^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"];?\s*$/)
    if (!m) return
    const local = m[1]
    const escaped = local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}\\b`).test(raw.replace(line, '\u0000'))) return
    const anchor = anchoredWindow(
      lines,
      raw,
      i,
      (w, start) => {
        const copy = [...w]
        copy.splice(i - start, 1)
        return copy
      },
      1
    )
    if (!anchor) return
    out.push({
      kind: 'imports',
      filePath: file,
      line: i + 1,
      title: `Supprimer un import inutilisé — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : import par défaut « ${local} » jamais utilisé dans le fichier.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [] },
    })
  })
  return out
}

function detectParseInt(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
    const re = /\bparseInt\(\s*('[^']*'|"[^"]*"|`[^`]*`|[^,()"']+?)\s*\)/g
    if (!re.test(line)) return
    re.lastIndex = 0
    const comment = line.indexOf('//')
    let changed = false
    const next = line.replace(re, (full: string, arg: string, offset: number) => {
      if (comment >= 0 && offset > comment) return full
      changed = true
      return `parseInt(${arg}, 10)`
    })
    if (!changed || next === line) return
    const anchor = anchoredWindow(lines, raw, i, (w, start) => {
      const copy = [...w]
      copy[i - start] = next
      return copy
    })
    if (!anchor) return
    out.push({
      kind: 'parseint',
      filePath: file,
      line: i + 1,
      title: `Forcer la base 10 de parseInt — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : sans base explicite, parseInt devine la base et peut produire un résultat inattendu.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [next] },
    })
  })
  return out
}

function detectTargetBlank(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    const tag = line.match(/<a\b[^>\n]*>/)
    if (!tag) return
    const t = tag[0]
    if (!/\btarget\s*=\s*["']_blank["']/.test(t)) return
    if (/\brel\s*=/.test(t) || /\{\.\.\./.test(t)) return
    const next = line.replace(t, t.replace(/\s*>$/, ' rel="noopener noreferrer">'))
    if (next === line) return
    const anchor = anchoredWindow(lines, raw, i, (w, start) => {
      const copy = [...w]
      copy[i - start] = next
      return copy
    })
    if (!anchor) return
    out.push({
      kind: 'target-blank',
      filePath: file,
      line: i + 1,
      title: `Ajouter rel="noopener noreferrer" — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : un lien target="_blank" sans rel laisse la page ouverte accéder à window.opener.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [next] },
    })
  })
  return out
}

function detectImgAlt(file: string, raw: string, lines: string[]): Candidate[] {
  const out: Candidate[] = []
  lines.forEach((line, i) => {
    const tag = line.match(/<img\b[^>\n]*?\/?>/)
    if (!tag) return
    const t = tag[0]
    if (/\balt\s*=/.test(t) || /\{\.\.\./.test(t)) return
    const next = line.replace(t, t.replace(/\s*\/?>$/, (end) => (end.includes('/') ? ' alt="" />' : ' alt="">')))
    if (next === line) return
    const anchor = anchoredWindow(lines, raw, i, (w, start) => {
      const copy = [...w]
      copy[i - start] = next
      return copy
    })
    if (!anchor) return
    out.push({
      kind: 'img-alt',
      filePath: file,
      line: i + 1,
      title: `Ajouter alt="" à une image — ${path.posix.basename(file)}`,
      rationale: `Ligne ${i + 1} : une image sans attribut alt est ignorée ou mal annoncée par les lecteurs d'écran.`,
      before: anchor.before,
      after: anchor.after,
      edit: { start: i, end: i, replacement: [next] },
    })
  })
  return out
}

const DETECTORS: Record<FixKind, (file: string, raw: string, lines: string[]) => Candidate[]> = {
  console: detectConsole,
  debugger: detectDebugger,
  imports: detectImports,
  parseint: detectParseInt,
  'target-blank': detectTargetBlank,
  'img-alt': detectImgAlt,
}

// ── Planification ───────────────────────────────────────────────────────────

export interface FixPlan extends CodePlan {
  /** Fichiers réellement inspectés (pour un compte rendu honnête). */
  inspected: string[]
  /** Défauts cherchés. */
  kinds: FixKind[]
}

const KIND_LABEL: Record<FixKind, string> = {
  console: 'traces console.log/console.debug',
  debugger: 'instructions debugger',
  imports: 'imports inutilisés',
  parseint: 'parseInt sans base',
  'target-blank': 'liens target="_blank" sans rel',
  'img-alt': 'images sans alt',
}

/**
 * Transforme une demande de réparation (« corrige… », « améliore… ») en
 * correctifs concrets. Renvoie `null` si le message n'est pas une demande de
 * réparation — le reste de l'agent garde alors la main.
 */
export function planFixRequest(message: string): FixPlan | null {
  const text = String(message ?? '').trim()
  if (!text || !isFixRequest(text)) return null

  const kinds = requestedKinds(text)
  const explicitKinds = KIND_WORDS.some((k) => k.re.test(text))
  const fromPaths = filesFromPaths(text)
  const symbolFiles = filesFromSymbols(text)
  const moduleFiles = filesFromModules(text)

  let targets = [...new Set([...fromPaths.files, ...symbolFiles])]
  const general = GENERAL_IMPROVEMENT.test(text)
  if (!targets.length) {
    if (explicitKinds || general) targets = moduleFiles
    // Une demande ciblée par type de défaut balaie tout `src/`.
    if (!targets.length && explicitKinds) targets = ['src']
  }

  const notes = [...fromPaths.notes]
  if (!targets.length) {
    notes.push(
      'Pour réparer, j’ai besoin d’une cible : un fichier (`src/lib/x.ts`), un symbole (« `safePath` ») ou un type de défaut ' +
        '(`console.log`, `imports inutilisés`, `parseInt`, `alt`, `target="_blank"`).'
    )
    return {
      matched: true,
      operation: 'corriger-defaut',
      summary: 'Réparation demandée',
      patches: [],
      notes,
      targets: [],
      inspected: [],
      kinds,
    }
  }

  // Un dossier cible (`src`) : on s'appuie sur l'index de recherche.
  const files = new Set<string>()
  for (const target of targets) {
    if (fs.existsSync(safePath(target)) && fs.statSync(safePath(target)).isDirectory()) {
      for (const f of codeFiles()) if (f.startsWith(`${target.replace(/\/$/, '')}/`)) files.add(f)
    } else {
      files.add(target)
    }
  }

  const patches: CodePatchDraft[] = []
  const inspected: string[] = []
  let corrections = 0

  for (const file of [...files].slice(0, 400)) {
    if (patches.length >= MAX_FIX_PATCHES) break
    const raw = readCode(file)
    if (raw === null) continue
    inspected.push(file)
    const lines = raw.split('\n')

    const found: Candidate[] = []
    for (const kind of kinds) found.push(...DETECTORS[kind](file, raw, lines))
    const unique = found.filter(
      (c, i) => found.findIndex((o) => o.before === c.before && o.after === c.after) === i
    )
    if (!unique.length) continue
    corrections += unique.length

    // Plusieurs défauts dans un même fichier : on les fusionne en UN correctif
    // (l'application est séquentielle et atomique). Un correctif par fichier
    // touché, donc « Tout appliquer » reste lisible. La fusion passe par les
    // éditions de lignes, pas par les ancres (qui se chevauchent).
    const edits = [...unique].sort((x, y) => x.edit.start - y.edit.start)
    let mergeable = true
    for (let k = 1; k < edits.length; k++) {
      if (edits[k].edit.start <= edits[k - 1].edit.end) mergeable = false
    }
    let merged: string = raw
    if (mergeable) {
      const mergedLines = lines.slice()
      for (let k = edits.length - 1; k >= 0; k--) {
        const e = edits[k].edit
        mergedLines.splice(e.start, e.end - e.start + 1, ...e.replacement)
      }
      merged = mergedLines.join('\n')
    }
    if (mergeable && unique.length > 1) {
      const window = compactWindow(raw, merged)
      patches.push({
        title: `${unique.length} corrections — ${path.posix.basename(file)}`,
        filePath: file,
        before: window.before,
        after: window.after,
        rationale: unique.map((c) => c.rationale).join(' '),
      })
      continue
    }
    for (const c of unique) {
      if (patches.length >= MAX_FIX_PATCHES) break
      patches.push({
        title: c.title,
        filePath: c.filePath,
        before: c.before,
        after: c.after,
        rationale: c.rationale,
      })
    }
  }

  if (!patches.length && inspected.length) {
    notes.push(
      `Aucun défaut automatisable (${kinds.map((k) => KIND_LABEL[k]).join(', ')}) dans ${inspected
        .slice(0, 4)
        .map((f) => `\`${f}\``)
        .join(', ')}${inspected.length > 4 ? '…' : ''}. ` +
        'Décris le symptôme exact (message d’erreur, texte affiché, ligne) ou donne l’ancre : « remplace `…` par `…` ».'
    )
  }

  return {
    matched: true,
    operation: 'corriger-defaut' as CodeOperation,
    summary:
      patches.length > 0
        ? `Réparation : ${corrections} défaut(s) vérifié(s) dans ${patches.length} fichier(s)`
        : 'Réparation demandée',
    patches,
    notes,
    targets: [...files],
    inspected,
    kinds,
  }
}
