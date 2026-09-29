// ─── NEXUS — Types partagés ──────────────────────────────────────────────────

export type ViewId = 'hub' | 'agent' | 'studio3d' | 'image' | 'video' | 'code' | 'connexions' | 'cerveaux'

// ─── Spécification de scène 3D ───────────────────────────────────────────────

export type PrimitiveType =
  | 'box'
  | 'sphere'
  | 'cylinder'
  | 'cone'
  | 'torus'
  | 'plane'
  | 'capsule'
  | 'dodecahedron'
  | 'icosahedron'
  | 'tetrahedron'
  | 'torusKnot'
  | 'ring'
  | 'octahedron'

export const PRIMITIVE_TYPES: PrimitiveType[] = [
  'box', 'sphere', 'cylinder', 'cone', 'torus', 'plane',
  'capsule', 'dodecahedron', 'icosahedron', 'tetrahedron',
  'torusKnot', 'ring', 'octahedron',
]

export const PRIMITIVE_LABELS: Record<PrimitiveType, string> = {
  box: 'Cube',
  sphere: 'Sphère',
  cylinder: 'Cylindre',
  cone: 'Cône',
  torus: 'Tore',
  plane: 'Plan',
  capsule: 'Capsule',
  dodecahedron: 'Dodécaèdre',
  icosahedron: 'Icosaèdre',
  tetrahedron: 'Tétraèdre',
  torusKnot: 'Nœud',
  ring: 'Anneau',
  octahedron: 'Octaèdre',
}

export interface SceneObject {
  id: string
  name: string
  type: PrimitiveType
  position: [number, number, number]
  rotation: [number, number, number] // radians
  scale: [number, number, number]
  color: string
  metalness: number
  roughness: number
  opacity: number
  emissive: string
  emissiveIntensity: number
  visible?: boolean // calque : masqué si false
  locked?: boolean // calque : non sélectionnable / non éditable si true
  segments?: number // lissage des géométries courbes (8–64)
  keyframes?: SceneKeyframe[] // animation clé par clé
}

export interface SceneKeyframe {
  t: number // 0 → 1 (proportion de la durée)
  position: [number, number, number]
  rotation: [number, number, number]
  scale: [number, number, number]
}

export type LightingPreset = 'studio' | 'day' | 'neon' | 'sunset'

export interface SceneSpec {
  name: string
  background: string
  ground: boolean
  groundColor: string
  objects: SceneObject[]
  lighting?: LightingPreset
  animationDuration?: number // secondes, défaut 6
}

// ─── Agent & conversations ───────────────────────────────────────────────────

export type AgentTool =
  | 'web_search'
  | 'generate_image'
  | 'create_3d_scene'
  | 'read_webpage'
  | 'generate_webpage'
  | 'generate_code'
  | 'generate_video'
  | 'save_knowledge'
  | 'search_knowledge'
  | 'update_task'
  | 'check_email' // boîte mail connectée (Gmail IMAP réel)
  | 'github_activity' // compte GitHub connecté (repos, notifications)
  | 'tiktok_activity' // compte TikTok relié (profil + dernières vidéos)
  | 'system' // événements internes (limite d'API, etc.)

export interface VideoArtifact {
  id: string
  url: string
  prompt: string
}

export interface AgentStep {
  id: string
  tool: AgentTool
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
}

export interface SourceItem {
  title: string
  url: string
  domain: string
  snippet: string
}

export interface ArtifactImage {
  id: string
  dataUrl: string // vide si expirée après rechargement → résolue via runtimeImages
  prompt: string
}

export interface CodeArtifact {
  name: string
  files: CodeFiles
}

/**
 * PROPOSITION de code d'un agent : il ne touche JAMAIS au code de
 * l'utilisateur directement — il propose, l'utilisateur relit le diff,
 * et seules les propositions VALIDÉES modifient les fichiers du Studio Code.
 */
export interface CodeProposal {
  id: string
  agentName: string
  agentEmoji: string
  title: string
  note: string // explication des changements proposés
  base: CodeFiles // le code actuel de l'utilisateur (référence du diff)
  proposed: CodeFiles // la version proposée
  at: number
}

/** Qui parle dans une bulle de discussion multi-agents (null = NEXUS lui-même). */
export interface SpeakerIdentity {
  id: string
  name: string
  emoji: string
  color: string
}

/**
 * Destinataire d'une discussion choisie dans le sélecteur du chat :
 * - nexus  : NEXUS seul (globale, sans agents)
 * - agent  : discussion privée avec UN agent (son prompt personnel pilote la réponse)
 * - all    : table ronde avec tous les agents actifs + synthèse
 * - group  : table ronde avec les membres d'un groupe + synthèse
 * - bureau : BUREAU — les agents réfléchissent ensemble en coulisses (parallèle),
 *            et NEXUS livre UNE SEULE réponse consolidée (groupId optionnel = bureau d'un groupe)
 */
export type ChatTarget =
  | { kind: 'nexus' }
  | { kind: 'agent'; agentId: string }
  | { kind: 'all' }
  | { kind: 'group'; groupId: string }
  | { kind: 'bureau'; groupId?: string }

/** Une contribution VERBATIM d'un agent au Bureau (visible en entier). */
export interface DeliberationEntry {
  name: string
  emoji: string
  color: string
  text: string // texte complet, JAMAIS tronqué
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  steps: AgentStep[]
  sources: SourceItem[]
  images: ArtifactImage[]
  scene: SceneSpec | null
  code: CodeArtifact | null
  videos: VideoArtifact[]
  thought: string
  expiredImages: boolean
  createdAt: number
  pending?: boolean
  speaker?: SpeakerIdentity | null // bulle multi-agents : l'agent qui répond
  target?: string // pour un message utilisateur : destinataire (« Nova », « Groupe Recherche »…)
  deliberation?: DeliberationEntry[] // BUREAU : tout ce que les agents ont échangé, mot pour mot
}

/** Page réellement lue par l'agent (vue « navigateur de NEXUS »). */
export interface BrowsedPage {
  url: string
  title: string
  text: string
  screenshot?: string // capture d'écran réelle (dataUrl JPEG) — session uniquement
  at: number
}

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ─── Événements SSE de l'agent ───────────────────────────────────────────────

export type AgentEvent =
  | { type: 'step'; id: string; tool: AgentTool; label: string; detail: string; status: 'running' | 'done' | 'error' }
  | { type: 'token'; content: string }
  | { type: 'deliberation'; entries: DeliberationEntry[] } // BUREAU : les échanges complets de l'équipe
  | { type: 'proposal'; proposal: CodeProposal } // proposition de code à valider (Studio Code)
  | { type: 'image'; id: string; dataUrl: string; prompt: string }
  | { type: 'scene'; scene: SceneSpec }
  | { type: 'code'; code: CodeArtifact }
  | { type: 'video'; id: string; url: string; prompt: string }
  | { type: 'webpage'; url: string; title: string; text: string; screenshot?: string }
  | { type: 'thought'; text: string }
  | { type: 'agent_thought'; name: string; emoji: string; color: string; text: string } // pensée EN DIRECT d'un agent (cérébraux 3D) — collectif en parallèle
  | { type: 'speaker'; id: string; name: string; emoji: string; color: string } // multi-agents : la bulle suivante appartient à cet agent
  | { type: 'task'; name: string; status: string; note: string }
  | { type: 'sources'; sources: SourceItem[] }
  | { type: 'knowledge'; title: string; category: string }
  | { type: 'meta'; title?: string; memoryAdded?: number; knowledgeAdded?: number }
  | { type: 'ping' }
  | { type: 'done' }
  | { type: 'error'; message: string }

// ─── Missions (bouton Task) ────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'running' | 'done' | 'blocked'

export interface TaskProgressEntry {
  at: number // epoch ms
  note: string
}

export interface NexusTask {
  id: string
  name: string
  duration: string
  objectives: string[]
  description: string
  status: TaskStatus
  progress: TaskProgressEntry[]
  report: string // rapport final markdown (vide tant que la mission n'est pas terminée)
  reportAt: number | null
  agents: string[] // ids des agents assignés ([] = équipe auto)
  createdAt: number
  updatedAt: number
}

/** Fabrique un NexusTask depuis la ligne brute de la DB (champs JSON à parser). */
export function parseTaskRow(row: {
  id: string
  name: string
  duration: string
  objectives: string
  description: string
  status: string
  progress: string
  report: string
  reportAt: Date | null
  agents: string
  createdAt: Date
  updatedAt: Date
}): NexusTask {
  const parseArr = (raw: string): string[] => {
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? arr.map(String).slice(0, 50) : []
    } catch {
      return []
    }
  }
  const parseProgress = (raw: string): TaskProgressEntry[] => {
    try {
      const arr = JSON.parse(raw) as unknown
      if (!Array.isArray(arr)) return []
      return arr
        .filter((p) => p && typeof p.note === 'string')
        .map((p) => ({
          at: typeof p.at === 'number' ? p.at : new Date(String(p.at)).getTime() || 0,
          note: String(p.note).slice(0, 600),
        }))
        .slice(0, 20)
    } catch {
      return []
    }
  }
  const status = ['todo', 'running', 'done', 'blocked'].includes(row.status)
    ? (row.status as TaskStatus)
    : 'todo'
  return {
    id: row.id,
    name: row.name,
    duration: row.duration,
    objectives: parseArr(row.objectives),
    description: row.description,
    status,
    progress: parseProgress(row.progress),
    report: row.report ?? '',
    reportAt: row.reportAt ? row.reportAt.getTime() : null,
    agents: parseArr(row.agents ?? '[]'),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

// ─── Équipe multi-agents ───────────────────────────────────────────────────

export type AgentRole = 'chercheur' | 'analyste' | 'redacteur' | 'specialiste' | 'codeur'

export const ROLE_LABELS: Record<AgentRole, string> = {
  chercheur: 'Chercheur',
  analyste: 'Analyste',
  redacteur: 'Rédacteur',
  specialiste: 'Spécialiste',
  codeur: 'Codeur',
}

/**
 * Outils autorisés pour la spécialisation « Codeur » : le studio 3D,
 * l'éditeur de code et le navigateur — RIEN d'autre (pas d'images,
 * pas de gestion de missions ni de mémoire).
 */
export const CODER_TOOLS: AgentTool[] = [
  'web_search', // navigateur : trouver des pages / docs
  'read_webpage', // navigateur : lire une page
  'generate_code', // éditeur de code
  'generate_webpage', // éditeur de code (pages web)
  'create_3d_scene', // studio 3D
]

export interface NexusAgent {
  id: string
  name: string
  emoji: string
  role: AgentRole
  description: string
  prompt: string // prompt système personnel (personnalité, ton, spécialité)
  specialties: string[]
  color: string
  enabled: boolean
  writer: boolean // ✍️ rédacteur du Bureau : rédige la réponse finale quand il participe
  createdAt: number
}

export interface NexusAgentGroup {
  id: string
  name: string
  emoji: string
  color: string
  members: string[] // ids des agents membres
  createdAt: number
  updatedAt: number
}

/** Fabrique un NexusAgentGroup depuis la ligne brute de la DB. */
export function parseAgentGroupRow(row: {
  id: string
  name: string
  emoji: string
  color: string
  members: string
  createdAt: Date
  updatedAt: Date
}): NexusAgentGroup {
  let members: string[] = []
  try {
    const arr = JSON.parse(row.members) as unknown
    if (Array.isArray(arr)) members = arr.map(String).slice(0, 24)
  } catch {
    /* vide */
  }
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji || '👥',
    color: row.color || '#38bdf8',
    members,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Fabrique un NexusAgent depuis la ligne brute de la DB. */
export function parseAgentRow(row: {
  id: string
  name: string
  emoji: string
  role: string
  description: string
  prompt: string
  specialties: string
  color: string
  enabled: boolean
  writer?: boolean
  createdAt: Date
}): NexusAgent {
  let specialties: string[] = []
  try {
    const arr = JSON.parse(row.specialties) as unknown
    if (Array.isArray(arr)) specialties = arr.map(String).slice(0, 8)
  } catch {
    /* vide */
  }
  const role: AgentRole = ['chercheur', 'analyste', 'redacteur', 'specialiste', 'codeur'].includes(row.role)
    ? (row.role as AgentRole)
    : 'specialiste'
  return {
    id: row.id,
    name: row.name,
    emoji: row.emoji || '🤖',
    role,
    description: row.description,
    prompt: row.prompt ?? '',
    specialties,
    color: row.color || '#a78bfa',
    enabled: row.enabled,
    writer: row.writer ?? false,
    createdAt: row.createdAt.getTime(),
  }
}

// ─── Mémoire longue terme ───────────────────────────────────────────────

export interface MemoryItem {
  id: string
  content: string
  kind: 'fact' | 'preference' | 'project' | 'person' | 'other'
  source: 'auto' | 'manual'
  createdAt: number
}

export interface CodeFiles {
  html: string
  css: string
  js: string
  language?: string // 'web' (défaut) ou 'python' | 'javascript' | 'lua' | …
  filename?: string // ex: main.py — mode script uniquement
}

// ─── Base de connaissances ─────────────────────────────────────────────────

export interface KnowledgeItem {
  id: string
  title: string
  content: string
  category: string // chemin hiérarchique ex: "Programmation/Python"
  tags: string[]
  links: string[] // titres des notes liées
  source: 'manual' | 'agent'
  createdAt: number
  updatedAt: number
}

/** Fabrique un KnowledgeItem depuis la ligne brute de la DB (champs JSON à parser). */
export function parseKnowledgeRow(row: {
  id: string
  title: string
  content: string
  category: string
  tags: string
  links: string
  source: string
  createdAt: Date
  updatedAt: Date
}): KnowledgeItem {
  const parseArr = (raw: string): string[] => {
    try {
      const arr = JSON.parse(raw) as unknown
      return Array.isArray(arr) ? arr.map(String).slice(0, 12) : []
    } catch {
      return []
    }
  }
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category || 'Général',
    tags: parseArr(row.tags),
    links: parseArr(row.links),
    source: row.source === 'agent' ? 'agent' : 'manual',
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  }
}

/** Extensions de fichiers pour les langages de scripts connus. */
export const SCRIPT_EXTENSIONS: Record<string, string> = {
  python: 'py',
  javascript: 'js',
  typescript: 'ts',
  lua: 'lua',
  csharp: 'cs',
  java: 'java',
  cpp: 'cpp',
  c: 'c',
  go: 'go',
  rust: 'rs',
  bash: 'sh',
  html: 'html',
  sql: 'sql',
  glsl: 'glsl',
  ruby: 'rb',
  php: 'php',
  swift: 'swift',
  kotlin: 'kt',
  yaml: 'yml',
  json: 'json',
  markdown: 'md',
}

/**
 * Langages proposés dans l'éditeur de code (« + Nouveau script ») :
 * le Studio Code n'est plus limité aux pages web — 20 langages disponibles,
 * chacun avec un mini-gabarit de démarrage.
 */
export interface EditorLanguage {
  id: string
  label: string
  ext: string
  emoji: string
  stub: string
}

export const EDITOR_LANGUAGES: EditorLanguage[] = [
  { id: 'python', label: 'Python', ext: 'py', emoji: '🐍', stub: '# Script Python\ndef main():\n    print("Bonjour NEXUS !")\n\n\nif __name__ == "__main__":\n    main()\n' },
  { id: 'javascript', label: 'JavaScript', ext: 'js', emoji: '🟨', stub: '// Script JavaScript\nfunction main() {\n  console.log("Bonjour NEXUS !");\n}\n\nmain();\n' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', emoji: '🔷', stub: '// Script TypeScript\nfunction main(): void {\n  console.log("Bonjour NEXUS !");\n}\n\nmain();\n' },
  { id: 'lua', label: 'Lua / Roblox', ext: 'lua', emoji: '🎮', stub: '-- Script Roblox (Luau)\nlocal function main()\n\tprint("Bonjour NEXUS !")\nend\n\nmain()\n' },
  { id: 'glsl', label: 'Shader GLSL', ext: 'glsl', emoji: '✨', stub: '// Shader fragment GLSL\nprecision highp float;\n\nvoid main() {\n\tgl_FragColor = vec4(0.65, 0.55, 0.98, 1.0);\n}\n' },
  { id: 'csharp', label: 'C#', ext: 'cs', emoji: '🎯', stub: '// Script C#\nusing System;\n\nclass Program {\n\tstatic void Main() {\n\t\tConsole.WriteLine("Bonjour NEXUS !");\n\t}\n}\n' },
  { id: 'java', label: 'Java', ext: 'java', emoji: '☕', stub: '// Script Java\npublic class Main {\n\tpublic static void main(String[] args) {\n\t\tSystem.out.println("Bonjour NEXUS !");\n\t}\n}\n' },
  { id: 'cpp', label: 'C++', ext: 'cpp', emoji: '⚙️', stub: '// Script C++\n#include <iostream>\n\nint main() {\n\tstd::cout << "Bonjour NEXUS !" << std::endl;\n\treturn 0;\n}\n' },
  { id: 'c', label: 'C', ext: 'c', emoji: '🔩', stub: '/* Script C */\n#include <stdio.h>\n\nint main(void) {\n\tprintf("Bonjour NEXUS !\\n");\n\treturn 0;\n}\n' },
  { id: 'go', label: 'Go', ext: 'go', emoji: '🐹', stub: '// Script Go\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Bonjour NEXUS !")\n}\n' },
  { id: 'rust', label: 'Rust', ext: 'rs', emoji: '🦀', stub: '// Script Rust\nfn main() {\n    println!("Bonjour NEXUS !");\n}\n' },
  { id: 'bash', label: 'Bash', ext: 'sh', emoji: '🐚', stub: '#!/bin/bash\n# Script Bash\necho "Bonjour NEXUS !"\n' },
  { id: 'sql', label: 'SQL', ext: 'sql', emoji: '🗄️', stub: '-- Requête SQL\nSELECT id, name\nFROM users\nORDER BY id;\n' },
  { id: 'ruby', label: 'Ruby', ext: 'rb', emoji: '💎', stub: '# Script Ruby\ndef main\n  puts "Bonjour NEXUS !"\nend\n\nmain\n' },
  { id: 'php', label: 'PHP', ext: 'php', emoji: '🐘', stub: '<?php\n// Script PHP\necho "Bonjour NEXUS !";\n' },
  { id: 'swift', label: 'Swift', ext: 'swift', emoji: '🍎', stub: '// Script Swift\nprint("Bonjour NEXUS !")\n' },
  { id: 'kotlin', label: 'Kotlin', ext: 'kt', emoji: '🟪', stub: '// Script Kotlin\nfun main() {\n    println("Bonjour NEXUS !")\n}\n' },
  { id: 'yaml', label: 'YAML', ext: 'yml', emoji: '📄', stub: '# Configuration YAML\nname: nexus\nversion: 1\n' },
  { id: 'json', label: 'JSON', ext: 'json', emoji: '🧾', stub: '{\n  "nom": "nexus",\n  "version": 1\n}\n' },
  { id: 'markdown', label: 'Markdown', ext: 'md', emoji: '📝', stub: '# Document\n\nÉcris ici.\n' },
]

/** Connexions de comptes personnelles supportées. */
export type ConnectionProvider = 'gmail' | 'github' | 'discord' | 'tiktok'

export const CONNECTION_PROVIDERS: { id: ConnectionProvider; label: string; emoji: string; hint: string; secretLabel: string; handleLabel: string }[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    emoji: '📧',
    hint: 'Adresse Gmail + mot de passe d\'application (compte Google → Sécurité → Mots de passe d\'application). Tes agents pourront LIRE tes derniers mails.',
    secretLabel: 'Mot de passe d\'application (16 caractères)',
    handleLabel: 'Adresse Gmail',
  },
  {
    id: 'github',
    label: 'GitHub',
    emoji: '🐙',
    hint: 'Personal Access Token (GitHub → Settings → Developer settings → Tokens). Tes agents pourront voir tes repos, notifications et activité.',
    secretLabel: 'Personal Access Token (ghp_…)',
    handleLabel: 'Nom d\'utilisateur (optionnel)',
  },
  {
    id: 'discord',
    label: 'Discord',
    emoji: '💬',
    hint: 'Token de bot (Discord Developer Portal → Bot → Token). Vérification RÉELLE via l\'API Discord.',
    secretLabel: 'Token du bot',
    handleLabel: 'Nom du bot (optionnel)',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    emoji: '🎵',
    hint: 'Ton @pseudo TikTok (profil public) — aucun mot de passe requis. Tes agents suivront ton profil et tes dernières vidéos.',
    secretLabel: 'Secret (optionnel — laisse vide)',
    handleLabel: 'Ton @pseudo TikTok',
  },
]

/** Connexion de compte telle que renvoyée au client (secret TOUJOURS masqué). */
export interface AccountConnectionInfo {
  id: string
  provider: ConnectionProvider
  handle: string
  status: 'connected' | 'error'
  note: string
  secretMask: string // ex: "…abcd" — jamais le secret complet
  createdAt: number
}

// Registre mémoire des images générées (session uniquement, pleine qualité)
export const runtimeImages = new Map<string, string>()

// Registre des vignettes persistées : les images générées restent visibles
// dans l'historique après rechargement (léger : JPEG 384px en localStorage)
export const thumbnailRegistry = new Map<string, string>()

export function loadThumbnails() {
  try {
    const raw = localStorage.getItem('nexus-thumbnails')
    if (!raw) return
    const entries = JSON.parse(raw) as [string, string][]
    for (const [k, v] of entries) thumbnailRegistry.set(k, v)
  } catch {
    /* registre corrompu : ignoré */
  }
}

export function persistThumbnails() {
  try {
    const entries = Array.from(thumbnailRegistry.entries()).slice(-40)
    localStorage.setItem('nexus-thumbnails', JSON.stringify(entries))
  } catch {
    /* quota dépassé : on garde le registre en mémoire */
  }
}

/** Réduit une image dataUrl en vignette JPEG légère (client uniquement). */
export function makeThumbnail(dataUrl: string, max = 384): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const ratio = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * ratio))
        canvas.height = Math.max(1, Math.round(img.height * ratio))
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(dataUrl)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}
