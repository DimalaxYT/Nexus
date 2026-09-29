// ─── NEXUS — Runner de missions autonomes v4 (équipe multi-agents) ───────────
// L'utilisateur confie des missions ; l'ÉQUIPE NEXUS les exécute seule, même
// quand il n'est pas devant l'application :
//   1. Les objectifs sont CLASSIFIÉS (recherche / regarder / comprendre /
//      retenir / synthèse) — plus jamais « Comprendre » envoyé à Google comme
//      requête brute.
//   2. Les 🔎 chercheurs interrogent les sources (Google, YouTube, TikTok).
//   3. Les vidéos sont « REGARDÉES » en mode texte : description complète +
//      TRANSCRIPTION réelle (sous-titres) via le lecteur YouTube local.
//   4. Le 🧠 analyste extrait les points clés et les RETIENT (base de
//      connaissances).
//   5. Le ✍️ rédacteur rédige la SYNTHÈSE finale — un vrai rapport en markdown,
//      stocké SUR la mission et affiché dans le panneau Missions.
// Robuste : chaque étape est isolée, aucun échec ne bloque la mission entière.

import { db } from '@/lib/db'
import { webSearch, readWebpage, isMediaDomain, type SearchResult } from '@/lib/brain/search'
import { extractKeySentences } from '@/lib/brain/synthesize'
import { normalize, stems, contentTokens } from '@/lib/brain/text'
import {
  readYouTubeVideo,
  extractVideoId,
  formatDuration,
  searchYouTubeNative,
} from '@/lib/brain/youtube'
import { llmComplete } from '@/lib/llm'
import { parseAgentRow, type NexusAgent, type AgentRole } from '@/lib/nexus-types'

const WORKER_INTERVAL_MS = 6_000
const STALE_RUNNING_MS = 15 * 60 * 1000 // mission « running » sans vie depuis 15 min → refile
const MAX_RESEARCH_STEPS = 4
const MAX_RESULTS_PER_SOURCE = 6
const MAX_VIDEOS_WATCHED = 4 // vidéos « regardées » (transcription) par étape
const MAX_PAGES_READ = 4 // pages web lues par étape
const MAX_SNIPPET_NOTES = 3

type SourceKey = 'google' | 'youtube' | 'tiktok'

const SOURCE_META: Record<SourceKey, { label: string; site?: string; querySuffix?: string }> = {
  google: { label: 'Google / Web' },
  youtube: { label: 'YouTube', site: 'youtube.com' },
  tiktok: { label: 'TikTok', site: 'tiktok.com' },
}

const g = globalThis as unknown as {
  __nexusMissionWorker?: boolean
  __nexusMissionRunning?: boolean
  __nexusMissionStop?: () => void
}

// ── Journal d'avancement ─────────────────────────────────────────────────────

async function addProgress(taskId: string, note: string, status?: string): Promise<void> {
  try {
    const task = await db.task.findUnique({ where: { id: taskId } })
    if (!task) return
    let progress: { at: string; note: string }[] = []
    try {
      const arr = JSON.parse(task.progress) as unknown
      if (Array.isArray(arr)) progress = arr as { at: string; note: string }[]
    } catch {
      /* vide */
    }
    progress.push({ at: new Date().toISOString(), note: note.slice(0, 600) })
    await db.task.update({
      where: { id: taskId },
      data: {
        progress: JSON.stringify(progress.slice(-40)),
        ...(status ? { status } : {}),
      },
    })
  } catch {
    /* le journal ne doit jamais faire échouer la mission */
  }
}

async function saveLearnedNote(title: string, content: string, category: string, tags: string[]): Promise<void> {
  try {
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const existing = await db.knowledge.findMany({ select: { id: true, title: true }, take: 400 })
    const match = existing.find((k) => norm(k.title) === norm(title))
    if (match) {
      await db.knowledge.update({ where: { id: match.id }, data: { content, category, tags: JSON.stringify(tags) } })
    } else {
      await db.knowledge.create({ data: { title, content, category, tags: JSON.stringify(tags), source: 'agent' } })
    }
  } catch {
    /* échec d'écriture : non bloquant */
  }
}

// ── Classification des objectifs ─────────────────────────────────────────────
// Le bug historique : « Comprendre » ou « Me faire une synthèse » traités comme
// des requêtes de recherche. Désormais chaque objectif est classé :

type ObjectiveKind = 'research' | 'watch' | 'retain' | 'synthesis'

interface ClassifiedObjective {
  text: string
  kind: ObjectiveKind
}

const SYNTHESIS_RE =
  /\b(synthese|resume|recapitulatif|rapport|conclusion|bilan|ce que tu as compris|ce que tu as appris|ce que vous avez compris|fais moi un point|redige|presente moi un point)\b/
const WATCH_RE = /\b(regarde|regarder|visionne|visionner|mate|mater|regarde (?:ses |les |la |le |ce )\w*|regarde la video)\b/
const RETAIN_RE = /\b(retiens|retenir|memorise|memoriser|note les|note ces|enregistre|apprends|apprendre|comprends|comprendre|analyse|analyser|etudie|etudier|identifie les points)\b/
const RESEARCH_RE =
  /\b(recherche|chercher|cherche|trouve|trouver|lister|liste|explore|veille|collecte|documente|renseigne|survole|rassemble|trouve moi|cherche moi|decouvre|exemples de|tutoriels?|ressources?)\b/

/** Classe un objectif en intention (synthèse > regarder > retenir > recherche > méta). */
export function classifyObjective(raw: string): ObjectiveKind {
  const t = normalize(raw)
  if (SYNTHESIS_RE.test(t)) return 'synthesis'
  if (WATCH_RE.test(t)) return 'watch'
  if (RETAIN_RE.test(t)) return 'retain'
  if (RESEARCH_RE.test(t)) return 'research'
  // Par défaut : un objectif substantiel = recherche, une consigne vague = méta
  return t.split(/\s+/).length >= 3 ? 'research' : 'retain'
}

function classifyAll(objectives: string[]): ClassifiedObjective[] {
  return objectives.map((text) => ({ text, kind: classifyObjective(text) }))
}

// ── Extraction du SUJET réel de la mission ───────────────────────────────────
// « Rechercher sur youtube des vidéos de chatbot et d'ia » → sujet : « chatbot ia »
// (les verbes d'instruction et mots structurels sont retirés).

const INSTRUCTION_WORDS = new Set([
  'recherche', 'rechercher', 'cherche', 'chercher', 'trouve', 'trouver', 'liste', 'lister',
  'explore', 'explorer', 'veille', 'collecte', 'collecter', 'documente', 'renseigne',
  'regarde', 'regarder', 'visionne', 'visionner', 'mate', 'comprendre', 'comprends',
  'retenir', 'retiens', 'memorise', 'memoriser', 'enregistre', 'apprendre', 'apprends',
  'analyse', 'analyser', 'etudie', 'etudier', 'identifie', 'synthese', 'synthetise',
  'resume', 'recapitulatif', 'rapport', 'conclusion', 'bilan', 'redige', 'rédige',
  'video', 'videos', 'tuto', 'tutoriel', 'tutoriels', 'youtube', 'tiktok', 'google',
  'site', 'sites', 'web', 'internet', 'page', 'pages', 'article', 'articles',
  'ressource', 'ressources', 'source', 'sources', 'information', 'informations',
  'essentiel', 'essentiels', 'essentielle', 'essentielles', 'important', 'importants',
  'me', 'moi', 'tu', 'ton', 'tes', 'ta', 'faire', 'fais', 'fait', 'veux', 'veut',
  'ensuite', 'puis', 'apres', 'avant', 'finalement', 'enfin', 'aussi', 'chose',
  'sujets', 'sujet', 'theme', 'themes', 'contenu', 'contenus', 'idea', 'ideas',
  // Temporalité : « la DERNIÈRE vidéo de fugu » → le sujet est « fugu »,
  // pas « derniere fugu » (cause de recherches polluées en mission).
  'derniere', 'dernier', 'dernieres', 'derniers', 'recente', 'recent', 'recentes',
  'recents', 'nouvelle', 'nouvel', 'nouveau', 'nouvelles', 'peux', 'pourrais',
])

/** Sujet de recherche nettoyé (mots-content, hors verbes d'instruction). */
export function extractTopic(text: string, maxWords = 6): string {
  // Longueur ≥ 2 : garde les acronymes courts mais porteurs (« ia », « 3d ») ;
  // les mots vides courants (« et », « ou », « au »…) sont déjà filtrés par
  // contentTokens (STOPWORDS).
  const words = contentTokens(text).filter((w) => !INSTRUCTION_WORDS.has(w) && w.length >= 2)
  const seen = new Set<string>()
  const kept: string[] = []
  for (const w of words) {
    const st = stems(w)[0] ?? w
    if (seen.has(st)) continue
    seen.add(st)
    kept.push(w)
    if (kept.length >= maxWords) break
  }
  return kept.join(' ')
}

/** Sujet global de la mission (objectifs de recherche OU de visionnage + nom + description). */
function missionTopic(objectives: ClassifiedObjective[], name: string, description: string): string {
  const researchTexts = objectives
    .filter((o) => o.kind === 'research' || o.kind === 'watch')
    .map((o) => o.text)
  const parts = [...researchTexts, name, description.slice(0, 200)]
  for (const part of parts) {
    const topic = extractTopic(part)
    if (topic.length >= 4) return topic
  }
  return extractTopic(name) || name
}

/** Indices de sources dans un objectif (« sur youtube » → youtube d'abord). */
function sourceHints(text: string): SourceKey[] {
  const t = normalize(text)
  const hints: SourceKey[] = []
  if (/\byoutube|video|chaine|tuto\b/.test(t)) hints.push('youtube')
  if (/\btiktok\b/.test(t)) hints.push('tiktok')
  if (/\bgoogle|web|internet|article|blog\b/.test(t)) hints.push('google')
  if (hints.length === 0) return ['google', 'youtube']
  if (!hints.includes('google')) hints.push('google')
  return hints.slice(0, 3)
}

// ── Équipe multi-agents ──────────────────────────────────────────────────────

const VIRTUAL_TEAM: NexusAgent[] = [
  { id: 'virtual-scout', name: 'Scout', emoji: '🔎', role: 'chercheur', description: 'Chercheur web — trouve les meilleures sources', prompt: '', specialties: ['google', 'youtube'], color: '#38bdf8', enabled: true, writer: false, createdAt: 0 },
  { id: 'virtual-analyste', name: 'Analyste', emoji: '🧠', role: 'analyste', description: 'Extrait et retient les points clés', prompt: '', specialties: ['analyse'], color: '#a78bfa', enabled: true, writer: false, createdAt: 0 },
  { id: 'virtual-redacteur', name: 'Rédacteur', emoji: '✍️', role: 'redacteur', description: 'Rédige la synthèse finale', prompt: '', specialties: ['redaction'], color: '#34d399', enabled: true, writer: false, createdAt: 0 },
]

/** Charge l'équipe activée ; si l'utilisateur a désigné des agents pour cette
 *  mission, on les utilise en priorité. Fallback : équipe virtuelle par défaut. */
async function loadTeam(preferredIds: string[]): Promise<{ team: NexusAgent[]; fromDb: boolean }> {
  try {
    const rows = await db.agentProfile.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
    let agents = rows.map(parseAgentRow)
    if (preferredIds.length > 0) {
      const chosen = agents.filter((a) => preferredIds.includes(a.id))
      if (chosen.length > 0) agents = chosen
    }
    if (agents.length > 0) return { team: agents, fromDb: true }
  } catch {
    /* base indisponible : équipe virtuelle */
  }
  return { team: VIRTUAL_TEAM, fromDb: false }
}

function pickByRole(team: NexusAgent[], roles: AgentRole[], fallback: NexusAgent): NexusAgent {
  for (const role of roles) {
    const found = team.find((a) => a.role === role)
    if (found) return found
  }
  return fallback
}

function agentTag(agent: NexusAgent): string {
  return `${agent.emoji} ${agent.name}`
}

// ── Découvertes (findings) ───────────────────────────────────────────────────

interface Finding {
  kind: 'page' | 'video' | 'snippet'
  title: string
  url: string
  domain: string
  text: string // contenu exploitable (texte de page / description+transcription / extrait)
  transcriptWords?: number // pour les vidéos : taille de la transcription
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

// ── Recherche multi-sources pour un objectif ────────────────────────────────

async function searchObjective(step: { queries: string[]; sources: SourceKey[] }): Promise<SearchResult[]> {
  const merged: SearchResult[] = []
  const seen = new Set<string>()
  const push = (r: SearchResult) => {
    const key = r.url.replace(/[?#].*$/, '') || `${r.domain}|${r.title.slice(0, 30)}`
    if (seen.has(key)) return
    seen.add(key)
    merged.push(r)
  }

  for (const source of step.sources.slice(0, 3)) {
    const meta = SOURCE_META[source]
    for (const query of step.queries.slice(0, 2)) {
      try {
        if (source === 'youtube') {
          // Recherche NATIVE YouTube (vraies vidéos avec videoId) — Bing
          // site:youtube.com est pollué par les redirects Google News.
          const native = await searchYouTubeNative(query, MAX_RESULTS_PER_SOURCE)
          for (const h of native) {
            push({
              title: h.title,
              url: h.url,
              domain: 'youtube.com',
              snippet: [h.channel && `Chaîne : ${h.channel}`, h.duration && `Durée : ${h.duration}`, h.snippet]
                .filter(Boolean)
                .join(' — '),
            })
          }
          if (native.length === 0) {
            // Repli Bing site:youtube.com (peut être bloqué / pollué)
            const bing = (await webSearch(query, MAX_RESULTS_PER_SOURCE, meta.site)) ?? []
            for (const r of bing) push(r)
          }
        } else {
          const results = (await webSearch(query, MAX_RESULTS_PER_SOURCE, meta.site)) ?? []
          for (const r of results) push(r)
        }
      } catch {
        /* source injoignable : on continue avec les autres */
      }
    }
  }
  return merged.slice(0, 16)
}

/** « Regarde » les vidéos trouvées : description + transcription quand YouTube
 *  les sert ; sinon titre + chaîne (oembed) et l'aperçu de l'extrait de recherche. */
async function watchVideos(results: SearchResult[], objective: string): Promise<Finding[]> {
  const videoResults = results.filter((r) => extractVideoId(r.url)).slice(0, MAX_VIDEOS_WATCHED)
  if (videoResults.length === 0) return []
  const watched = await Promise.allSettled(
    videoResults.map(async (r): Promise<Finding | null> => {
      const video = await readYouTubeVideo(r.url)
      if (!video) return null
      const parts: string[] = []
      if (video.author) parts.push(`Chaîne : ${video.author}`)
      if (video.durationSec > 0) parts.push(`Durée : ${formatDuration(video.durationSec)}`)
      if (video.description) parts.push(`Description : ${video.description.slice(0, 1200)}`)
      // YouTube bloque parfois la description depuis un serveur : l'extrait
      // de recherche fait alors office d'aperçu du contenu de la vidéo.
      const snippet = r.snippet.replace(/^Publication\s*:\s*.*$/i, '').trim()
      if (!video.description && snippet.length >= 20) parts.push(`Aperçu : ${snippet.slice(0, 600)}`)
      if (video.transcript) parts.push(`Transcription : ${video.transcript}`)
      const text = parts.join('\n').trim()
      if (!text) return null
      return {
        kind: 'video',
        title: video.title,
        url: video.url,
        domain: 'youtube.com',
        text,
        transcriptWords: video.transcript ? video.transcript.split(/\s+/).length : 0,
      } satisfies Finding
    })
  )
  return watched
    .filter((w): w is PromiseFulfilledResult<Finding> => w.status === 'fulfilled' && w.value !== null)
    .map((w) => w.value)
}

/** Lit les pages web (hors domaines médias et agrégateurs à redirects). */
async function readPages(results: SearchResult[]): Promise<Finding[]> {
  const readable = results
    .filter((r) => !isMediaDomain(r.url))
    .filter((r) => !/news\.google\.com|news\.yahoo\.com|google\.com\/amp/i.test(r.url))
    .slice(0, MAX_PAGES_READ)
  const pages = await Promise.allSettled(readable.map((r) => readWebpage(r.url, 7000)))
  return pages
    .filter((p): p is PromiseFulfilledResult<{ url: string; title: string; text: string }> => p.status === 'fulfilled' && p.value !== null)
    .filter((p) => p.value.text.length >= 200) // pas de pages coquilles vides
    .map((p) => ({ kind: 'page', title: p.value.title, url: p.value.url, domain: safeDomain(p.value.url), text: p.value.text }) satisfies Finding)
}

/** Extraits de qualité pour les résultats non lus (repli). */
function snippetFindings(results: SearchResult[], excludeUrls: Set<string>, objective: string): Finding[] {
  const objStems = new Set(stems(objective).filter((w) => w.length > 2))
  const hitsOf = (r: SearchResult): number => {
    const hay = new Set(stems(`${r.title} ${r.snippet}`))
    let hits = 0
    for (const w of objStems) if (hay.has(w)) hits++
    return hits
  }
  return results
    .filter((r) => {
      if (excludeUrls.has(r.url)) return false
      if (isMediaDomain(r.url) && !extractVideoId(r.url)) return false
      if (/news\.google\.com/i.test(r.url)) return false
      const snip = r.snippet.replace(/^Publication\s*:\s*.*$/i, '').trim()
      return snip.length >= 50 && hitsOf(r) >= 1
    })
    .sort((a, b) => hitsOf(b) - hitsOf(a))
    .slice(0, MAX_SNIPPET_NOTES)
    .map((r) => ({
      kind: 'snippet',
      title: r.title,
      url: r.url,
      domain: safeDomain(r.url),
      text: `${r.title}. ${r.snippet.replace(/^Publication\s*:\s*.*$/i, '').trim()}`,
    }) satisfies Finding)
}

// ── Phases d'exécution ───────────────────────────────────────────────────────

async function phaseResearch(
  taskId: string,
  step: { label: string; topic: string; queries: string[]; sources: SourceKey[] },
  researcher: NexusAgent,
  wantsVideos: boolean
): Promise<Finding[]> {
  await addProgress(taskId, `${agentTag(researcher)} (chercheur) : je lance la recherche « ${step.topic.slice(0, 80)} » sur ${step.sources.map((s) => SOURCE_META[s].label).join(' + ')}`)
  const results = await searchObjective(step)
  if (results.length === 0) {
    await addProgress(taskId, `${agentTag(researcher)} : aucune source trouvée (réseau indisponible ?) — je note le blocage pour le rapport`)
    return []
  }

  const findings: Finding[] = []
  const excluded = new Set<string>()

  // Regarder les vidéos (titre/chaîne/description/transcription selon ce que YouTube sert)
  if (wantsVideos) {
    const videos = await watchVideos(results, step.topic)
    for (const v of videos) {
      findings.push(v)
      excluded.add(v.url)
      const detail = v.transcriptWords
        ? `transcription de ${v.transcriptWords} mots récupérée`
        : `fiche vidéo récupérée (${v.text.length} caractères analysés)`
      await addProgress(taskId, `${agentTag(researcher)} : 🎬 j'ai regardé « ${v.title.slice(0, 70)} » — ${detail}`)
    }
  }

  // Lire les pages web
  const pages = await readPages(results)
  for (const p of pages) {
    findings.push(p)
    excluded.add(p.url)
    await addProgress(taskId, `${agentTag(researcher)} : 📄 j'ai lu « ${p.title.slice(0, 70)} » (${p.domain})`)
  }

  // Extraits de repli
  for (const s of snippetFindings(results, excluded, step.topic)) findings.push(s)

  return findings
}

async function phaseRetain(
  taskId: string,
  findings: Finding[],
  objective: string,
  missionName: string,
  analyst: NexusAgent
): Promise<number> {
  if (findings.length === 0) return 0
  await addProgress(taskId, `${agentTag(analyst)} (analyste) : je comprends et je retiens l'essentiel de ${findings.length} source(s)…`)
  const baseTags = [...new Set([...stems(objective).slice(0, 4), ...stems(missionName).slice(0, 2)])]
  let saved = 0
  for (const f of findings.slice(0, 8)) {
    try {
      // Phrases clés extraites du contenu ; si l'extraction n'aboutit pas
      // (texte trop court, description seule), on garde le début du texte.
      let key = extractKeySentences(f.text, objective, f.kind === 'video' ? 4 : 3)
      if (key.length === 0) {
        const fallback = f.text.replace(/^(Chaîne|Durée|Description|Aperçu|Transcription)\s*:\s*/gm, '').trim()
        // Les fiches vidéo sont souvent courtes (titre + chaîne) : seuil adapté
        if (fallback.length >= (f.kind === 'video' ? 18 : 60)) key = [fallback.slice(0, 260)]
      }
      if (key.length === 0) continue
      const category =
        f.kind === 'video' ? 'Compétences/YouTube' : `Compétences/${f.domain}`
      const marker = f.kind === 'video' ? '🎬 Vidéo' : f.kind === 'page' ? '📄 Page' : '🔗 Extrait'
      const content = `${key.map((k) => `• ${k}`).join('\n')}\n\n${marker} : ${f.title}\nSource : ${f.url}`
      const title = `${f.kind === 'video' ? 'Vidéo' : 'Note'} — ${f.title.slice(0, 80)}`
      await saveLearnedNote(title, content, category, baseTags)
      saved++
    } catch {
      /* une source illisible n'arrête pas l'analyse des autres */
    }
  }
  if (saved > 0) {
    await addProgress(taskId, `${agentTag(analyst)} : ✅ ${saved} information(s) essentielle(s) retenue(s) dans ma base de connaissances`)
  }
  return saved
}

// ── Rédaction du rapport final ───────────────────────────────────────────────

function condenseCorpus(findings: Finding[], maxItems: number): string {
  return findings
    .slice(0, maxItems)
    .map((f, i) => {
      const kindLabel = f.kind === 'video' ? 'vidéo' : f.kind === 'page' ? 'page web' : 'extrait'
      // Pour les vidéos : privilégier le début de la transcription (le contenu parlé)
      const body =
        f.kind === 'video'
          ? f.text.replace(/^Chaîne : .*$/m, '').replace(/^Durée : .*$/m, '').slice(0, 700)
          : f.text.slice(0, 500)
      return `[${i + 1}] (${kindLabel} — ${f.domain}) ${f.title}\n${body}`
    })
    .join('\n\n')
}

async function writeReport(
  task: { name: string; description: string },
  objectives: ClassifiedObjective[],
  findings: Finding[],
  notesSaved: number,
  team: NexusAgent[],
  topic: string
): Promise<string> {
  const wantsSynthesis = objectives.some((o) => o.kind === 'synthesis')
  const teamLine = team.map((a) => `${a.emoji} ${a.name} (${a.role === 'redacteur' ? 'rédacteur' : a.role})`).join(' · ')
  const videos = findings.filter((f) => f.kind === 'video')
  const pages = findings.filter((f) => f.kind === 'page')

  // 1) Rédaction LLM (si disponible) — nourrie avec le VRAI contenu collecté
  const corpus = condenseCorpus(findings, 14)
  if (corpus.length > 200) {
    const report = await llmComplete(
      [
        {
          role: 'system',
          content:
            "Tu es l'équipe d'agents NEXUS (chercheurs, analyste, rédacteur) qui rend compte à son utilisateur. Rédige le RAPPORT FINAL de la mission en markdown français, PRÉCIS et CONCRET, en te basant UNIQUEMENT sur les contenus collectés ci-dessous (cite les domaines entre crochets, ex [youtube.com]). Structure imposée : « ## Ce que j'ai compris » (la synthèse demandée, 5-10 lignes), « ## Points clés » (5-8 puces factuelles), « ## Sources consultées » (liste [domaine] titre). Pas d'invention : si un point n'est pas dans les contenus, ne l'écris pas.",
        },
        {
          role: 'user',
          content: `Mission : « ${task.name} »\nDescription : ${task.description.slice(0, 400) || '—'}\nSujet : ${topic}\nObjectifs :\n${objectives.map((o) => `- (${o.kind}) ${o.text}`).join('\n')}\n\nCONTENUS COLLECTÉS (${videos.length} vidéo(s) « regardée(s) » avec transcription, ${pages.length} page(s) lue(s)) :\n\n${corpus}`,
        },
      ],
      { temperature: 0.4, maxTokens: 900, timeoutMs: 45_000, thinking: false }
    )
    if (report && report.trim().length > 200) {
      return `${report.trim()}\n\n---\n*Équipe : ${teamLine} — ${notesSaved} note(s) enregistrée(s) en mémoire.*`
    }
  }

  // 2) Rédaction extractive locale (toujours disponible) — vraies phrases des sources
  const intro =
    findings.length === 0
      ? "Mission terminée, mais le réseau était indisponible : je n'ai pu consulter aucune source. Relance la mission plus tard."
      : wantsSynthesis
        ? `Tu m'as demandé une synthèse de ce que j'ai compris. Voici mon rapport, rédigé à partir de ${findings.length} source(s) réelle(s) : ${videos.length} vidéo(s) « regardée(s) » (titre, chaîne, description ou aperçu) et ${pages.length} page(s) lue(s).`
        : `Mission terminée. J'ai consulté ${findings.length} source(s) : ${videos.length} vidéo(s) « regardée(s) », ${pages.length} page(s) lue(s).`

  const fallbackSentences = (f: Finding, max: number): string[] => {
    const keys = extractKeySentences(f.text, topic || task.name, max)
    if (keys.length > 0) return keys
    const body = f.text.replace(/^(Chaîne|Durée|Description|Aperçu|Transcription)\s*:\s*/gm, '').replace(/\s+/g, ' ').trim()
    return body.length >= 60 ? [body.slice(0, 240)] : body.length > 0 ? [body.slice(0, 160)] : []
  }

  const keyBullets: string[] = []
  for (const f of findings.slice(0, 8)) {
    const keys = fallbackSentences(f, 2)
    if (keys.length === 0) continue
    const kindIcon = f.kind === 'video' ? '🎬' : f.kind === 'page' ? '📄' : '🔗'
    keyBullets.push(`- ${kindIcon} **${f.title.slice(0, 90)}** [${f.domain}] : ${keys.slice(0, 2).join(' ')}`)
  }

  const understood = findings
    .flatMap((f) => fallbackSentences(f, 2).map((s) => ({ s, domain: f.domain })))
    .slice(0, 5)
    .map((x) => `- ${x.s} [${x.domain}]`)

  const sourceLines = findings
    .slice(0, 10)
    .map((f) => `- [${f.domain}] ${f.kind === 'video' ? '🎬 ' : ''}${f.title.slice(0, 90)} — ${f.url}`)

  const learnedCats = [...new Set(findings.map((f) => (f.kind === 'video' ? 'YouTube' : f.domain)))].slice(0, 5)

  return [
    `# Rapport — ${task.name}`,
    '',
    intro,
    '',
    `## Ce que j'ai compris`,
    understood.length > 0
      ? understood.join('\n')
      : "Les sources consultées n'ont fourni que des titres : relance la mission pour que je creuse davantage.",
    '',
    `## Points clés retenus`,
    keyBullets.length > 0
      ? keyBullets.join('\n')
      : 'Aucun point clé extractible — les sources consultées étaient trop pauvres ou injoignables.',
    '',
    `## Ce que j'ai retenu en mémoire`,
    notesSaved > 0
      ? `${notesSaved} note(s) enregistrée(s) dans ma base de connaissances (catégories : ${learnedCats.join(', ')}). Je m'en servirai dans nos prochaines conversations.`
      : findings.length > 0
        ? 'Les contenus collectés étaient trop minces pour être retenus tels quels — ils alimentent tout de même ce rapport.'
        : 'Rien de nouveau à enregistrer (aucune source joignable).',
    '',
    `## Sources consultées`,
    sourceLines.length > 0 ? sourceLines.join('\n') : '— aucune (réseau indisponible)',
    '',
    `---`,
    `*Équipe : ${teamLine}*`,
  ].join('\n')
}

// ── Exécution d'une mission ─────────────────────────────────────────────────

function parseObjectives(raw: string, description: string): string[] {
  try {
    const arr = JSON.parse(raw) as unknown
    if (Array.isArray(arr) && arr.length > 0) {
      return arr.map(String).filter((s) => s.trim().length > 2).slice(0, MAX_RESEARCH_STEPS + 4)
    }
  } catch {
    /* non-JSON */
  }
  const text = raw.trim() || description
  return text
    .split(/[\n;]|(?:,\s*(?=[A-ZÀ-ÿ]))|(?:\s+\d[.)]\s+)/)
    .map((s) => s.replace(/^[-*\d.)\s]+/, '').trim())
    .filter((s) => s.length > 3)
    .slice(0, MAX_RESEARCH_STEPS + 4)
}

export async function runMission(taskId: string): Promise<void> {
  if (g.__nexusMissionRunning) return // une seule mission à la fois
  g.__nexusMissionRunning = true
  try {
    const task = await db.task.findUnique({ where: { id: taskId } })
    if (!task || task.status === 'done') return

    let preferredAgentIds: string[] = []
    try {
      const arr = JSON.parse(task.agents) as unknown
      if (Array.isArray(arr)) preferredAgentIds = arr.map(String).slice(0, 10)
    } catch {
      /* vide */
    }

    const objectivesRaw = parseObjectives(task.objectives, task.description)
    const objectives = classifyAll(objectivesRaw.length > 0 ? objectivesRaw : [task.name])
    const researchSteps = objectives.filter((o) => o.kind === 'research')
    const wantsVideos =
      objectives.some((o) => o.kind === 'watch') ||
      researchSteps.some((o) => /\byoutube|video|chaine\b/.test(normalize(o.text)))
    const topic = missionTopic(objectives, task.name, task.description)

    const { team } = await loadTeam(preferredAgentIds)
    const scout = pickByRole(team, ['chercheur', 'specialiste'], team[0] ?? VIRTUAL_TEAM[0])
    const analyst = pickByRole(team, ['analyste', 'chercheur', 'specialiste'], VIRTUAL_TEAM[1])
    const writer = pickByRole(team, ['redacteur', 'analyste', 'specialiste'], VIRTUAL_TEAM[2])

    await addProgress(
      taskId,
      `Mission « ${task.name} » prise en charge par l'équipe : ${team.map(agentTag).join(' · ')}`,
      'running'
    )

    // ── Phase 1 : recherches (par les chercheurs) ──
    const allFindings: Finding[] = []
    const seenUrls = new Set<string>()
    // Les étapes de recherche viennent des objectifs « research » ; s'il n'y en
    // a PAS (mission « regarde la vidéo de X »), les objectifs « watch »/« retain »
    // PILOTENT la recherche — sinon la mission cherche sur le nom de la mission
    // et ramasse n'importe quoi (bug « teste des interrupteurs » au lieu de fugu).
    const drivingObjectives =
      researchSteps.length > 0
        ? researchSteps
        : objectives.filter((o) => o.kind === 'watch' || o.kind === 'retain').slice(0, MAX_RESEARCH_STEPS)
    const steps =
      drivingObjectives.length > 0
        ? drivingObjectives.slice(0, MAX_RESEARCH_STEPS).map((o, i) => ({
            objective: o.text,
            queries: [extractTopic(o.text) || topic, topic].filter(
              (q, idx, arr) => q.length >= 3 && arr.indexOf(q) === idx
            ),
            sources: sourceHints(o.text),
            round: i,
          }))
        : [{ objective: topic || task.name, queries: [topic || task.name], sources: ['google', 'youtube'] as SourceKey[], round: 0 }]

    for (const step of steps) {
      try {
        // Rotation entre les chercheurs disponibles
        const researcher = team.length > 0 ? team[step.round % team.length] : scout
        const found = await phaseResearch(
          taskId,
          { label: step.objective, topic: step.queries[0] ?? step.objective, queries: step.queries, sources: step.sources },
          researcher,
          wantsVideos
        )
        let added = 0
        for (const f of found) {
          if (seenUrls.has(f.url)) continue
          seenUrls.add(f.url)
          allFindings.push(f)
          added++
        }
        await addProgress(taskId, `${agentTag(researcher)} : étape terminée — ${added} source(s) nouvelle(s) exploitable(s)`)
      } catch (err) {
        await addProgress(taskId, `Étape en difficulté (${err instanceof Error ? err.message.slice(0, 100) : 'erreur réseau'}) — je passe à la suite`)
      }
    }

    // ── Phase 2 : comprendre & retenir (l'analyste) ──
    const retainObjectives = objectives.filter((o) => o.kind === 'retain' || o.kind === 'watch')
    let notesSaved = 0
    if (allFindings.length > 0) {
      try {
        notesSaved = await phaseRetain(
          taskId,
          allFindings,
          retainObjectives[0]?.text ?? topic ?? task.name,
          task.name,
          analyst
        )
      } catch (err) {
        // Visible dans le journal : une analyse ratée ne doit pas être muette
        await addProgress(taskId, `${agentTag(analyst)} : ⚠️ analyse interrompue (${err instanceof Error ? err.message.slice(0, 120) : 'erreur inconnue'})`)
      }
    }

    // ── Phase 3 : synthèse / rapport (le rédacteur) ──
    await addProgress(taskId, `${agentTag(writer)} (rédacteur) : je rédige la synthèse finale à partir de ${allFindings.length} source(s)…`)
    const report = await writeReport(task, objectives, allFindings, notesSaved, team, topic)
    await db.task.update({
      where: { id: taskId },
      data: { report, reportAt: new Date() },
    })
    await saveLearnedNote(`Rapport — ${task.name.slice(0, 80)}`, report, 'Rapports', stems(task.name).slice(0, 4))

    const summary =
      allFindings.length === 0
        ? `⚠️ aucune source exploitable (réseau indisponible ?) — rapport explicatif rédigé`
        : `${allFindings.length} source(s) consultée(s) (${allFindings.filter((f) => f.kind === 'video').length} vidéo(s) regardée(s), ${allFindings.filter((f) => f.kind === 'page').length} page(s) lue(s)), ${notesSaved} info(s) retenue(s)`
    await addProgress(
      taskId,
      `✅ Mission terminée : ${summary}. 📄 Le rapport de synthèse est disponible — bouton « Voir le rapport »`,
      'done'
    )
  } catch (err) {
    await addProgress(taskId, `⚠️ Mission interrompue : ${err instanceof Error ? err.message.slice(0, 150) : 'erreur inconnue'}`, 'blocked')
  } finally {
    g.__nexusMissionRunning = false
  }
}

/** Déclenchement fire-and-forget (chat, panneau, worker). */
export function startMissionRun(taskId: string): void {
  if (!taskId) return
  void runMission(taskId)
}

// ── Worker : file d'attente des missions « todo » ────────────────────────────

async function recoverStaleMissions(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - STALE_RUNNING_MS)
    const stale = await db.task.findMany({ where: { status: 'running', updatedAt: { lt: cutoff } }, take: 5 })
    for (const t of stale) {
      await addProgress(t.id, 'Mission reprise après redémarrage — remise dans la file', 'todo')
    }
  } catch {
    /* base indisponible : tant pis */
  }
}

async function workerTick(): Promise<void> {
  if (g.__nexusMissionRunning) return
  try {
    const next = await db.task.findFirst({
      where: { status: 'todo' },
      orderBy: { createdAt: 'asc' },
      take: 1,
    })
    if (next) await runMission(next.id)
  } catch {
    /* base indisponible */
  }
}

/** Démarre le worker de missions (idempotent, remplaçable au hot-reload). */
export function startMissionWorker(): void {
  if (g.__nexusMissionStop) {
    try {
      g.__nexusMissionStop()
    } catch {
      /* ancien worker déjà mort */
    }
    g.__nexusMissionStop = undefined
  }
  if (g.__nexusMissionWorker) return
  g.__nexusMissionWorker = true
  void recoverStaleMissions()
  const timer = setInterval(() => {
    void workerTick()
  }, WORKER_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  g.__nexusMissionStop = () => {
    clearInterval(timer)
    g.__nexusMissionWorker = false
  }
}
