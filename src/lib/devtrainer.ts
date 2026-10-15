// ─── NEXUS — Entraîneur autonome (le cœur de l'agent Dev) ────────────────────
// Un cycle d'entraînement : mesurer NEXUS → choisir un objectif → naviguer avec
// SON navigateur → extraire le savoir → rédiger une entrée → l'évaluer → la
// promouvoir → revérifier. Et recommencer, 24 h/24.
//
// Le tout est 100 % local : extraction de phrases, lexique et scoring maison.
// Aucun LLM, aucune API. Quand le réseau manque, l'entraîneur bascule sur le
// corpus local (le code et la documentation de NEXUS lui-même).

import { db } from './db'
import { browsePage, searchWeb, type DevPageRecord } from './devbrowser'
import { readFile, safePath, backupFile, writeGuarded, listTree } from './devfs'
import { extractKeySentences } from './brain/synthesize'
import { searchKnowledgeBank } from './brain/knowledge-bank'
import { stems } from './brain/text'
import { buildKnowledgePatch } from './devknowledge'
import { maybeRetrainModel, probeModel, validQuestions } from './devmodel'

// ── Configuration ────────────────────────────────────────────────────────────

export interface TrainerConfig {
  /** L'entraîneur tourne-t-il en arrière-plan ? */
  enabled: boolean
  /** Minutes entre deux cycles. */
  intervalMin: number
  /** `valide` = les correctifs attendent votre accord · `auto` = appliqués seuls. */
  autonomy: 'valide' | 'auto'
  /** Pages lues par cycle. */
  pagesPerCycle: number
  /** Score minimal (0–1) pour qu'une entrée soit retenue. */
  minScore: number
  /** Nombre maximal de cycles par 24 h (garde-fou). */
  maxCyclesPerDay: number
  /** Plage horaire silencieuse (heures locales, 0–23). from === to = aucune. */
  quietFrom: number
  quietTo: number
  sources: { web: boolean; local: boolean }
}

export const DEFAULT_TRAINER_CONFIG: TrainerConfig = {
  enabled: true,
  intervalMin: 90,
  autonomy: 'valide',
  pagesPerCycle: 3,
  minScore: 0.45,
  maxCyclesPerDay: 16,
  quietFrom: 2,
  quietTo: 6,
  sources: { web: true, local: true },
}

const CONFIG_KEY = 'dev.training'

export async function getTrainerConfig(): Promise<TrainerConfig> {
  try {
    const row = await db.siteSetting.findUnique({ where: { key: CONFIG_KEY } })
    const raw = String((row as { value?: unknown })?.value ?? '').trim()
    if (!raw) return DEFAULT_TRAINER_CONFIG
    const parsed = JSON.parse(raw) as Partial<TrainerConfig>
    return {
      ...DEFAULT_TRAINER_CONFIG,
      ...parsed,
      sources: { ...DEFAULT_TRAINER_CONFIG.sources, ...(parsed.sources ?? {}) },
    }
  } catch {
    return DEFAULT_TRAINER_CONFIG
  }
}

export async function saveTrainerConfig(config: Partial<TrainerConfig>): Promise<TrainerConfig> {
  const next: TrainerConfig = { ...(await getTrainerConfig()), ...config }
  const payload = JSON.stringify(next)
  const existing = await db.siteSetting.findUnique({ where: { key: CONFIG_KEY } })
  if (existing) {
    await db.siteSetting.update({ where: { key: CONFIG_KEY }, data: { value: payload } })
  } else {
    await db.siteSetting.create({ data: { key: CONFIG_KEY, value: payload, updatedBy: 'dev' } })
  }
  return next
}

// ── Curriculum ───────────────────────────────────────────────────────────────

/** Sujets de départ : l'entraîneur pioche ici quand il n'a rien de plus urgent. */
const SEED_CURRICULUM: { label: string; query: string; category: string }[] = [
  { label: 'Le fonctionnement d’un réseau de neurones', query: 'comment fonctionne un réseau de neurones artificiels', category: 'ia' },
  { label: 'Les bases de SQLite', query: 'sqlite index transactions performances bonnes pratiques', category: 'technique' },
  { label: 'La sécurité des API (CORS, rate limiting)', query: 'sécuriser une API REST CORS rate limiting', category: 'securite' },
  { label: 'Le fonctionnement du moteur JavaScript', query: 'moteur javascript boucle événements compilation JIT', category: 'technique' },
  { label: 'Les principes de l’apprentissage automatique', query: 'apprentissage automatique supervisé non supervisé surapprentissage', category: 'ia' },
  { label: 'L’architecture d’une application web moderne', query: 'architecture application web client serveur cache', category: 'technique' },
  { label: 'La gestion de la mémoire en informatique', query: 'gestion mémoire ram allocation garbage collector', category: 'technique' },
  { label: 'Le protocole HTTP et ses codes', query: 'protocole HTTP méthodes codes statut', category: 'technique' },
]

export async function ensureCurriculum(userId: string): Promise<number> {
  const rows = await db.trainingObjective.findMany({ where: { userId }, take: 200 }).catch(() => [])
  if (rows && rows.length >= 8) return 0
  let added = 0
  for (const seed of SEED_CURRICULUM) {
    const exists = (rows ?? []).some((r) => String(r.query) === seed.query)
    if (exists) continue
    await db.trainingObjective
      .create({
        data: {
          userId,
          label: seed.label,
          query: seed.query,
          category: seed.category,
          priority: 5,
          status: 'a_faire',
          attempts: 0,
          lastScore: 0,
          origin: 'auto',
        },
      })
      .catch(() => {})
    added++
  }
  return added
}

export async function addObjective(userId: string, label: string, query: string, category = 'culture') {
  return db.trainingObjective.create({
    data: {
      userId,
      label: label.slice(0, 200),
      query: query.slice(0, 300),
      category,
      priority: 8, // une objectif ajouté à la main passe devant
      status: 'a_faire',
      attempts: 0,
      lastScore: 0,
      origin: 'manuel',
    },
  })
}

/**
 * Choisit le prochain objectif.
 * Ordre : lacunes mesurées chez NEXUS > objectifs manuels > file automatique.
 */
async function pickObjective(userId: string): Promise<{ id: string; label: string; query: string; category: string } | null> {
  await ensureCurriculum(userId)
  const rows = await db.trainingObjective
    .findMany({ where: { userId, status: 'a_faire' }, take: 100 })
    .catch(() => [])
  const list = (rows ?? []).filter((r) => Number(r.attempts ?? 0) < 6)
  if (!list.length) return null

  // Les leçons apprises orientent le choix : une catégorie qui rapporte
  // davantage est tentée plus souvent.
  const lessons = await loadLessons(userId, 'categorie')
  const bonus = (category: string) => lessons.get(category) ?? 0

  const sorted = [...list].sort((a, b) => {
    const sa = Number(a.priority ?? 5) + bonus(String(a.category ?? '')) * 2 - Number(a.attempts ?? 0) * 0.4
    const sb = Number(b.priority ?? 5) + bonus(String(b.category ?? '')) * 2 - Number(b.attempts ?? 0) * 0.4
    return sb - sa
  })
  const best = sorted[0]
  if (!best) return null
  return { id: String(best.id), label: String(best.label), query: String(best.query), category: String(best.category ?? 'culture') }
}

// ── Leçons : comment l'entraîneur s'améliore lui-même ────────────────────────

type LessonKind = 'domaine' | 'categorie' | 'moteur'

async function loadLessons(userId: string, kind: LessonKind): Promise<Map<string, number>> {
  try {
    const rows = await db.trainingLesson.findMany({ where: { userId, kind }, take: 200 })
    const map = new Map<string, number>()
    for (const r of rows ?? []) {
      map.set(String(r.key), Number(r.value ?? 0))
    }
    return map
  } catch {
    return new Map()
  }
}

/**
 * Moyenne mobile : chaque résultat fait évoluer la note d'une clé.
 * C'est la mémoire de l'entraîneur — il privilégie ce qui a déjà marché.
 */
async function recordLesson(userId: string, kind: LessonKind, key: string, value: number, note = '') {
  if (!key) return
  try {
    const rows = await db.trainingLesson.findMany({ where: { userId, kind, key }, take: 1 })
    const existing = rows?.[0]
    if (existing) {
      const samples = Number(existing.samples ?? 0)
      const prev = Number(existing.value ?? 0)
      const next = (prev * samples + value) / (samples + 1)
      await db.trainingLesson.update({
        where: { id: String(existing.id) },
        data: { value: next, samples: samples + 1, ...(note ? { note } : {}) },
      })
    } else {
      await db.trainingLesson.create({ data: { userId, kind, key, value, samples: 1, note } })
    }
  } catch {
    /* best-effort */
  }
}

// ── Mesure : NEXUS sait-il répondre ? ────────────────────────────────────────

export interface NexusScore {
  covered: number
  total: number
  score: number
  misses: string[]
}

function lexicalHit(question: string, rows: { title: string; content: string }[]): boolean {
  const q = new Set(stems(question).filter((s) => s.length > 3))
  if (q.size === 0) return false
  for (const r of rows) {
    const hay = new Set(stems(`${r.title} ${r.content}`))
    let inter = 0
    for (const s of q) if (hay.has(s)) inter++
    if (inter >= 2) return true
  }
  return false
}

/**
 * Sonde NEXUS : pour chaque question du banc d'épreuve, regarde si la banque
 * intégrée ou les connaissances du compte savent répondre. C'est la note qui
 * pilote tout le reste — objectifs, leçons et mesure de progression.
 */
export async function probeNexus(userId: string, probes?: string[]): Promise<NexusScore> {
  let questions = probes?.filter(Boolean) ?? []
  if (!questions.length) {
    const items = await db.trainingItem
      .findMany({ where: { userId, status: 'valide' }, take: 25 })
      .catch(() => [])
    questions = (items ?? []).map((i) => String(i.question ?? '')).filter(Boolean)
  }
  if (!questions.length) {
    questions = SEED_CURRICULUM.slice(0, 8).map((s) => `C'est quoi ${s.label.toLowerCase()} ?`)
  }

  const knowledge = await db.knowledge.findMany({ where: { userId }, take: 300 }).catch(() => [])
  const notes = (knowledge ?? []).map((k) => ({ title: String(k.title ?? ''), content: String(k.content ?? '') }))

  let covered = 0
  const misses: string[] = []
  for (const q of questions) {
    const bank = searchKnowledgeBank(q, 1)
    const hit = (bank[0]?.score ?? 0) > 0.38 || lexicalHit(q, notes)
    if (hit) covered++
    else misses.push(q)
  }
  const total = questions.length || 1
  return { covered, total, score: covered / total, misses }
}

// ── Récolte du matériel ──────────────────────────────────────────────────────

interface Material {
  mode: 'web' | 'local'
  pages: DevPageRecord[]
  sources: string[]
}

/** Documents locaux exploitables quand le réseau manque. */
const LOCAL_DOCS = ['README.md', 'worklog.md', 'prisma/schema.prisma', 'src/lib/brain/knowledge-bank.ts']

function localCandidates(query: string): { path: string; score: number }[] {
  const terms = [...new Set(stems(query).filter((s) => s.length > 3))]
  if (!terms.length) return []
  // Un fichier ne compte que s'il partage une part réelle du vocabulaire de la
  // requête — un seul mot en commun donnerait des réponses hors sujet.
  const floor = Math.max(2, Math.ceil(terms.length * 0.25))
  const out: { path: string; score: number }[] = []
  for (const file of LOCAL_DOCS) {
    try {
      const view = readFile(file, 1, 4000)
      const hay = new Set(stems(view.content))
      let inter = 0
      for (const t of terms) if (hay.has(t)) inter++
      if (inter >= floor) out.push({ path: file, score: inter / terms.length })
    } catch {
      /* fichier absent */
    }
  }
  // Le code source n'est une source que s'il parle vraiment du sujet.
  for (const code of ['src/lib/brain/brain.ts', 'src/lib/memory-rules.ts']) {
    try {
      const view = readFile(code, 1, 4000)
      const hay = new Set(stems(view.content))
      let inter = 0
      for (const t of terms) if (hay.has(t)) inter++
      if (inter >= floor) out.push({ path: code, score: inter / terms.length })
    } catch {
      /* ignoré */
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3)
}


async function collectMaterial(
  objective: { query: string; label: string },
  userId: string,
  runId: string,
  config: TrainerConfig
): Promise<Material | null> {
  // 1. Le web d'abord — c'est là qu'est le savoir le plus large.
  if (config.sources.web) {
    const results = await searchWeb(objective.query, 6)
    if (results && results.length) {
      const pages: DevPageRecord[] = []
      const domains = await loadLessons(userId, 'domaine')
      const ordered = [...results].sort((a, b) => (domains.get(b.domain) ?? 0) - (domains.get(a.domain) ?? 0))
      for (const r of ordered.slice(0, config.pagesPerCycle)) {
        const outcome = await browsePage(r.url, { userId, runId, maxLen: 12_000 })
        if (outcome.ok && outcome.page) pages.push(outcome.page)
      }
      if (pages.length) {
        await recordLesson(userId, 'moteur', 'web', 1)
        await restoreOutOfSourceObjectives(userId)
        return { mode: 'web', pages, sources: pages.map((p) => p.domain).filter(Boolean) }
      }
      await recordLesson(userId, 'moteur', 'web', 0)
    } else {
      await recordLesson(userId, 'moteur', 'web', 0)
    }
  }

  // 2. Repli hors-ligne : le projet lui-même devient la source.
  if (config.sources.local) {
    const files = localCandidates(`${objective.label} ${objective.query}`)
    const pages: DevPageRecord[] = []
    for (const f of files) {
      try {
        const view = readFile(f.path, 1, 2500)
        if (!view.content.trim()) continue
        const record = await db.devPage.create({
          data: {
            userId,
            url: `local://${f.path}`,
            title: `${f.path}`,
            domain: 'projet',
            text: view.content,
            bytes: Buffer.byteLength(view.content),
            runId,
            origin: 'agent',
            hits: 0,
          },
        })
        pages.push({
          id: String(record?.id ?? ''),
          url: `local://${f.path}`,
          title: f.path,
          domain: 'projet',
          text: view.content,
          bytes: Buffer.byteLength(view.content),
          runId,
          origin: 'agent',
          hits: 0,
          fetchedAt: new Date(),
        })
      } catch {
        /* fichier illisible */
      }
    }
    if (pages.length) {
      await recordLesson(userId, 'moteur', 'local', 1)
      return { mode: 'local', pages, sources: ['projet'] }
    }
    await recordLesson(userId, 'moteur', 'local', 0)
  }

  return null
}

// ── Rédaction & évaluation ───────────────────────────────────────────────────

/**
 * Extraction de passages pour le corpus local (markdown et code).
 * `extractKeySentences` découpe à la ponctuation, ce qui mélange titres,
 * commandes et prose : on travaille donc ligne par ligne et on écarte le bruit.
 */
function extractLocalPassages(text: string, query: string, max: number): string[] {
  const qStems = queryStemsOf(query)
  if (!qStems.size) return []
  const passages: { text: string; cov: number }[] = []
  let fence = false

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (/^```/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    // Nettoyage des marqueurs markdown / commentaires de code.
    const clean = line
      .replace(/^\s*(?:[-*+]\s|#{1,6}\s|\d+[.)]\s|\/\/\s*|\*\s)*/, '')
      .replace(/[*_`]/g, '')
      .replace(/^\s*(?:[├└│─]+)\s*/, '')
      .trim()
    if (clean.length < 45 || clean.length > 400) continue
    const words = clean.split(/\s+/)
    if (words.length < 8) continue
    // Lignes de code, commandes et imports : pas de la matière encyclopédique.
    if (/^(npm|npx|yarn|bun|git|node|curl|import|export|const|let|var|function|return|if|for|await|=>|})/.test(clean)) continue
    if (/[{}<>]=|=>|\.ts\b|\.tsx\b|node_modules/.test(clean)) continue
    if (/^\|.*\|$/.test(clean)) continue
    // Champs de schéma Prisma (« userId String? ») : de la déclaration, pas du savoir.
    if (/^\w+\s+(String|Int|BigInt|Boolean|DateTime|Float|Json|Bytes)\??\s/.test(clean)) continue
    const cov = stemCoverage(qStems, clean)
    if (cov < 0.34) continue
    passages.push({ text: clean, cov })
  }

  passages.sort((a, b) => b.cov - a.cov)
  const kept: string[] = []
  const seenStems: Set<string>[] = []
  for (const p of passages) {
    const st = new Set(stems(p.text))
    const redundant = seenStems.some((prev) => {
      let inter = 0
      for (const w of st) if (prev.has(w)) inter++
      return inter / Math.min(st.size, prev.size) > 0.5
    })
    if (redundant) continue
    kept.push(p.text)
    seenStems.push(st)
    if (kept.length >= max) break
  }
  return kept
}

function buildQuestion(label: string, category: string, mode: 'web' | 'local'): string {
  const l = label.trim().replace(/\s+/g, ' ')
  if (/^(comment|pourquoi|quand|où|ou)\b/i.test(l)) return `${l.charAt(0).toUpperCase()}${l.slice(1)} ?`
  // Hors ligne, la seule source est le projet : on pose donc une question que
  // le projet peut réellement assumer, au lieu d'une définition générale.
  if (mode === 'local') return `Qu'est-ce que NEXUS contient sur « ${l.replace(/^(le|la|les|l')\s+/i, '')} » ?`
  return `C'est quoi ${l.replace(/^(le|la|les|l')\s+/i, '')} ?`
}

/** Part des radicaux de la requête réellement présents dans un texte (0 → 1). */
function stemCoverage(queryStems: Set<string>, text: string): number {
  if (!queryStems.size) return 0
  const hay = new Set(stems(text))
  let hits = 0
  for (const q of queryStems) if (hay.has(q)) hits++
  return hits / queryStems.size
}

/** Radicaux porteurs de sens d'une requête (mots-outils et radicaux courts exclus). */
function queryStemsOf(query: string): Set<string> {
  return new Set([...new Set(stems(query))].filter((s) => s.length > 3))
}

function buildAnswer(
  objective: string,
  pages: DevPageRecord[],
  mode: 'web' | 'local'
): { answer: string; sentences: string[]; coverage: number } {
  const qStems = queryStemsOf(objective)
  const picked: { text: string; domain: string }[] = []
  for (const p of pages) {
    const lines =
      mode === 'local' ? extractLocalPassages(p.text, objective, 6) : extractKeySentences(p.text, objective, 6)
    for (const s of lines) {
      // Garde-fou anti hors-sujet : le passage doit couvrir une part réelle du
      // vocabulaire de l'objectif, sinon c'est du bruit décoré.
      if (stemCoverage(qStems, s) < 0.3) continue
      picked.push({ text: s, domain: p.domain })
    }
    if (picked.length >= 12) break
  }
  if (!picked.length) return { answer: '', sentences: [], coverage: 0 }

  const seen = new Set<string>()
  const unique = picked.filter((p) => {
    const k = p.text.slice(0, 60).toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const body = unique
    .slice(0, 7)
    .map((p) => `- ${p.text} *[${p.domain}]*`)
    .join('\n')

  const domains = [...new Set(unique.map((p) => p.domain))].slice(0, 4)
  const sentences = unique.map((u) => u.text)
  const coverage = stemCoverage(qStems, sentences.join(' '))
  const origin = mode === 'web' ? `sources : ${domains.join(', ')}` : 'corpus du projet NEXUS'
  const answer = [body, '', `_Appris par l’entraînement NEXUS — ${origin}._`].join('\n')

  return { answer, sentences, coverage }
}

function scoreCandidate(input: {
  question: string
  answer: string
  sentences: string[]
  keywords: string[]
  sources: number
  coverage: number
  existing: { question: string; answer: string }[]
}): { score: number; reasons: string[] } {
  const reasons: string[] = []

  // Condition dure : si les phrases retenues ne parlent pas du sujet, on ne
  // publie rien — une connaissance hors sujet rend NEXUS moins fiable.
  if (input.coverage < 0.4) {
    return { score: 0, reasons: [`hors sujet (pertinence ${Math.round(input.coverage * 100)} % < 40 %)`] }
  }

  let score = 0

  // 1. Matière : combien de phrases exploitables ?
  const matter = Math.min(1, input.sentences.length / 3)
  score += matter * 0.4
  if (input.sentences.length < 2) reasons.push('trop peu de matière exploitable')

  // 2. Longueur de la réponse (ni vide, ni roman)
  const len = input.answer.length
  const lengthScore = len < 120 ? len / 120 : len > 4000 ? 0.6 : 1
  score += lengthScore * 0.2
  if (len < 120) reasons.push('réponse trop courte')

  // 3. Qualité des mots-clés
  const strong = input.keywords.filter((k) => k.length > 3).length
  score += Math.min(1, strong / 4) * 0.15
  if (strong < 2) reasons.push('mots-clés trop pauvres')

  // 4. Sources
  score += Math.min(1, input.sources / 2) * 0.1

  // 4 bis. Pertinence thématique : la part du vocabulaire de l'objectif
  // réellement couverte par la réponse.
  const relevance = Math.min(1, Math.max(0, (input.coverage - 0.4) / 0.45))
  score += relevance * 0.2
  if (input.coverage < 0.6) reasons.push(`pertinence thématique faible (${Math.round(input.coverage * 100)} %)`)

  // 5. Nouveauté : recouvrement avec l'existant (radicaux communs)
  const newStems = new Set(stems(`${input.question} ${input.sentences.join(' ')}`))
  let worst = 0
  for (const ex of input.existing) {
    const oldStems = new Set(stems(`${ex.question} ${ex.answer}`))
    let inter = 0
    for (const s of newStems) if (oldStems.has(s)) inter++
    const ratio = newStems.size ? inter / newStems.size : 0
    if (ratio > worst) worst = ratio
  }
  const novelty = 1 - Math.min(1, worst)
  score += novelty * 0.15
  if (novelty < 0.4) reasons.push('redondant avec une connaissance existante')

  return { score: Math.max(0, Math.min(1, score)), reasons }
}

// ── Journal ──────────────────────────────────────────────────────────────────

export interface CycleStep {
  at: number
  label: string
  detail: string
  status: 'ok' | 'warn' | 'error'
}

export interface CycleReport {
  runId: string
  objective: string
  mode: 'web' | 'local' | 'aucun'
  pages: number
  items: number
  scoreBefore: number
  scoreAfter: number
  steps: CycleStep[]
  error?: string
}

const EMPTY_STEPS: CycleStep[] = []

function parseSteps(raw: unknown): CycleStep[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? (arr as CycleStep[]) : []
  } catch {
    return []
  }
}

// ── Le cycle ─────────────────────────────────────────────────────────────────

export interface RunOptions {
  trigger?: 'auto' | 'manuel'
  objectiveId?: string
  onStep?: (step: CycleStep) => void
}

/**
 * Incrémente le compteur d'essais d'un objectif. Le client SQLite maison ne
 * gère pas `{ increment: n }`, on lit donc la valeur courante avant d'écrire.
 */
async function bumpAttempts(objectiveId: string, extra?: Record<string, unknown>): Promise<void> {
  try {
    const row = await db.trainingObjective.findUnique({ where: { id: objectiveId } })
    const current = Number(row?.attempts ?? 0)
    await db.trainingObjective.update({
      where: { id: objectiveId },
      data: { attempts: current + 1, lastRunAt: new Date(), ...(extra ?? {}) },
    })
  } catch {
    /* l'objectif a pu disparaître entre-temps */
  }
}

/**
 * Curriculum dérivé du projet. Hors ligne, c'est la seule matière que le corpus
 * local puisse réellement enseigner : plutôt que d'inventer une définition
 * générale, l'entraîneur apprend à NEXUS ce que contient son propre code.
 */
async function deriveProjectObjectives(userId: string): Promise<number> {
  const topics: { label: string; query: string }[] = []

  // 1. Les titres de la documentation du projet.
  for (const doc of ['README.md', 'worklog.md']) {
    try {
      const view = readFile(doc, 1, 6000)
      // Un commentaire shell (« # npm run dev ») ressemble à un titre markdown :
      // on ignore tout ce qui se trouve à l'intérieur d'un bloc de code.
      let inFence = false
      for (const line of view.content.split('\n')) {
        if (/^\s*```/.test(line)) {
          inFence = !inFence
          continue
        }
        if (inFence) continue
        const m = line.match(/^#{1,3}\s+(.+?)\s*$/)
        if (!m) continue
        const title = m[1].replace(/[*_`]/g, '').trim()
        // On écarte les intitulés procéduraux (« 2. Configurer la base ») et
        // les lignes de commande : ils n'enseignent rien, ils s'exécutent.
        if (/^\d+[.)]/.test(title)) continue
        if (/[#$]|\bnpm\b|\bnpx\b|\bgit\b/i.test(title)) continue
        if (title.length < 16 || title.length > 90) continue
        if (/^(table|sommaire|licence|installation|démarrage|prérequis)/i.test(title)) continue
        if (queryStemsOf(title).size < 2) continue
        topics.push({ label: title, query: title })
      }
    } catch {
      /* document absent */
    }
  }

  // 2. Les modules du cerveau et des bibliothèques — le cœur de NEXUS.
  let entries: { path: string }[] = []
  try {
    entries = listTree('src/lib', 1, 300)
      .filter((e) => e.type === 'file' && /\.ts$/.test(String(e.path ?? '')))
      .map((e) => ({ path: String(e.path ?? '') }))
  } catch {
    entries = []
  }
  for (const e of entries) {
    const base = e.path.replace(/^src\/lib\//, '').replace(/\.ts$/, '')
    if (!base || base.includes('/')) continue
    topics.push({ label: `Le module ${base} de NEXUS`, query: `${base} ${base.replace(/[-_]/g, ' ')}` })
  }

  if (!topics.length) return 0

  const existingRows = await db.trainingObjective.findMany({ where: { userId }, take: 500 }).catch(() => [])
  const known = new Set((existingRows ?? []).map((o) => String(o.label ?? '').toLowerCase()))

  let created = 0
  for (const t of topics) {
    if (known.has(t.label.toLowerCase())) continue
    if (created >= 24) break
    const row = await db.trainingObjective
      .create({
        data: {
          userId,
          label: t.label,
          query: t.query,
          category: 'nexus',
          priority: 4,
          status: 'a_faire',
          attempts: 0,
          lastScore: 0,
          origin: 'auto',
        },
      })
      .catch(() => null)
    if (row) {
      created++
      known.add(t.label.toLowerCase())
    }
  }
  return created
}

/**
 * Quand le web répond à nouveau, les objectifs que le corpus local ne pouvait
 * pas enseigner redeviennent tentables.
 */
async function restoreOutOfSourceObjectives(userId: string): Promise<number> {
  const rows = await db.trainingObjective
    .findMany({ where: { userId, status: 'hors_source' }, take: 200 })
    .catch(() => [])
  let n = 0
  for (const r of rows ?? []) {
    const ok = await db.trainingObjective
      .update({ where: { id: String(r.id) }, data: { status: 'a_faire', attempts: 0 } })
      .catch(() => null)
    if (ok) n++
  }
  return n
}

/**
 * Un cycle complet d'entraînement. Ne lève jamais : chaque échec est consigné
 * dans le journal et le daemon continue au cycle suivant.
 */
export async function runTrainingCycle(userId: string, opts: RunOptions = {}): Promise<CycleReport> {
  const config = await getTrainerConfig()
  const steps: CycleStep[] = []
  const startedAt = Date.now()

  const run = await db.trainingRun.create({
    data: {
      userId,
      status: 'en_cours',
      objective: '',
      steps: JSON.stringify(EMPTY_STEPS),
      pages: 0,
      items: 0,
      scoreBefore: 0,
      scoreAfter: 0,
      offline: false,
      error: '',
    },
  })
  const runId = String(run?.id ?? '')

  const step = (label: string, detail: string, status: CycleStep['status'] = 'ok') => {
    const entry: CycleStep = { at: Date.now(), label, detail, status }
    steps.push(entry)
    opts.onStep?.(entry)
    void db.trainingRun
      .update({ where: { id: runId }, data: { steps: JSON.stringify(steps) } })
      .catch(() => {})
    return entry
  }

  const finish = async (report: Omit<CycleReport, 'runId' | 'steps'> & { status?: string; error?: string }) => {
    await db.trainingRun
      .update({
        where: { id: runId },
        data: {
          status: report.error ? 'echec' : (report.status ?? 'ok'),
          objective: report.objective,
          steps: JSON.stringify(steps),
          pages: report.pages,
          items: report.items,
          scoreBefore: report.scoreBefore,
          scoreAfter: report.scoreAfter,
          offline: report.mode === 'local',
          error: (report.error ?? '').slice(0, 500),
          endedAt: new Date(),
        },
      })
      .catch(() => {})
    return { ...report, runId, steps }
  }

  try {
    // 1. Mesure avant
    const before = await probeNexus(userId)
    step(
      'Diagnostic',
      `NEXUS couvre ${before.covered}/${before.total} du banc d'épreuve (${Math.round(before.score * 100)} %)`,
      before.score > 0.6 ? 'ok' : 'warn'
    )

    // 2. Objectif
    const objective = opts.objectiveId
      ? await db.trainingObjective.findUnique({ where: { id: opts.objectiveId } }).then((r) =>
          r ? { id: String(r.id), label: String(r.label), query: String(r.query), category: String(r.category ?? 'culture') } : null
        )
      : await pickObjective(userId)
    if (!objective) {
      // Plus rien au programme : hors ligne, on peut toujours apprendre le
      // projet lui-même — c'est de la matière réelle, pas une invention.
      const created = await deriveProjectObjectives(userId).catch(() => 0)
      const retry = created > 0 ? await pickObjective(userId) : null
      if (!retry) {
        step('Objectif', 'Aucun objectif disponible (curriculum vide ou épuisé)', 'warn')
        return finish({ objective: '—', mode: 'aucun', pages: 0, items: 0, scoreBefore: before.score, scoreAfter: before.score })
      }
      step('Objectif', `${retry.label} — nouvel objectif tiré du projet (${created} sujet(s) ajouté(s))`)
      await db.trainingRun.update({ where: { id: runId }, data: { objective: retry.label } }).catch(() => {})
      return gather(retry)
    }
    await db.trainingRun.update({ where: { id: runId }, data: { objective: objective.label } }).catch(() => {})
    step('Objectif', objective.label)
    return gather(objective)

    /** Récolte, rédaction, évaluation et promotion pour un objectif donné. */
    async function gather(objective: { id: string; label: string; query: string; category: string }) {
      // 3. Récolte
      const material = await collectMaterial(objective, userId, runId, config)
      if (!material || !material.pages.length) {
        await bumpAttempts(objective.id, { status: 'a_faire' })
        step('Récolte', 'Aucune source exploitable (réseau indisponible et corpus local muet)', 'warn')
        return finish({
          objective: objective.label,
          mode: 'aucun',
          pages: 0,
          items: 0,
          scoreBefore: before.score,
          scoreAfter: before.score,
          error: 'aucune source',
        })
      }
      step(
        'Navigation',
        `${material.pages.length} page(s) lue(s) avec le navigateur de l'agent (${material.mode === 'web' ? 'web' : 'corpus local'}) : ${material.sources.slice(0, 3).join(', ')}`
      )

      // 4. Rédaction
      const mode: 'web' | 'local' = material.mode === 'web' ? 'web' : 'local'
      const question = buildQuestion(objective.label, objective.category, mode)
      const { answer, sentences, coverage } = buildAnswer(`${objective.label} ${objective.query}`, material.pages, mode)
      if (!answer) {
        step(
          'Rédaction',
          'Phrases écartées : hors sujet (le corpus local ne couvre pas cet objectif). Aucune connaissance fabriquée.',
          'warn'
        )
        // Le corpus local ne peut pas enseigner ce sujet : on ne le retente pas
        // en boucle, on le met en attente d'une source qui le couvre vraiment.
        await bumpAttempts(objective.id, { status: material.mode === 'web' ? 'a_faire' : 'hors_source' })
        return finish({
          objective: objective.label,
          mode: material.mode,
          pages: material.pages.length,
          items: 0,
          scoreBefore: before.score,
          scoreAfter: before.score,
          error: 'hors sujet',
        })
      }
      step('Rédaction', `${sentences.length} phrase(s) retenue(s) pour « ${question} »`)

      // 5. Évaluation
      const existingItems = await db.trainingItem.findMany({ where: { userId }, take: 200 }).catch(() => [])
      const existing = (existingItems ?? []).map((i) => ({ question: String(i.question ?? ''), answer: String(i.answer ?? '') }))
      const keywords = [...new Set(stems(`${objective.label} ${objective.query} ${question}`))]
        .filter((s) => s.length > 2)
        .slice(0, 10)
      const { score, reasons } = scoreCandidate({
        question,
        answer,
        sentences,
        keywords,
        sources: material.sources.length,
        coverage,
        existing,
      })
      step(
        'Évaluation',
        `score ${score.toFixed(2)} / seuil ${config.minScore.toFixed(2)}${reasons.length ? ` — ${reasons.join(' ; ')}` : ''}`,
        score >= config.minScore ? 'ok' : 'warn'
      )

      // Leçons : ce domaine / cette catégorie ont-ils donné quelque chose ?
      for (const d of material.sources.slice(0, 3)) await recordLesson(userId, 'domaine', d, score)
      await recordLesson(userId, 'categorie', objective.category, score)

      if (score < config.minScore) {
        await bumpAttempts(objective.id, { status: 'a_faire', lastScore: score })
        const item = await db.trainingItem.create({
          data: {
            userId,
            objectiveId: objective.id,
            runId,
            question,
            answer,
            keywords: JSON.stringify(keywords),
            sources: JSON.stringify(material.sources),
            score,
            status: 'rejete',
            hits: 0,
            offline: material.mode === 'local',
          },
        }).catch(() => null)
        void item
        return finish({
          objective: objective.label,
          mode: material.mode,
          pages: material.pages.length,
          items: 0,
          scoreBefore: before.score,
          scoreAfter: before.score,
        })
      }

      // 6. Promotion : la connaissance devient active + correctif proposé
      const sources = material.pages.slice(0, 4).map((p) => p.url)
      const item = await db.trainingItem.create({
        data: {
          userId,
          objectiveId: objective.id,
          runId,
          question,
          answer,
          keywords: JSON.stringify(keywords),
          sources: JSON.stringify(sources),
          score,
          status: 'candidat',
          hits: 0,
          offline: material.mode === 'local',
        },
      })
      const itemId = String(item?.id ?? '')

      // Effet immédiat : la note rejoint les connaissances du compte.
      await db.knowledge
        .create({
          data: {
            userId,
            title: question.slice(0, 200),
            content: answer.slice(0, 8000),
            category: 'Entraînement',
            tags: JSON.stringify(['entrainement', objective.category]),
            links: JSON.stringify(sources.slice(0, 3)),
            source: 'dev-trainer',
          },
        })
        .catch(() => {})
      step('Promotion', 'Entrée ajoutée aux connaissances du compte : NEXUS peut déjà l’utiliser')

      // Correctif vers la banque intégrée (savoir servi à tous, hors-ligne)
      const patch = buildKnowledgePatch({ keywords, question, answer })
      if (patch) {
        const patchRow = await db.devPatch
          .create({
            data: {
              userId,
              title: patch.title,
              filePath: patch.filePath,
              before: patch.before,
              after: patch.after,
              rationale: `Savoir récolté par l’entraînement automatique (score ${score.toFixed(2)}, sources : ${material.sources.slice(0, 2).join(', ')}). ${patch.rationale}`,
              status: 'propose',
              origin: 'entrainement',
              appliedAt: null,
            },
          })
          .catch(() => null)

        if (patchRow && config.autonomy === 'auto') {
          // Mode autonome : l'agent applique lui-même, après sauvegarde.
          try {
            const abs = safePath(patch.filePath)
            const { readFileSync, writeFileSync, existsSync } = await import('fs')
            if (existsSync(abs)) {
              const current = readFileSync(abs, 'utf8')
              if (current.split(patch.before).length === 2) {
                const { backupFile, writeGuarded } = await import('./devfs')
                backupFile(patch.filePath)
                writeGuarded(patch.filePath, current.replace(patch.before, () => patch.after))
                await db.devPatch
                  .update({ where: { id: String(patchRow.id) }, data: { status: 'applique', appliedAt: new Date() } })
                  .catch(() => {})
                await db.trainingItem
                  .update({ where: { id: itemId }, data: { status: 'valide', appliedAt: new Date() } })
                  .catch(() => {})
                step('Autonomie', 'Correctif appliqué automatiquement (sauvegarde faite)', 'ok')
              } else {
                step('Autonomie', 'Ancre introuvable : le correctif reste à valider à la main', 'warn')
              }
            }
          } catch (e) {
            step('Autonomie', `Application impossible : ${e instanceof Error ? e.message : 'erreur'}`, 'warn')
          }
        } else if (patchRow) {
          step('Correctif', 'Correctif déposé dans l’onglet Correctifs, en attente de validation', 'ok')
        }
      }

      await db.trainingItem.update({ where: { id: itemId }, data: { status: 'valide' } }).catch(() => {})
      await bumpAttempts(objective.id, { status: 'fait', lastScore: score })

      // 6 bis. Le modèle maison apprend ce savoir : relance en arrière-plan si
      // assez de nouveautés se sont accumulées.
      const retrain = await maybeRetrainModel().catch((e) => ({
        started: false,
        reason: e instanceof Error ? e.message : 'erreur',
        steps: 0,
      }))
      step(
        'Modèle',
        retrain.started ? `Entraînement lancé — ${retrain.reason}` : `Pas de relance — ${retrain.reason}`,
        'ok'
      )

      // 7. Vérification : est-ce que ça change vraiment quelque chose ?
      const after = await probeNexus(userId)
      const delta = after.score - before.score
      step(
        'Vérification',
        `couverture ${Math.round(before.score * 100)} % → ${Math.round(after.score * 100)} % (${delta >= 0 ? '+' : ''}${Math.round(delta * 100)} pt)`,
        delta > 0 ? 'ok' : 'warn'
      )

      // Mesure du modèle lui-même (et non du seul savoir) : répond-il aux questions
      // qu'il a apprises, garde-fou compris ?
      const modelProbe = await probeModel(await validQuestions(6)).catch(() => null)
      if (modelProbe) {
        step(
          'Modèle mesuré',
          `répond à ${modelProbe.answered}/${modelProbe.total} questions de son savoir appris (${Math.round(modelProbe.ms / 1000)} s)`,
          modelProbe.answered > 0 ? 'ok' : 'warn'
        )
      }

      // 8. Le cycle alimente la prochaine cible : les trous restants
      for (const miss of after.misses.slice(0, 3)) {
        const exists = (await db.trainingObjective.findMany({ where: { userId }, take: 300 }).catch(() => [])) ?? []
        if (exists.some((r) => String(r.query) === miss)) continue
        await db.trainingObjective
          .create({
            data: {
              userId,
              label: miss.replace(/^C'est quoi\s+/i, '').replace(/\s*\?$/, ''),
              query: miss,
              category: 'lacune',
              priority: 7,
              status: 'a_faire',
              attempts: 0,
              lastScore: 0,
              origin: 'auto',
            },
          })
          .catch(() => {})
      }

      return finish({
        objective: objective.label,
        mode: material.mode,
        pages: material.pages.length,
        items: 1,
        scoreBefore: before.score,
        scoreAfter: after.score,
      })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erreur inconnue'
    step('Incident', message, 'error')
    return finish({
      objective: '',
      mode: 'aucun',
      pages: 0,
      items: 0,
      scoreBefore: 0,
      scoreAfter: 0,
      error: message,
    })
  } finally {
    void startedAt
  }
}

// ── Lecture pour le dashboard ────────────────────────────────────────────────

export interface TrainerSnapshot {
  config: TrainerConfig
  score: NexusScore
  counts: {
    objectives: number
    objectivesDone: number
    items: number
    itemsValid: number
    itemsCandidate: number
    runs: number
    pages: number
    domains: number
    lessons: number
  }
  runs: {
    id: string
    objective: string
    status: string
    mode: string
    pages: number
    items: number
    scoreBefore: number
    scoreAfter: number
    offline: boolean
    error: string
    startedAt: unknown
    endedAt: unknown
    steps: CycleStep[]
  }[]
  objectives: { id: string; label: string; query: string; category: string; status: string; attempts: number; lastScore: number; origin: string }[]
  items: { id: string; question: string; answer: string; score: number; status: string; sources: string[]; offline: boolean; createdAt: unknown }[]
  lessons: { kind: string; key: string; value: number; samples: number }[]
}

export async function trainerSnapshot(userId: string): Promise<TrainerSnapshot> {
  const config = await getTrainerConfig()
  await ensureCurriculum(userId)

  const [objectives, items, runs, pages, lessons] = await Promise.all([
    db.trainingObjective.findMany({ where: { userId }, orderBy: { priority: 'desc' }, take: 100 }).catch(() => []),
    db.trainingItem.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 60 }).catch(() => []),
    db.trainingRun.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, take: 15 }).catch(() => []),
    db.devPage.findMany({ where: { userId }, take: 500 }).catch(() => []),
    db.trainingLesson.findMany({ where: { userId }, take: 100 }).catch(() => []),
  ])

  const score = await probeNexus(userId)
  const list = objectives ?? []
  const itemList = items ?? []
  const pageList = pages ?? []

  return {
    config,
    score,
    counts: {
      objectives: list.length,
      objectivesDone: list.filter((o) => String(o.status) === 'fait').length,
      items: itemList.length,
      itemsValid: itemList.filter((i) => String(i.status) === 'valide').length,
      itemsCandidate: itemList.filter((i) => String(i.status) === 'candidat').length,
      runs: (runs ?? []).length,
      pages: pageList.length,
      domains: new Set(pageList.map((p) => String(p.domain ?? ''))).size,
      lessons: (lessons ?? []).length,
    },
    runs: (runs ?? []).map((r) => ({
      id: String(r?.id ?? ''),
      objective: String(r?.objective ?? ''),
      status: String(r?.status ?? ''),
      mode: r?.offline ? 'local' : 'web',
      pages: Number(r?.pages ?? 0),
      items: Number(r?.items ?? 0),
      scoreBefore: Number(r?.scoreBefore ?? 0),
      scoreAfter: Number(r?.scoreAfter ?? 0),
      offline: Boolean(r?.offline),
      error: String(r?.error ?? ''),
      startedAt: r?.startedAt,
      endedAt: r?.endedAt ?? null,
      steps: parseSteps(r?.steps),
    })),
    objectives: list.slice(0, 40).map((o) => ({
      id: String(o?.id ?? ''),
      label: String(o?.label ?? ''),
      query: String(o?.query ?? ''),
      category: String(o?.category ?? ''),
      status: String(o?.status ?? ''),
      attempts: Number(o?.attempts ?? 0),
      lastScore: Number(o?.lastScore ?? 0),
      origin: String(o?.origin ?? 'auto'),
    })),
    items: itemList.slice(0, 40).map((i) => ({
      id: String(i?.id ?? ''),
      question: String(i?.question ?? ''),
      answer: String(i?.answer ?? ''),
      score: Number(i?.score ?? 0),
      status: String(i?.status ?? ''),
      sources: safeArray(i?.sources),
      offline: Boolean(i?.offline),
      createdAt: i?.createdAt,
    })),
    lessons: (lessons ?? [])
      .map((l) => ({
        kind: String(l?.kind ?? ''),
        key: String(l?.key ?? ''),
        value: Number(l?.value ?? 0),
        samples: Number(l?.samples ?? 0),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12),
  }
}

function safeArray(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.map(String).slice(0, 5) : []
  } catch {
    return []
  }
}
