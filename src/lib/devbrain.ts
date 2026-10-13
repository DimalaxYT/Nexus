// ─── NEXUS — Cerveau de l'agent Dev ──────────────────────────────────────────
// Un moteur d'ingénierie 100 % local : il lit le vrai code du projet, connaît
// son architecture, diagnostique, et fabrique des correctifs à valider.
// Aucun appel externe — tout sort du disque et de la base SQLite.

import fs from 'fs'
import path from 'path'
import { db } from './db'
import { addObjective, trainerSnapshot } from './devtrainer'
import { getDaemonState } from './devdaemon'
import {
  TODO_RE,
  DevFsError,
  analyzeFile,
  projectStats,
  readFile,
  safePath,
  searchCode,
} from './devfs'

// ── Types ────────────────────────────────────────────────────────────────────

export type DevIntent =
  | 'audit'
  | 'intelligence'
  | 'apprendre'
  | 'expliquer'
  | 'chercher'
  | 'debug'
  | 'fonctionnalite'
  | 'optimiser'
  | 'verifier'
  | 'entrainement'
  | 'aide'
  | 'general'

export interface DevFileRef {
  path: string
  note?: string
  lines?: string
  from?: number
  to?: number
}

export interface DevPatchDraft {
  id?: string
  title: string
  filePath: string
  /** Ancre exacte à remplacer (contexte réel du fichier). */
  before: string
  /** Nouveau contenu de l'ancre. */
  after: string
  rationale: string
}

export interface DevTaskDraft {
  id?: string
  title: string
  detail: string
  category: 'intelligence' | 'code' | 'performance' | 'securite' | 'interface'
  priority: 'basse' | 'normale' | 'haute'
}

export interface DevTurnResult {
  intent: DevIntent
  reply: string
  thoughts: string[]
  files: DevFileRef[]
  patch?: DevPatchDraft
  tasks: DevTaskDraft[]
}

interface DevMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── Carte d'architecture ─────────────────────────────────────────────────────
// Ce que l'agent Dev sait du projet. Les descriptions sont écrites à la main :
// c'est cette carte qui lui permet de viser juste au lieu de chercher au hasard.

interface ArchModule {
  key: string
  title: string
  match: string[]
  role: string
  files: string[]
  /** Où intervenir pour tel type de demande. */
  touchpoints: string
}

const ARCHITECTURE: ArchModule[] = [
  {
    key: 'auth',
    title: 'Comptes & authentification',
    match: ['auth', 'connexion', 'compte', 'session', 'login', 'mot de passe', 'inscription', 'profil'],
    role:
      'Gère les comptes, les sessions et la personnalisation. Hachage scrypt local, cookie httpOnly, et surtout `ownerGuard()` / `devGuard()` qui cloisonnent toutes les routes de données.',
    files: [
      'src/lib/auth.ts',
      'src/lib/auth-client.tsx',
      'src/app/api/auth/login/route.ts',
      'src/app/api/auth/register/route.ts',
      'src/components/nexus/AuthGate.tsx',
      'src/components/nexus/AccountPanel.tsx',
    ],
    touchpoints:
      'Ajouter un champ de profil → `UserProfile` (auth.ts) + `AccountPanel.tsx`. Ajouter une règle d’accès → `ownerGuard()` / `devGuard()`.',
  },
  {
    key: 'db',
    title: 'Base de données',
    match: ['base', 'sqlite', 'table', 'schema', 'prisma', 'données', 'migration'],
    role:
      'Client SQLite maison sur `node:sqlite` (`DatabaseSync`). Les tables sont décrites dans `TABLES`, créées par un bloc de DDL unique, et exposées par un déléguer (findMany / create / update / upsert / delete). Prisma ne sert qu’à documenter le schéma.',
    files: ['src/lib/db.ts', 'prisma/schema.prisma'],
    touchpoints:
      'Ajouter une table → `TABLES` + le `CREATE TABLE` + une entrée dans l’objet retourné. Ajouter une colonne → `addColumnIfMissing(...)` en bas de `createSqliteClient()`. Cloisonner par compte → ajouter la table à `USER_SCOPED_TABLES`.',
  },
  {
    key: 'brain',
    title: 'Cerveau (intelligence locale)',
    match: ['cerveau', 'intelligence', 'brain', 'raisonnement', 'neurone', 'réponse', 'compréhension'],
    role:
      'Le cœur IA écrit à la main : `brain.ts` orchestre le tour de parole, `classifier.ts` + `neural.ts` forment le classifieur neuronal local, `ensemble.ts` fusionne les signaux, `responder.ts` met en forme, `deep-reasoner.ts` creuse les questions complexes.',
    files: [
      'src/lib/brain/brain.ts',
      'src/lib/brain/ensemble.ts',
      'src/lib/brain/classifier.ts',
      'src/lib/brain/neural.ts',
      'src/lib/brain/responder.ts',
      'src/lib/brain/deep-reasoner.ts',
    ],
    touchpoints:
      'Améliorer la compréhension → `classifier.ts` (motifs + poids). Améliorer le style → `responder.ts`. Améliorer le raisonnement → `deep-reasoner.ts`.',
  },
  {
    key: 'knowledge',
    title: 'Connaissances & mémoire',
    match: ['connaissance', 'mémoire', 'savoir', 'knowledge', 'mémoire longue', 'apprend'],
    role:
      'Deux niveaux : la banque intégrée `NEXUS_KNOWLEDGE` (savoir hors-ligne, dans le code) et la base `Knowledge`/`Memory` (apprise à l’usage, par compte). `searchKnowledgeBank()` fait le rapprochement sémantique.',
    files: [
      'src/lib/brain/knowledge-bank.ts',
      'src/lib/brain/memory-rules.ts',
      'src/app/api/knowledge/route.ts',
      'src/app/api/memory/route.ts',
    ],
    touchpoints:
      'Apprendre un fait durable à tout le monde → ajouter une entrée dans `NEXUS_KNOWLEDGE` (knowledge-bank.ts). Apprendre un fait à un compte → table `Knowledge`.',
  },
  {
    key: 'blueprint',
    title: 'Blueprints (schémas d’agents)',
    match: ['blueprint', 'schéma', 'canvas', 'nœud', 'workflow', 'noeud'],
    role:
      'Éditeur visuel + moteur d’exécution de graphes. Les nœuds (départ, règle, condition, cerveau, connaissance, outil, variable, webhook, réponse, fin) sont interprétés par `runBlueprintGraph()` avec anti-boucle et délai global.',
    files: [
      'src/lib/blueprint.ts',
      'src/app/api/blueprints/route.ts',
      'src/app/api/blueprints/test/route.ts',
      'src/components/nexus/BlueprintEditor.tsx',
    ],
    touchpoints:
      'Ajouter un type de nœud → `NodeKind` + l’exécuteur dans `runBlueprintGraph()` + l’icône dans `BlueprintEditor.tsx`.',
  },
  {
    key: 'apikeys',
    title: 'Clés API & chatbots revendables',
    match: ['clé', 'cle api', 'api key', 'chatbot', 'v1/chat', 'bearer', 'revendre', 'client'],
    role:
      'Une clé = un chatbot. Secret affiché une seule fois puis stocké en SHA-256, règles « quand tu lis X réponds Y », agent et blueprint liés, CORS, limite/minute, journal des appels.',
    files: [
      'src/lib/api-keys.ts',
      'src/lib/rules.ts',
      'src/app/api/keys/route.ts',
      'src/app/api/v1/chat/route.ts',
      'src/components/nexus/ApiKeysPanel.tsx',
    ],
    touchpoints:
      'Ajouter un comportement de clé → `ApiKeyConfig` (api-keys.ts) + `ApiKeysPanel.tsx` + le moteur dans `/api/v1/chat`. Ajouter un mode de correspondance → `src/lib/rules.ts`.',
  },
  {
    key: 'ui',
    title: 'Interface',
    match: ['interface', 'ui', 'sidebar', 'menu', 'accueil', 'hub', 'chat', 'panneau', 'design', 'couleur'],
    role:
      'AppShell + panneaux métier. `store.ts` (zustand, persisté) porte la vue, les conversations et les scènes ; `AppShell.tsx` compose la navigation ; `AgentChat.tsx` est le chat.',
    files: [
      'src/components/nexus/AppShell.tsx',
      'src/components/nexus/Hub.tsx',
      'src/components/nexus/AgentChat.tsx',
      'src/components/nexus/TeamPanel.tsx',
      'src/lib/store.ts',
    ],
    touchpoints:
      'Ajouter un écran → `ViewId` (nexus-types.ts) + `NAV_ITEMS` (AppShell.tsx) + le rendu dans `<main>`.',
  },
  {
    key: 'studios',
    title: 'Studios (code, image, 3D, vidéo)',
    match: ['studio', 'code studio', 'image', 'vidéo', '3d', 'éditeur'],
    role:
      'Quatre ateliers de création : CodeStudio (20 langages + aperçu), ImageStudio (retouche + art procédural), Studio3D (Three.js), VideoStudio (montage navigateur).',
    files: [
      'src/components/nexus/studios/CodeStudio.tsx',
      'src/components/nexus/studios/ImageStudio.tsx',
      'src/components/nexus/studios/Studio3D.tsx',
      'src/components/nexus/studios/VideoStudio.tsx',
    ],
    touchpoints: 'Ajouter un langage → la table des langages de `CodeStudio.tsx` + `codegen.ts`.',
  },
  {
    key: 'missions',
    title: 'Missions autonomes',
    match: ['mission', 'autonome', 'tâche', 'runner', 'arrière-plan'],
    role: 'Exécute des missions en arrière-plan, extrait des compétences et rédige un rapport.',
    files: ['src/lib/mission-runner.ts', 'src/app/api/missions/run/route.ts', 'src/components/nexus/MissionsPanel.tsx'],
    touchpoints: 'Ajouter une capacité de mission → `mission-runner.ts` (attention : requêtes à cloisonner par `userId`).',
  },
  {
    key: 'persona',
    title: 'Personnalisation du compte',
    match: ['personnalisation', 'ton', 'persona', 'instructions', 'prénom'],
    role: 'Construit le bloc de personnalisation injecté au cerveau à partir du profil du compte.',
    files: ['src/lib/persona.ts', 'src/app/api/auth/profile/route.ts'],
    touchpoints: 'Ajouter une préférence → `UserProfile` + `persona.ts` + `AccountPanel.tsx`.',
  },
  {
    key: 'dev',
    title: 'Espace développeur (lui-même)',
    match: ['dev', 'dashboard', 'développeur', 'site', 'espace dev'],
    role:
      'Dashboard technique, personnalisation du site depuis le web, explorateur de code, correctifs à valider, file d’améliorations, et moi-même (l’agent Dev).',
    files: [
      'src/lib/devbrain.ts',
      'src/lib/devfs.ts',
      'src/lib/dev-seed.ts',
      'src/lib/site-settings.ts',
      'src/components/nexus/DevDashboard.tsx',
      'src/components/nexus/DevAgentPanel.tsx',
    ],
    touchpoints:
      'Ajouter un outil de code → `devfs.ts`. Ajouter une intention → `detectIntent()` + son handler dans ce fichier.',
  },
]

/** Lignes de code réelles, par module (calculé à la demande). */
function moduleWeight(mod: ArchModule): number {
  let lines = 0
  for (const f of mod.files) {
    try {
      const abs = safePath(f)
      if (fs.existsSync(abs)) lines += fs.readFileSync(abs, 'utf8').split('\n').length
    } catch {
      /* fichier absent */
    }
  }
  return lines
}

/** Module le plus probable vu le message. */
function findModule(message: string): { mod: ArchModule; score: number } | null {
  const m = message.toLowerCase()
  let best: { mod: ArchModule; score: number } | null = null
  for (const mod of ARCHITECTURE) {
    let score = 0
    for (const kw of mod.match) {
      if (m.includes(kw)) score += kw.length >= 6 ? 3 : 2
    }
    if (score > 0 && (!best || score > best.score)) best = { mod, score }
  }
  return best
}

// ── Détection d'intention ────────────────────────────────────────────────────

const INTENT_RULES: { intent: DevIntent; words: string[]; weight?: number }[] = [
  { intent: 'apprendre', words: ['apprends', 'apprend', 'enseigne', 'mémorise', 'retiens que', 'sache que'], weight: 6 },
  { intent: 'audit', words: ['audit', 'état des lieux', 'bilan', 'fais le point', 'analyse le projet', 'passe en revue'], weight: 5 },
  { intent: 'optimiser', words: ['optimise', 'optimiser', 'performance', 'lent', 'lenteur', 'refactor', 'refactorise', 'allège', 'accélère'], weight: 5 },
  { intent: 'debug', words: ['bug', 'erreur', 'ne marche pas', 'ne fonctionne pas', 'cassé', 'corrige', 'répare', 'plante', 'crash', 'pourquoi'], weight: 4 },
  { intent: 'fonctionnalite', words: ['ajoute', 'ajouter', 'crée', 'créer', 'implémente', 'implémenter', 'nouvelle fonctionnalité', 'développe une', 'mets en place'], weight: 4 },
  { intent: 'intelligence', words: ['intelligence', 'plus intelligent', 'améliore nexus', 'améliorer nexus', 'qualité des réponses', 'mieux répondre', 'améliore les réponses'], weight: 5 },
  { intent: 'entrainement', words: ['entrainement', 'entraînement', 'entraîne', 'entraine', 'daemon', 'cycle', 'navigateur', 'bibliothèque', 'tourne la nuit', '24/24'], weight: 6 },
  { intent: 'verifier', words: ['vérifie', 'verifier', 'teste', 'tester', 'check', 'contrôle'], weight: 3 },
  { intent: 'chercher', words: ['cherche', 'trouve', 'où est', 'ou est', 'localise', 'montre-moi', 'quelle ligne'], weight: 3 },
  { intent: 'expliquer', words: ['explique', 'expliquer', 'comment fonctionne', 'c’est quoi', "c'est quoi", 'décris', 'présente'], weight: 3 },
]

export function detectIntent(message: string): DevIntent {
  const m = message.toLowerCase().trim()
  if (!m) return 'general'
  if (/^(salut|bonjour|hello|hey|coucou|yo|hi)\b/.test(m)) return 'aide'
  if (/^(aide|help|\?|que peux-tu faire|qui es-tu|tu fais quoi)/.test(m)) return 'aide'

  let best: { intent: DevIntent; score: number } | null = null
  for (const rule of INTENT_RULES) {
    let score = 0
    for (const w of rule.words) {
      if (m.includes(w)) score += rule.weight ?? 3
    }
    if (score > 0 && (!best || score > best.score)) best = { intent: rule.intent, score }
  }
  if (best) return best.intent

  // « où est géré X » / « cherche X » sans mot-clé explicite
  if (/(où|ou)\b.*(géré|defini|défini|codé|trouve)/.test(m)) return 'chercher'
  return 'general'
}

// ── Utilitaires ──────────────────────────────────────────────────────────────

function md(...blocks: string[]): string {
  return blocks.filter(Boolean).join('\n\n')
}

function codeBlock(lang: string, content: string): string {
  return `\`\`\`${lang}\n${content}\n\`\`\``
}

function fileLink(p: string, line?: number): string {
  return `\`${p}${line ? `:${line}` : ''}\``
}

// ── Fabrique de correctifs ───────────────────────────────────────────────────
// (déporté dans `devknowledge.ts` : partagé avec l'entraîneur sans cycle d'import)

export { buildKnowledgePatch, KNOWLEDGE_BANK_PATH, tsSingleQuote, tsTemplateLiteral } from './devknowledge'
import { buildKnowledgePatch, KNOWLEDGE_BANK_PATH, tsSingleQuote, tsTemplateLiteral } from './devknowledge'

/** Mots-clés normalisés (sans accents, sans bruit) pour une entrée de connaissance. */
function keywordsFrom(text: string, limit = 8): string[] {
  const stop = new Set([
    // articles, prépositions, pronoms
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'que', 'qui', 'quoi', 'pour', 'dans',
    'sur', 'avec', 'par', 'plus', 'pas', 'ce', 'cet', 'cette', 'mon', 'ma', 'mes', 'ton', 'ta', 'ses',
    'son', 'sa', 'je', 'tu', 'il', 'elle', 'nous', 'vous', 'ils', 'elles', 'au', 'aux', 'en', 'a', 'à',
    'sous', 'sans', 'tres', 'très', 'bien', 'tout', 'toute', 'toutes', 'tous', 'aussi', 'comme', 'quand',
    'alors', 'mais', 'ses', 'leur', 'leurs', 'est', 'sont', 'ete', 'été', 'etre', 'être', 'avoir',
    // verbes-outils et mots de liaison : ils polluent la correspondance
    'faut', 'doit', 'peut', 'fait', 'faire', 'faut', 'avant', 'apres', 'après', 'depuis',
    // mots de la consigne elle-même
    'nexus', 'dev', 'apprends', 'apprend', 'savoir', 'connais', 'retiens', 'enseigne',
  ])
  const words = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
  return [...new Set(words)].slice(0, limit)
}

/** Compte les entrées de la banque de connaissances intégrée. */
function knowledgeBankInfo(): { entries: number; topics: string[]; path: string } {
  const p = KNOWLEDGE_BANK_PATH
  try {
    const raw = fs.readFileSync(safePath(p), 'utf8')
    const entries = (raw.match(/^\s{2}\{\n\s{4}keywords:/gm) ?? []).length
    const topics = [...raw.matchAll(/keywords:\s*\[([^\]]+)\]/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.replace(/['"`\s]/g, ''))
      .filter((s) => s.length > 2)
    return { entries, topics: [...new Set(topics)].slice(0, 40), path: p }
  } catch {
    return { entries: 0, topics: [], path: p }
  }
}

/** Compte les lignes d'un fichier (0 si absent). */
function lineCount(rel: string): number {
  try {
    const abs = safePath(rel)
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8').split('\n').length : 0
  } catch {
    return 0
  }
}

/** Compteurs de la base, pour ancrer les diagnostics dans le réel. */
async function dbCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const tables = [
    'user', 'session', 'conversation', 'memory', 'knowledge', 'task',
    'agentProfile', 'agentGroup', 'accountConnection', 'blueprint', 'apiKey', 'apiKeyLog',
  ] as const
  for (const t of tables) {
    try {
      out[t] = await (db as unknown as Record<string, { count: () => Promise<number> }>)[t].count()
    } catch {
      out[t] = 0
    }
  }
  return out
}

/**
 * Sujets mal couverts : un journal d'appels qui renvoie LA MÊME réponse à des
 * messages différents trahit un repli (ou une règle trop large). C'est le
 * signal le plus fiable pour savoir quoi améliorer.
 */
export async function findWeakSpots(): Promise<{ reply: string; count: number; examples: string[] }[]> {
  try {
    const logs = await db.apiKeyLog.findMany({ orderBy: { createdAt: 'desc' }, take: 400 })
    const byReply = new Map<string, Set<string>>()
    for (const l of logs ?? []) {
      const reply = String((l as { reply?: unknown }).reply ?? '').trim()
      const msg = String((l as { message?: unknown }).message ?? '').trim()
      if (!reply || !msg) continue
      if (!byReply.has(reply)) byReply.set(reply, new Set())
      byReply.get(reply)!.add(msg)
    }
    return [...byReply.entries()]
      .filter(([, msgs]) => msgs.size >= 2)
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 5)
      .map(([reply, msgs]) => ({ reply: reply.slice(0, 180), count: msgs.size, examples: [...msgs].slice(0, 4) }))
  } catch {
    return []
  }
}

// ── Handlers ─────────────────────────────────────────────────────────────────

function handleHelp(): DevTurnResult {
  return {
    intent: 'aide',
    thoughts: ['Message d’accueil de l’agent Dev.'],
    files: [],
    tasks: [],
    reply: md(
      '**Dev, l’ingénieur interne de NEXUS.** Je lis le code réel du projet, je diagnostique, et je te propose des correctifs que tu valides.\n\n' +
        'Je suis le seul agent à avoir accès aux sources — et uniquement depuis ce compte.',
      '### Ce que je sais faire\n' +
        '- 🔍 **Auditer** — « fais un audit du projet », « état des lieux »\n' +
        '- 🧠 **Améliorer l’intelligence** — « améliore l’intelligence », « comment rendre NEXUS plus pertinent »\n' +
        '- 📚 **Apprendre un fait** — « apprends à NEXUS que notre support répond en 24 h »\n' +
        '- 🔎 **Chercher** — « où est gérée l’authentification ? », « cherche ownerGuard »\n' +
        '- 📖 **Expliquer** — « explique-moi le cerveau », « comment marchent les blueprints »\n' +
        '- 🐛 **Diagnostiquer** — « pourquoi les réponses sont génériques ? », « bug sur les clés API »\n' +
        '- ⚡ **Optimiser** — « optimise les performances », « quel fichier est trop lourd ? »\n' +
        '- 🛠️ **Concevoir** — « ajoute un système de notifications »',
        '- 🎓 **S’entraîner** — « où en est ton entraînement ? », « entraîne-toi sur les bases de SQLite »\n\n' +
        'Je tourne **24 h/24** : entre deux cycles, mon daemon choisit un objectif, navigue avec **mon propre navigateur**, ' +
        'extrait le savoir, le rédige, le note, et le dépose en correctif. Les trous que je mesure chez NEXUS deviennent ' +
        'mes prochains objectifs — et chaque cycle m’apprend **quelles sources rapportent le plus**.',
      'Chaque correctif que je propose apparaît dans l’onglet **Correctifs** : tu le relis, tu l’appliques d’un clic, et une sauvegarde automatique est faite avant l’écriture.'
    ),
  }
}

function handleAudit(counts: Record<string, number>): DevTurnResult {
  const stats = projectStats()
  const todos = searchCode(TODO_RE, { regex: true, max: 30 })
  const weakest = [...stats.biggest].slice(0, 3)
  const analyses = weakest
    .map((f) => {
      try {
        return analyzeFile(f.path)
      } catch {
        return null
      }
    })
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  const tasks: DevTaskDraft[] = []
  if (stats.biggest[0] && stats.biggest[0].lines > 1200) {
    tasks.push({
      title: `Découper ${path.basename(stats.biggest[0].path)}`,
      detail: `${stats.biggest[0].lines} lignes dans un seul fichier : lisibilité et maintenance en souffrance.`,
      category: 'code',
      priority: 'normale',
    })
  }
  if (todos.length >= 5) {
    tasks.push({
      title: `Traiter ${todos.length} TODO/FIXME`,
      detail: 'Le repérage se fait par recherche de motifs dans le code.',
      category: 'code',
      priority: 'basse',
    })
  }
  for (const a of analyses) {
    for (const w of a.warnings.slice(0, 1)) {
      tasks.push({ title: `${a.path} — ${w}`, detail: `Signalé par l’analyse statique.`, category: 'code', priority: 'basse' })
    }
  }

  const folders = stats.byFolder
    .slice(0, 8)
    .map((f) => `| \`${f.folder}\` | ${f.files} | ${f.lines.toLocaleString('fr-FR')} |`)
    .join('\n')

  return {
    intent: 'audit',
    thoughts: [
      'Comptage des fichiers et des lignes du projet…',
      'Recherche des TODO/FIXME laissés dans le code…',
      'Analyse statique des trois plus gros fichiers…',
      'Lecture des compteurs de la base de données…',
    ],
    files: analyses.map((a) => ({ path: a.path, note: `${a.lines} lignes — ${a.warnings.length} alerte(s)` })),
    tasks: tasks.slice(0, 6),
    reply: md(
      `## Audit de NEXUS\n\n**${stats.files} fichiers** · **${stats.lines.toLocaleString('fr-FR')} lignes** · ${(stats.bytes / 1024 / 1024).toFixed(2)} Mo de code source.`,
      '### Répartition\n| Dossier | Fichiers | Lignes |\n|---|---:|---:|\n' + folders,
      '### Les plus gros fichiers\n' +
        stats.biggest
          .slice(0, 8)
          .map((f) => `- ${fileLink(f.path)} — **${f.lines.toLocaleString('fr-FR')} lignes**`)
          .join('\n'),
      analyses.length
        ? '### Signaux de dette technique\n' +
            analyses
              .map((a) => `- ${fileLink(a.path)} : ${a.warnings.length ? a.warnings.join(' ') : 'aucune alerte majeure.'}`)
              .join('\n')
        : '',
      todos.length
        ? `### TODO / FIXME en attente (${todos.length})\n` +
            todos
              .slice(0, 12)
              .map((t) => `- ${fileLink(t.path, t.line)} — ${t.text.replace(/^(\/\/|\/\*|\*)\s*/, '').slice(0, 100)}`)
              .join('\n')
        : '### TODO / FIXME\nAucun marqueur laissé dans le code. 👍',
      '### État de la base\n' +
        `| Table | Lignes |\n|---|---:|\n` +
        Object.entries(counts)
          .map(([k, v]) => `| \`${k}\` | ${v} |`)
          .join('\n')
    ),
  }
}

function handleIntelligence(counts: Record<string, number>): DevTurnResult {
  const bank = knowledgeBankInfo()
  const brainFiles = [
    'src/lib/brain/brain.ts',
    'src/lib/brain/classifier.ts',
    'src/lib/brain/knowledge-bank.ts',
    'src/lib/brain/responder.ts',
    'src/lib/brain/deep-reasoner.ts',
    'src/lib/brain/ensemble.ts',
    'src/lib/brain/neural.ts',
  ]
  const table = brainFiles
    .map((f) => `| ${fileLink(f)} | ${lineCount(f).toLocaleString('fr-FR')} |`)
    .join('\n')

  const tasks: DevTaskDraft[] = [
    {
      title: 'Étoffer la banque de connaissances intégrée',
      detail: `${bank.entries} entrées servies hors-ligne. Chaque entrée ajoutée = un sujet de moins qui part en réponse générique.`,
      category: 'intelligence',
      priority: 'haute',
    },
    {
      title: 'Réduire les réponses de repli',
      detail: 'Repérer les sujets qui déclenchent le message de repli et leur ajouter une vraie réponse.',
      category: 'intelligence',
      priority: 'haute',
    },
    {
      title: 'Enrichir les motifs du classifieur',
      detail: 'Plus un motif est précis, moins l’intention est mal routée.',
      category: 'intelligence',
      priority: 'normale',
    },
  ]

  return {
    intent: 'intelligence',
    thoughts: [
      'Lecture de la banque de connaissances intégrée…',
      'Mesure des modules du cerveau…',
      'Comparaison avec les compteurs d’usage…',
    ],
    files: brainFiles.map((f) => ({ path: f, note: `${lineCount(f)} lignes` })),
    tasks,
    reply: md(
      '## Comment rendre NEXUS plus intelligent\n\n' +
        'NEXUS n’appelle aucun service externe : son intelligence est **la somme de ce qui est écrit ici**. ' +
        'Il y a donc quatre leviers, du plus rentable au plus coûteux.',
      '### 1. Le savoir (le levier n°1)\n' +
        `La banque intégrée contient **${bank.entries} entrées** (${fileLink(bank.path)}). ` +
        'Chaque entrée est servie **hors-ligne et instantanément**. Un sujet absent = une réponse générique.\n\n' +
        '> Dis-moi **« apprends à NEXUS que … »** et je fabrique l’entrée, puis le correctif prêt à appliquer.\n\n' +
        `La base ` + '`Knowledge`' + ` contient elle **${counts.knowledge ?? 0} notes** apprises à l’usage.`,
      '### 2. La compréhension\n' +
        '`classifier.ts` route l’intention, `neural.ts` fournit la similarité sémantique, `ensemble.ts` fusionne les signaux. ' +
        'Un mal-routage en amont donne une bonne réponse… au mauvais endroit.',
      '### 3. Le raisonnement\n' +
        '`deep-reasoner.ts` creuse les questions complexes ; `math-engine.ts` (corrigé récemment) absorbe la ponctuation et les symboles × ÷.',
      '### 4. La formulation\n' +
        '`responder.ts` met en forme. C’est le fichier le moins risqué à retoucher et celui qui change le plus la perception de qualité.',
      '### Poids des modules du cerveau\n| Fichier | Lignes |\n|---|---:|\n' + table,
      '### Par où commencer\n' +
        tasks.map((t, i) => `${i + 1}. **${t.title}** — ${t.detail}`).join('\n')
    ),
  }
}

function handleApprendre(message: string): DevTurnResult {
  // « apprends à NEXUS que <sujet> » / « apprends : <texte> »
  const body = message
    .replace(/^\s*(dev\s*[,:]?\s*)?/i, '')
    .replace(/^\s*(apprends?|enseigne|mémorise|retiens|sache)\s*/i, '')
    .replace(/^\s*(à|a)\s+nexus\s*/i, '')
    .replace(/^\s*que\s*/i, '')
    .replace(/^[\s:;,-]+/, '')
    .trim()

  if (!body || body.length < 8) {
    return {
      intent: 'apprendre',
      thoughts: ['Demande d’apprentissage trop courte pour être exploitable.'],
      files: [],
      tasks: [],
      reply: md(
        'Il me manque la chose à apprendre.\n\n' +
          'Forme attendue : **« apprends à NEXUS que … »** suivi du fait, par exemple :\n' +
          '> apprends à NEXUS que le support répond sous 24 heures et qu’il faut ouvrir un ticket depuis le dashboard.'
      ),
    }
  }

  const subject = body.replace(/\s+/g, ' ').slice(0, 160)
  const keywords = keywordsFrom(body)
  const question = `Que sais-tu sur ${keywords.slice(0, 3).join(', ') || subject.slice(0, 40)} ?`
  const answer = [
    `**${subject.charAt(0).toUpperCase() + subject.slice(1)}**`,
    '',
    '_Savoir ajouté par l’agent Dev à la banque de connaissances intégrée._',
  ].join('\n')

  const patch = buildKnowledgePatch({ keywords, question, answer })

  return {
    intent: 'apprendre',
    thoughts: [
      'Extraction du fait à retenir…',
      'Fabrication des mots-clés déclencheurs…',
      'Génération du correctif ciblé sur la banque de connaissances…',
    ],
    files: [{ path: KNOWLEDGE_BANK_PATH, note: 'Banque intégrée — cible du correctif' }],
    patch: patch ?? undefined,
    tasks: [],
    reply: patch
      ? md(
          '## Correctif prêt à valider\n\n' +
            `J’ai fabriqué une entrée de connaissance pour : **${subject}**`,
          `**Fichier** ${fileLink(patch.filePath)}\n\n**Mots-clés déclencheurs** : ${keywords.map((k) => `\`${k}\``).join(', ')}`,
          '### Ce qui sera inséré\n' + codeBlock('ts', patch.after.slice(Math.max(0, patch.after.length - 900))),
          '> Le correctif est dans l’onglet **Correctifs**. Tu le relis, tu l’appliques, et une sauvegarde du fichier est faite automatiquement avant l’écriture.\n\n' +
            '> Après application, redémarre le serveur (`npm run dev`) pour que le module recharge la banque.'
        )
      : md(
          'Je n’ai pas pu fabriquer le correctif : l’ancre de la banque de connaissances n’a pas été trouvée de façon certaine.',
          `Fichier attendu : ${fileLink(KNOWLEDGE_BANK_PATH)}. Le fait restera noté : **${subject}**`
        ),
  }
}

function handleChercher(message: string): DevTurnResult {
  const stop = new Set(['cherche', 'trouve', 'trouver', 'ou', 'où', 'est', 'sont', 'dans', 'le', 'la', 'les', 'code', 'nexus', 'dev', 'quelle', 'quel', 'ligne', 'gere', 'géré', 'defini', 'défini', 'codé', 'moi', 'montre', 'je', 'veux', 'savoir'])
  const terms = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_$\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
  const queries = terms.slice(0, 3).length ? terms.slice(0, 3) : [message.slice(0, 20)]

  const hits = queries.flatMap((q) => searchCode(q, { max: 25 }))
  const seen = new Set<string>()
  const uniq = hits.filter((h) => {
    const k = `${h.path}:${h.line}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const byFile = new Map<string, typeof uniq>()
  for (const h of uniq) {
    if (!byFile.has(h.path)) byFile.set(h.path, [])
    byFile.get(h.path)!.push(h)
  }
  // Les fichiers les plus cités d'abord : c'est là que vit le sujet.
  const rankedFiles = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)

  const mod = findModule(message)

  return {
    intent: 'chercher',
    thoughts: [`Recherche de ${queries.map((q) => `« ${q} »`).join(', ')} dans les sources…`],
    files: rankedFiles.slice(0, 10).map(([p, hs]) => ({ path: p, note: `${hs.length} occurrence(s)` })),
    tasks: [],
    reply: md(
      `## Recherche : ${queries.map((q) => `\`${q}\``).join(', ')}\n\n${uniq.length} occurrence(s) dans ${byFile.size} fichier(s).`,
      mod
        ? `**Module concerné** : ${mod.mod.title} — ${mod.mod.role}\n\n**Fichiers clés** : ${mod.mod.files.map((f) => fileLink(f)).join(', ')}`
        : '',
      rankedFiles
        .slice(0, 10)
        .map(([p, hs]) => `### ${fileLink(p)}\n` + hs.slice(0, 6).map((h) => `- L${h.line} — \`${h.text.slice(0, 120)}\``).join('\n'))
        .join('\n\n'),
      uniq.length === 0
        ? '_Aucun résultat. Essaie un symbole exact (`ownerGuard`, `processTurn`, `NEXUS_KNOWLEDGE`) ou un nom de fichier._'
        : ''
    ),
  }
}

function handleExpliquer(message: string): DevTurnResult {
  const found = findModule(message)
  if (!found) return handleChercher(message)
  const { mod } = found
  const files: DevFileRef[] = []
  const details: string[] = []

  for (const f of mod.files.slice(0, 3)) {
    try {
      const view = readFile(f, 1, 45)
      files.push({ path: f, note: `${view.totalLines} lignes`, from: 1, to: Math.min(45, view.totalLines) })
      details.push(`### ${fileLink(f)} — ${view.totalLines} lignes\n${codeBlock(view.language, view.content.slice(0, 1400))}`)
    } catch {
      /* fichier absent */
    }
  }

  return {
    intent: 'expliquer',
    thoughts: [`Identification du module « ${mod.title} »…`, 'Lecture des fichiers principaux…'],
    files,
    tasks: [],
    reply: md(
      `## ${mod.title}\n\n${mod.role}`,
      `**Poids du module** : ${moduleWeight(mod).toLocaleString('fr-FR')} lignes réparties sur ${mod.files.length} fichier(s).`,
      '### Fichiers\n' + mod.files.map((f) => `- ${fileLink(f)} — ${lineCount(f).toLocaleString('fr-FR')} lignes`).join('\n'),
      '### Où intervenir\n' + mod.touchpoints,
      details.join('\n\n')
    ),
  }
}

function handleDebug(message: string): DevTurnResult {
  const stop = new Set(['pourquoi', 'bug', 'erreur', 'corrige', 'repare', 'répare', 'marche', 'fonctionne', 'nexus', 'dev', 'que', 'qui', 'quoi', 'est', 'pas', 'le', 'la', 'les', 'dans', 'sur', 'avec'])
  const terms = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_$\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stop.has(w))
    .slice(0, 4)

  const suspects = new Map<string, { line: number; text: string }[]>()
  for (const t of terms) {
    for (const h of searchCode(t, { max: 15 })) {
      if (!suspects.has(h.path)) suspects.set(h.path, [])
      suspects.get(h.path)!.push({ line: h.line, text: h.text })
    }
  }
  const ranked = [...suspects.entries()]
    .map(([p, hs]) => ({ path: p, hits: hs, score: hs.length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)

  const mod = findModule(message)

  return {
    intent: 'debug',
    thoughts: [
      `Extraction des symptômes : ${terms.join(', ') || 'aucun terme exploitable'}`,
      'Recoupement avec les sources…',
      'Classement des fichiers suspects par densité de correspondances…',
    ],
    files: ranked.map((r) => ({ path: r.path, note: `${r.hits.length} correspondance(s)` })),
    tasks: ranked.length
      ? [
          {
            title: `Investiguer : ${message.slice(0, 80)}`,
            detail: `Pistes principales : ${ranked.slice(0, 3).map((r) => r.path).join(', ')}`,
            category: 'code',
            priority: 'haute',
          },
        ]
      : [],
    reply: md(
      '## Diagnostic\n\n' +
        (mod ? `**Module probable** : ${mod.mod.title}.\n\n${mod.mod.role}\n\n` : '') +
        (ranked.length
          ? '### Fichiers suspects (par densité de correspondances)\n' +
            ranked
              .map((r) => `- ${fileLink(r.path)} — ${r.hits.length} piste(s) : ${r.hits.slice(0, 3).map((h) => `L${h.line}`).join(', ')}`)
              .join('\n')
          : '_Aucune piste trouvée avec ces termes. Donne-moi le message d’erreur exact ou le nom de la fonction concernée._'),
      ranked.length
        ? '### Extraits\n' +
            ranked
              .slice(0, 3)
              .map((r) => `**${fileLink(r.path)}**\n` + r.hits.slice(0, 3).map((h) => `- L${h.line} — \`${h.text.slice(0, 140)}\``).join('\n'))
              .join('\n\n')
        : '',
      '### Méthode\n' +
        '1. Reproduis le symptôme et note le message exact.\n' +
        '2. Ouvre le premier fichier suspect et pose un point d’arrêt sur la ligne indiquée.\n' +
        '3. Remonte la chaîne d’appels jusqu’à la source de la valeur fautive.\n' +
        '4. Dis-moi ce que tu trouves : je fabrique le correctif.'
    ),
  }
}

function handleOptimiser(message: string): DevTurnResult {
  const stats = projectStats()
  const heavy = stats.biggest.slice(0, 6)
  const analyses = heavy
    .map((f) => {
      try {
        return analyzeFile(f.path)
      } catch {
        return null
      }
    })
    .filter((a): a is NonNullable<typeof a> => Boolean(a))

  const tasks: DevTaskDraft[] = analyses
    .filter((a) => a.lines > 800)
    .map((a) => ({
      title: `Alléger ${a.path}`,
      detail: `${a.lines} lignes, ${a.functions.length} fonctions. Les plus grosses : ${a.functions.slice(0, 2).map((f) => `${f.name} (${f.lines})`).join(', ') || 'n/a'}`,
      category: 'performance',
      priority: a.lines > 1500 ? 'haute' : 'normale',
    }))

  return {
    intent: 'optimiser',
    thoughts: ['Mesure des fichiers les plus lourds…', 'Analyse statique des candidats…'],
    files: analyses.map((a) => ({ path: a.path, note: `${a.lines} lignes` })),
    tasks,
    reply: md(
      '## Optimisation\n\n' +
        `**${stats.files} fichiers**, **${stats.lines.toLocaleString('fr-FR')} lignes**. Voici où se concentre la complexité.`,
      '### Fichiers les plus lourds\n' +
        heavy.map((f) => `- ${fileLink(f.path)} — **${f.lines.toLocaleString('fr-FR')} lignes**`).join('\n'),
      '### Analyse\n' +
        analyses
          .map((a) => `**${fileLink(a.path)}** (${a.lines} lignes, ${a.functions.length} fonctions)\n- ${a.warnings.length ? a.warnings.join('\n- ') : 'Aucune alerte.'}`)
          .join('\n\n'),
      '### Priorités\n' +
        (tasks.length
          ? tasks.map((t, i) => `${i + 1}. **${t.title}** (${t.priority}) — ${t.detail}`).join('\n')
          : 'Aucun fichier ne dépasse le seuil critique. Le projet est structuré correctement.')
    ),
  }
}

function handleFonctionnalite(message: string): DevTurnResult {
  const found = findModule(message)
  const mod = found?.mod
  const baseFiles = mod?.files ?? ['src/lib/nexus-types.ts', 'src/lib/store.ts', 'src/components/nexus/AppShell.tsx']
  const routes = searchCode("export async function (GET|POST)", { regex: true, max: 0 })
  void routes

  return {
    intent: 'fonctionnalite',
    thoughts: [
      mod ? `Module cible identifié : ${mod.title}` : 'Aucun module évident — plan générique.',
      'Repérage des points d’ancrage…',
    ],
    files: baseFiles.map((f) => ({ path: f, note: 'point d’ancrage' })),
    tasks: [
      {
        title: `Implémenter : ${message.slice(0, 90)}`,
        detail: mod ? `Module concerné : ${mod.title}. ${mod.touchpoints}` : 'Module à déterminer.',
        category: 'code',
        priority: 'haute',
      },
    ],
    reply: md(
      '## Plan d’intervention\n\n' +
        (mod
          ? `**Module concerné** : ${mod.title}\n\n${mod.role}\n\n### Points d’ancrage\n${mod.touchpoints}`
          : 'Je n’ai pas rattaché la demande à un module existant : précise le domaine (auth, cerveau, clés API, interface…) et je te sors un plan ciblé.'),
      '### Fichiers à ouvrir\n' + baseFiles.map((f) => `- ${fileLink(f)} — ${lineCount(f).toLocaleString('fr-FR')} lignes`).join('\n'),
      '### Déroulé type pour une fonctionnalité NEXUS\n' +
        '1. **Type** — déclarer la forme dans `src/lib/nexus-types.ts`.\n' +
        '2. **Données** — table + DDL dans `src/lib/db.ts`, et cloisonnement par `userId` si la donnée appartient à un compte.\n' +
        '3. **Route** — `src/app/api/<nom>/route.ts`, protégée par `ownerGuard()` (ou `devGuard()` pour l’espace dev).\n' +
        '4. **État** — ajouter les champs au store zustand `src/lib/store.ts`.\n' +
        '5. **Interface** — panneau dans `src/components/nexus/`, entrée dans `NAV_ITEMS` (AppShell) et tuile dans `Hub.tsx`.\n' +
        '6. **Vérification** — `npx tsc --noEmit` puis `npm run build`.',
      '> Je ne fabrique pas de correctif pour une fonctionnalité entière : le risque d’écrire du code faux est trop grand. ' +
        'Je te donne le plan exact et les fichiers ; pour une modification **ciblée** (ajouter une entrée, une règle, un cas), je génère le correctif complet.'
    ),
  }
}

/**
 * L'agent Dev parle de son propre entraînement : où il en est, ce qu'il a
 * appris, et il accepte les demandes du type « entraîne-toi sur … ».
 */
async function handleEntrainement(message: string, userId: string): Promise<DevTurnResult> {
  const snap = await trainerSnapshot(userId)
  const { counts, score, lessons, config } = snap
  const daemon = getDaemonState()

  // « entraîne-toi sur X » → objectif prioritaire, le daemon s'en charge.
  const m = message.match(/(?:entraine|entraîne)[- ]toi sur (.+)$/i)
  if (m && m[1] && m[1].trim().length > 3) {
    const topic = m[1].trim().replace(/[.!?]+$/, '')
    await addObjective(userId, topic, topic, 'demande')
    return {
      intent: 'entrainement',
      thoughts: ['Demande d’entraînement explicite…', 'Création d’un objectif prioritaire…'],
      files: [],
      tasks: [],
      reply: md(
        `## Objectif ajouté : ${topic}`,
        'Il est placé **en tête du curriculum** (priorité haute). Mon daemon le prend au prochain cycle automatique' +
          (daemon?.minutesToNext ? ` — dans ${daemon.minutesToNext} minute(s) au plus.` : '.'),
        'Tu peux forcer l’entraînement tout de suite depuis l’onglet **Entraînement → Forcer un cycle**.'
      ),
    }
  }

  const pct = Math.round(score.score * 100)
  const bestLessons = lessons.slice(0, 5)
  const misses = score.misses.slice(0, 8)

  return {
    intent: 'entrainement',
    thoughts: [
      'Lecture de l’état du daemon…',
      'Mesure de la couverture de NEXUS…',
      'Relecture des leçons tirées des cycles précédents…',
    ],
    files: [
      { path: 'src/lib/devtrainer.ts', note: 'le moteur d’entraînement' },
      { path: 'src/lib/devdaemon.ts', note: 'la boucle 24 h/24' },
      { path: 'src/lib/devbrowser.ts', note: 'mon navigateur' },
    ],
    tasks: misses.length
      ? [
          {
            title: `Combler ${misses.length} lacune(s) mesurée(s)`,
            detail: misses.slice(0, 3).join(' · '),
            category: 'intelligence',
            priority: 'haute',
          },
        ]
      : [],
    reply: md(
      '## Mon entraînement',
      `**${config.enabled ? 'Actif' : 'En pause'}** — cadence ${config.intervalMin} min · ${counts.runs} cycle(s) lancé(s) · ${counts.objectivesDone}/${counts.objectives} objectif(s) traité(s).`,
      '### Ce que NEXUS sait maintenant\n' +
        '| Indicateur | Valeur |\n|---|---:|\n' +
        `| Couverture du banc d’épreuve | **${pct} %** (${score.covered}/${score.total}) |\n` +
        `| Savoirs récoltés | ${counts.itemsValid} actifs, ${counts.itemsCandidate} en attente |\n` +
        `| Pages lues par mon navigateur | ${counts.pages} (${counts.domains} domaine(s)) |\n` +
        `| Leçons tirées | ${counts.lessons} |\n` +
        `| Autonomie | ${config.autonomy === 'auto' ? 'j’applique les correctifs moi-même' : 'les correctifs attendent ta validation'} |`,
      misses.length
        ? '### Lacunes restantes\n' + misses.map((x) => `- « ${x} »`).join('\n')
        : '### Lacunes restantes\nAucune : NEXUS couvre tout le banc d’épreuve. Le curriculum va se renouveler.',
      bestLessons.length
        ? '### Ce que mes cycles m’ont appris\n' +
          'Je note à chaque cycle ce qui a marché, et ces notes orientent mes choix suivants :\n\n' +
          bestLessons.map((l) => `- **${l.kind}** \`${l.key}\` → ${l.value.toFixed(2)} (${l.samples} essai(s))`).join('\n')
        : '### Ce que mes cycles m’ont appris\nPas encore assez de cycles pour dégager une tendance.',
      '### Comment je m’améliore indirectement\n' +
        '1. Je **mesure** NEXUS sur un banc d’épreuve.\n' +
        '2. Les trous deviennent des **objectifs** de curriculum.\n' +
        '3. Je navigue avec **mon navigateur** (repli sur le corpus local si le réseau manque).\n' +
        '4. J’extrais, je rédige, je **note** la qualité de ce que j’ai produit.\n' +
        '5. Je retiens **quelle source et quelle catégorie** rapportent le plus — c’est ma mémoire d’entraîneur.\n' +
        '6. Comme NEXUS et moi partageons le même cerveau, ce que je lui apprends me rend meilleur aussi.\n\n' +
        '> Dis-moi **« entraîne-toi sur <sujet> »** pour ajouter un objectif à la main.'
    ),
  }
}

function countLines(arr: string[]): number {
  return arr?.length ?? 0
}

function handleGeneral(message: string): DevTurnResult {
  const found = findModule(message)
  const terms = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_$\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 4)
    .slice(0, 3)
  const hits = terms.flatMap((t) => searchCode(t, { max: 10 })).slice(0, 20)

  return {
    intent: 'general',
    thoughts: ['Aucune intention forte détectée — recherche large dans les sources.'],
    files: [...new Set(hits.map((h) => h.path))].slice(0, 8).map((p) => ({ path: p })),
    tasks: [],
    reply: md(
      '## Réponse Dev\n\n' +
        (found
          ? `Ta question touche au module **${found.mod.title}**.\n\n${found.mod.role}\n\n### Fichiers\n${found.mod.files.map((f) => `- ${fileLink(f)} — ${lineCount(f).toLocaleString('fr-FR')} lignes`).join('\n')}\n\n### Où intervenir\n${found.mod.touchpoints}`
          : 'Je n’ai pas rattaché ta demande à un module précis. Essaie « explique-moi le cerveau », « où est gérée l’authentification » ou « fais un audit du projet ».'),
      hits.length
        ? '### Pistes dans le code\n' + hits.slice(0, 12).map((h) => `- ${fileLink(h.path, h.line)} — \`${h.text.slice(0, 110)}\``).join('\n')
        : '',
      '\n\n---\n\n**Formulations les plus efficaces** : « audit du projet », « améliore l’intelligence », ' +
        '« apprends à NEXUS que … », « où est géré … », « explique-moi … », « optimise les performances ».'
    ),
  }
}

// ── Orchestration ────────────────────────────────────────────────────────────

/**
 * Joue un tour de parole de l'agent Dev.
 * Persiste les tâches et le correctif proposé, et renvoie la réponse formatée.
 */
export async function runDevTurn(
  message: string,
  history: DevMessage[],
  userId: string
): Promise<DevTurnResult> {
  const text = String(message ?? '').trim()
  const intent = detectIntent(text)
  const counts = await dbCounts()

  let result: DevTurnResult
  try {
    switch (intent) {
      case 'aide':
        result = handleHelp()
        break
      case 'audit':
        result = handleAudit(counts)
        break
      case 'intelligence':
        result = handleIntelligence(counts)
        break
      case 'apprendre':
        result = handleApprendre(text)
        break
      case 'chercher':
        result = handleChercher(text)
        break
      case 'expliquer':
        result = handleExpliquer(text)
        break
      case 'debug':
        result = handleDebug(text)
        break
      case 'optimiser':
        result = handleOptimiser(text)
        break
      case 'verifier':
        result = handleAudit(counts)
        result.intent = 'verifier'
        break
      case 'entrainement':
        result = await handleEntrainement(text, userId)
        break
      case 'fonctionnalite':
        result = handleFonctionnalite(text)
        break
      default:
        result = handleGeneral(text)
    }
  } catch (err) {
    result = {
      intent: 'general',
      thoughts: ['Une erreur est survenue pendant l’analyse.'],
      files: [],
      tasks: [],
      reply: md(
        '## Incident\n\n' +
          `L’analyse a échoué : ${err instanceof DevFsError ? err.message : err instanceof Error ? err.message : 'erreur inconnue'}`,
        'Rien n’a été modifié. Réessaie avec une formulation plus courte.'
      ),
    }
  }

  // Contexte conversationnel : si on me re-demande « et pour X ? », on garde le fil.
  if (history.length > 0 && intent === 'general' && history[history.length - 1]?.role === 'assistant') {
    result.thoughts.push('Réponse produite en tenant compte du tour précédent.')
  }

  // Persistance : correctif + tâches (pour l'onglet Correctifs / File d'améliorations)
  if (result.patch) {
    try {
      const row = await db.devPatch.create({
        data: {
          userId,
          title: result.patch.title,
          filePath: result.patch.filePath,
          before: result.patch.before,
          after: result.patch.after,
          rationale: result.patch.rationale,
          status: 'propose',
          origin: 'agent',
          appliedAt: null,
        },
      })
      result.patch.id = row?.id ? String(row.id) : undefined
    } catch {
      /* la proposition reste affichée même si la persistance échoue */
    }
  }

  for (const t of result.tasks) {
    try {
      const row = await db.devTask.create({
        data: {
          userId,
          title: t.title,
          detail: t.detail,
          category: t.category,
          priority: t.priority,
          status: 'a_faire',
          filePath: '',
        },
      })
      t.id = row?.id ? String(row.id) : undefined
    } catch {
      /* best-effort */
    }
  }

  return result
}
