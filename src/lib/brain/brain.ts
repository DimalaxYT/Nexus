// ─── NEXUS Brain v3 — Moteur hybride (LLM opportuniste + compétences locales) ─
// Philosophie : INTELLIGENT quand le LLM répond, RAPIDE et FIABLE toujours.
// 1. Chemins déterministes instantanés (salutations, maths, heure, identité…)
// 2. Boucle agentique LLM : décision JSON → outils → réponse VRAIMENT streamée
// 3. Repli local instantané sur toute indisponibilité (429/timeout/réseau)
// Les événements SSE (contrat v1) restent identiques → client inchangé.

import { db } from '@/lib/db'
import { isDuplicateMemory } from '@/lib/memory-utils'
import { captureScreenshot, rasterizeSvg } from '@/lib/screenshot'
import type { AgentEvent, AgentTool, ChatTarget, CodeFiles, SourceItem } from '@/lib/nexus-types'
import { CODER_TOOLS, parseAgentRow, parseAgentGroupRow, ROLE_LABELS, type NexusAgent } from '@/lib/nexus-types'
import { classify, extractTopic, overlap, warmUpClassifier, type Classification } from './classifier'
import { extractEntities, type Entities } from './entities'
import { evaluateMath } from './math-engine'
import { generateCodeLocal } from './codegen'
import { generateWebpageLocal } from './webpagegen'
import { generateArt } from './artgen'
import { generateSceneLocal } from './scenegen'
import { renderVideo } from './videogen'
import { webSearch, readWebpage, isMediaDomain, type SearchResult } from './search'
import { searchYouTubeNative, searchYouTubeChannels, latestChannelVideo, readYouTubeVideo, type YouTubeSearchHit, type YouTubeChannelHit } from './youtube'
import { searchKnowledgeBank } from './knowledge-bank'
import { extractKeySentences, synthesizePages, buildSearchQuery, type PageContent } from './synthesize'
import { extractMemories, extractExplicitRetention, autoTitle } from './memory-rules'
import * as R from './responder'
import { stems } from './text'
import { llmComplete, llmStream, extractJson, type LlmMessage } from '@/lib/llm'
import { startMissionRun } from '@/lib/mission-runner'
import { runEnsemble, personaSystemPrompt, NEXUS_SPEAKER } from './ensemble'
import { fetchRecentEmails, fetchGithubActivity, fetchTikTokProfile, emailFactsBlock, githubFactsBlock, tiktokFactsBlock } from '../connections-tools'

export interface BrainInput {
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** Destinataire de la discussion (sélecteur du chat). Défaut : NEXUS seul. */
  target?: ChatTarget
  /**
   * Code ACTUEL du Studio Code de l'utilisateur : quand il est fourni (discussion
   * avec un agent), l'agent peut le LIRE et le retoucher — mais jamais
   * directement : il produit une PROPOSITION validable (diff) au lieu d'écraser les fichiers.
   */
  currentCode?: CodeFiles
}

export type Emit = (event: AgentEvent) => void

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Ctx {
  lastUser: string
  /** Demande effectivement envoyée au LLM : lastUser enrichie du contexte de suivi. */
  effectiveUser: string
  history: { role: 'user' | 'assistant'; content: string }[]
  entities: Entities
  memories: string[]
  send: Emit
  isFirstExchange: boolean
  /** Outils autorisés (spécialisation codeur) — undefined = tous autorisés. */
  allowedTools?: Set<string>
  /** Code actuel du Studio Code (discussion avec un agent) — activé le mode PROPOSITION. */
  currentCode?: CodeFiles
  /** Agent qui parle actuellement (identité pour les propositions de code). */
  agentName?: string
  agentEmoji?: string
  /**
   * Mode PROPOSITION : l'agent a accès au code existant → toute génération de
   * code devient une proposition à valider (jamais une écriture directe).
   */
  proposalMode?: boolean
  /** Outils déjà exécutés en pré-chargement (facts injectés) — retirés du protocole. */
  excludeTools?: Set<string>
}

// ── Aides d'émission ─────────────────────────────────────────────────────────

let stepCounter = 0

function makeStep(tool: AgentTool, label: string, detail: string) {
  stepCounter++
  return { id: `step-${stepCounter}`, tool, label, detail }
}

/**
 * Stream local : la composition est instantanée, on découpe par paquets
 * très larges avec un délai minimal (fluide SANS latence artificielle).
 */
async function streamText(text: string, send: Emit): Promise<void> {
  const chunks = text.match(/\S+\s*/g) ?? [text]
  let buffer = ''
  for (let i = 0; i < chunks.length; i++) {
    buffer += chunks[i]
    if (buffer.length >= 90 || i === chunks.length - 1) {
      send({ type: 'token', content: buffer })
      buffer = ''
      if (i < chunks.length - 1) await sleep(6)
    }
  }
}

// ── Accès DB : mémoire, connaissances, missions ──────────────────────────────

async function loadMemories(): Promise<string[]> {
  try {
    const rows = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 30, select: { content: true } })
    return rows.map((r) => r.content)
  } catch {
    return []
  }
}

async function saveMemoryItems(items: { content: string; kind: string }[]): Promise<number> {
  let added = 0
  try {
    const existing = await db.memory.findMany({ select: { content: true } })
    for (const item of items) {
      const content = item.content.trim().slice(0, 400)
      if (content.length < 8) continue
      if (isDuplicateMemory(content, existing)) continue
      await db.memory.create({ data: { content, kind: item.kind, source: 'auto' } })
      existing.push({ content })
      added++
    }
  } catch {
    /* la mémoire ne doit jamais bloquer */
  }
  return added
}

interface NoteRow {
  id: string
  title: string
  content: string
  category: string
  tags: string
}

async function searchNotes(query: string, max = 4): Promise<NoteRow[]> {
  try {
    const rows = await db.knowledge.findMany({ orderBy: { updatedAt: 'desc' }, take: 200 })
    const words = stems(query)
    const scored = rows
      .map((k) => {
        const hay = stems(`${k.title} ${k.category} ${k.tags} ${k.content}`)
        const haySet = new Set(hay)
        let score = 0
        for (const w of words) if (haySet.has(w)) score++
        return { k, score: score / Math.sqrt(words.length + 1) }
      })
      .filter((r) => r.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
    return scored.map((s) => s.k)
  } catch {
    return []
  }
}

async function saveNote(title: string, content: string, category: string, tags: string[]): Promise<'created' | 'updated' | 'error'> {
  try {
    const existing = await db.knowledge.findMany({ select: { id: true, title: true } })
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const match = existing.find((k) => norm(k.title) === norm(title))
    const data = { title, content, category, tags: JSON.stringify(tags) }
    if (match) {
      await db.knowledge.update({ where: { id: match.id }, data })
      return 'updated'
    }
    await db.knowledge.create({ data: { ...data, source: 'agent' } })
    return 'created'
  } catch {
    return 'error'
  }
}

async function updateMission(name: string, status: string, note: string): Promise<{ name: string; status: string; id?: string } | null> {
  try {
    const tasks = await db.task.findMany({ orderBy: { updatedAt: 'desc' }, take: 50 })
    const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    const target =
      (name &&
        (tasks.find((t) => norm(t.name) === norm(name)) ??
          tasks.find((t) => norm(t.name).includes(norm(name)) || norm(name).includes(norm(t.name))))) ||
      tasks.find((t) => t.status === 'running') ||
      tasks[0]
    if (!target) return null
    let progress: { at: string; note: string }[] = []
    try {
      const arr = JSON.parse(target.progress) as unknown
      if (Array.isArray(arr)) progress = arr as { at: string; note: string }[]
    } catch {
      /* vide */
    }
    if (note) progress.push({ at: new Date().toISOString(), note })
    await db.task.update({
      where: { id: target.id },
      data: { status, progress: JSON.stringify(progress.slice(-30)) },
    })
    return { name: target.name, status, id: target.id }
  } catch {
    return null
  }
}

/** Compétences récemment acquises (missions) — injectées dans le contexte LLM. */
async function loadRecentSkills(max = 10): Promise<{ title: string; content: string; category: string }[]> {
  try {
    const rows = await db.knowledge.findMany({
      where: { source: 'agent' },
      orderBy: { updatedAt: 'desc' },
      take: max,
      select: { title: true, content: true, category: true },
    })
    return rows.map((r) => ({ title: r.title, content: r.content.slice(0, 220), category: r.category }))
  } catch {
    return []
  }
}

async function loadActiveMissions(): Promise<{ name: string; status: string; duration: string; objectives: string }[]> {
  try {
    const rows = await db.task.findMany({ where: { status: { in: ['todo', 'running'] } }, orderBy: { updatedAt: 'desc' }, take: 5 })
    return rows.map((r) => ({ name: r.name, status: r.status, duration: r.duration, objectives: r.objectives.slice(0, 300) }))
  } catch {
    return []
  }
}

/** L'équipe d'agents créée par l'utilisateur — injectée dans le contexte de NEXUS. */
async function loadTeam(): Promise<{ name: string; emoji: string; role: string; prompt: string }[]> {
  try {
    const rows = await db.agentProfile.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
    return rows.map(parseAgentRow).map((a) => ({ name: a.name, emoji: a.emoji, role: ROLE_LABELS[a.role], prompt: a.prompt.slice(0, 120) }))
  } catch {
    return []
  }
}

// ── Compétence : recherche web locale (rapide + synthèse profonde) ───────────

async function skillSearch(query: string, ctx: Ctx): Promise<string> {
  const s = makeStep('web_search', 'Recherche web', query)
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: `Recherche multi-sources en parallèle (Google Actualités ∥ Bing ∥ DuckDuckGo) sur « ${query} », puis lecture des pages les plus pertinentes et synthèse extractive.` })

  const results = await webSearch(query, 8)
  if (!results || results.length === 0) {
    ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche web', detail: 'réseau indisponible — repli sur mes connaissances', status: 'done' })
    const bank = searchKnowledgeBank(query, 1)[0]
    return R.searchAnswer(query, [], true, bank ? bank.entry.answer : undefined)
  }

  const sources: SourceItem[] = results.map((r) => ({ title: r.title, url: r.url, domain: r.domain, snippet: r.snippet }))
  ctx.send({ type: 'sources', sources })
  ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche web', detail: `${sources.length} sources trouvées — lecture approfondie…`, status: 'running' })

  // Lecture en parallèle des meilleures pages (hors vidéos/réseaux sociaux)
  const goodPages = await readBestPages(results, 2)
  for (const p of goodPages) {
    ctx.send({ type: 'sources', sources: [{ title: p.title, url: p.url, domain: p.domain, snippet: p.text.slice(0, 220) }] })
  }

  ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche web', detail: `${sources.length} sources · ${goodPages.length} pages lues`, status: 'done' })

  const synthesis = synthesizePages(query, goodPages, 3, 8)
  return R.searchAnswerDeep(query, results, synthesis)
}

function safeDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

/**
 * Lit en parallèle les meilleures pages lisibles parmi les résultats
 * (4 candidates pour en garantir 2 réussies — les échecs réseau ne coûtent
 * rien grâce au parallélisme).
 */
async function readBestPages(results: SearchResult[], want = 2): Promise<PageContent[]> {
  const candidates = results.filter((r) => !isMediaDomain(r.url) && /^https?:\/\//.test(r.url)).slice(0, 4)
  const attempted = await Promise.all(
    candidates.map(async (r) => {
      const page = await readWebpage(r.url, 7000)
      return page ? { title: page.title, url: page.url, domain: safeDomain(page.url), text: page.text } : null
    })
  )
  return attempted.filter((p): p is PageContent => p !== null).slice(0, want)
}

// ── Compétence : lecture de page (avec capture d'écran locale) ───────────────

async function skillReadPage(url: string, ctx: Ctx): Promise<string> {
  const s = makeStep('read_webpage', 'Lecture de page', url)
  ctx.send({ type: 'step', ...s, status: 'running' })

  const page = await readWebpage(url, 9000)
  if (!page) {
    ctx.send({ type: 'step', ...s, tool: 'read_webpage', label: 'Lecture de page', detail: 'page inaccessible (réseau ou blocage)', status: 'error' })
    return `Je n'ai pas réussi à lire **${url}** (page inaccessible, timeout ou blocage réseau). Vérifie l'adresse — certains sites refusent aussi les lecteurs automatiques.`
  }

  const sources: SourceItem[] = [{ title: page.title, url: page.url, domain: safeDomain(page.url), snippet: page.text.slice(0, 220) }]
  ctx.send({ type: 'sources', sources })

  ctx.send({ type: 'step', ...s, tool: 'read_webpage', label: 'Lecture de page', detail: 'capture d’écran en cours…', status: 'running' })
  const shot = await captureScreenshot(url)
  ctx.send({
    type: 'webpage',
    url: page.url,
    title: page.title,
    text: page.text.slice(0, 3500),
    ...(shot ? { screenshot: shot.dataUrl } : {}),
  })
  ctx.send({ type: 'step', ...s, tool: 'read_webpage', label: 'Lecture de page', detail: shot ? 'lue + capturée' : 'lue (capture impossible)', status: 'done' })

  // Synthèse extractive du contenu (plus fine que les 4 premiers paragraphes)
  const topic = extractTopic(ctx.lastUser)
  const keyPoints = extractKeySentences(page.text, topic || page.title, 4)
  const apercu =
    keyPoints.length > 0
      ? keyPoints.map((p) => `> ${p}`).join('\n>\n')
      : page.text.split('\n').filter((p) => p.length > 80).slice(0, 4).map((p) => `> ${p.slice(0, 260)}`).join('\n>\n')
  return `J'ai lu **${page.title}** ${shot ? '(et pris une capture — panneau Navigateur)' : ''}.\n\n${apercu || page.text.slice(0, 500)}\n\n${page.text.length > 2000 ? '*Page longue : contenu condensé.* Veux-tu que je cherche un élément précis dedans ?' : ''}`
}

// ── Compétence : image procédurale ───────────────────────────────────────────

async function skillImage(prompt: string, size: string, ctx: Ctx): Promise<string> {
  const s = makeStep('generate_image', 'Génération d’image', prompt.slice(0, 70))
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: `Génération procédurale locale : détection du style, palette par graine déterministe (hash du prompt), composition algorithmique puis rastérisation PNG.` })

  const art = generateArt(prompt, size as '1024x1024')
  ctx.send({ type: 'step', ...s, tool: 'generate_image', label: 'Génération d’image', detail: `style ${art.style} en cours de rendu…`, status: 'running' })

  const png = await rasterizeSvg(art.svg, art.width, art.height)
  const dataUrl = png ?? `data:image/svg+xml;base64,${Buffer.from(art.svg, 'utf8').toString('base64')}`
  ctx.send({ type: 'image', id: `img-${Date.now()}`, dataUrl, prompt })
  ctx.send({ type: 'step', ...s, tool: 'generate_image', label: 'Génération d’image', detail: `art ${art.style} créé (${art.width}×${art.height})`, status: 'done' })
  return R.imageAnswer(art.description)
}

// ── Compétence : code (template local — repli si LLM indisponible) ───────────

async function skillCode(ctx: Ctx): Promise<string> {
  const topic = extractTopic(ctx.lastUser)
  const gen = generateCodeLocal(ctx.lastUser, ctx.entities, topic)
  const s = makeStep('generate_code', 'Écriture du code', `${gen.language} — ${gen.filename}`)
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: `Gabarit local : sujet « ${topic.slice(0, 60)} » → ${gen.filename} (${gen.language}), paramétrage par tes entités, commentaires français.` })
  const name = gen.filename.replace(/\.[^.]+$/, '').slice(0, 42) || 'Script'
  const files: CodeFiles = { html: '', css: '', js: gen.code, language: gen.language, filename: gen.filename }
  emitCodeArtifact(ctx, { name, files }, gen.description)
  if (ctx.proposalMode) {
    ctx.send({ type: 'step', ...s, tool: 'generate_code', label: 'Proposition de code', detail: `${gen.filename} (${gen.code.length} caractères) — à valider dans le Studio Code`, status: 'done' })
    return R.codeAnswer(gen.filename, gen.description, gen.language) + '\n\n*Proposition prête : ouvre le **Studio Code** → panneau « Propositions » pour la relire (diff) et la valider — ton code actuel n\'est pas modifié sans ta validation.*'
  }
  ctx.send({ type: 'step', ...s, tool: 'generate_code', label: 'Écriture du code', detail: `${gen.filename} (${gen.code.length} caractères) prêt dans l'éditeur`, status: 'done' })
  return R.codeAnswer(gen.filename, gen.description, gen.language)
}

// ── Compétence : page web (template local) ───────────────────────────────────

async function skillWebpage(ctx: Ctx): Promise<string> {
  const topic = extractTopic(ctx.lastUser)
  const gen = generateWebpageLocal(ctx.lastUser, topic)
  const s = makeStep('generate_webpage', 'Génération de page web', gen.description.slice(0, 70))
  ctx.send({ type: 'step', ...s, status: 'running' })
  const name = topic.split(/[.,;]/)[0].slice(0, 42) || 'Page web'
  emitCodeArtifact(ctx, { name, files: { html: gen.html, css: gen.css, js: gen.js } }, gen.description)
  ctx.send({ type: 'step', ...s, tool: 'generate_webpage', label: 'Génération de page web', detail: ctx.proposalMode ? 'proposition à valider dans le Studio Code' : `${gen.html.length + gen.css.length + gen.js.length} caractères — prête dans le Studio Code`, status: 'done' })
  return R.webpageAnswer(gen.description)
}

// ── Compétence : scène 3D ────────────────────────────────────────────────────

async function skillScene(ctx: Ctx): Promise<string> {
  const brief = extractTopic(ctx.lastUser) || ctx.lastUser
  const s = makeStep('create_3d_scene', 'Création 3D', brief.slice(0, 70))
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: `Composition procédurale : thème détecté, placement déterministe (graine = hash du brief), éclairage cohérent.` })
  const scene = generateSceneLocal(ctx.lastUser)
  ctx.send({ type: 'scene', scene })
  ctx.send({ type: 'step', ...s, tool: 'create_3d_scene', label: 'Création 3D', detail: `${scene.objects.length} objets — chargée dans le Studio 3D`, status: 'done' })
  return R.sceneAnswer(scene.name, scene.objects.length)
}

// ── Compétence : vidéo MP4 réelle (moteur procédural + ffmpeg) ───────────────

async function skillVideoWithPrompt(prompt: string, ctx: Ctx): Promise<string> {
  const s = makeStep('generate_video', 'Génération vidéo', prompt.slice(0, 70))
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: 'Moteur vidéo 100 % local : thème détecté depuis le prompt, rendu image par image (parallaxe, eau animée, particules, travelling caméra), encodage MP4 par ffmpeg.' })
  const durMatch = ctx.lastUser.match(/(\d{1,2})\s*(s\b|sec|secondes)/i)
  const requested = durMatch ? Math.max(3, Math.min(10, parseInt(durMatch[1], 10))) : 5
  const duration = requested >= 8 ? 10 : 5
  try {
    const res = await renderVideo(prompt, { duration, quality: 'speed' })
    ctx.send({ type: 'video', id: res.id, url: res.url, prompt })
    ctx.send({ type: 'step', ...s, tool: 'generate_video', label: 'Génération vidéo', detail: `${res.theme} — ${res.frames} images rendues en ${(res.ms / 1000).toFixed(1)} s`, status: 'done' })
    return R.videoAnswer(res.theme, res.description, res.url)
  } catch (err) {
    ctx.send({ type: 'step', ...s, tool: 'generate_video', label: 'Génération vidéo', detail: err instanceof Error ? err.message.slice(0, 90) : 'échec du rendu', status: 'error' })
    return R.videoHonest(prompt)
  }
}

async function skillVideo(ctx: Ctx): Promise<string> {
  return skillVideoWithPrompt(extractTopic(ctx.lastUser) || ctx.lastUser, ctx)
}

// ── Compétence : suivi de mission (manuel) ───────────────────────────────────

async function skillTask(ctx: Ctx): Promise<string> {
  const text = ctx.lastUser
  const s = makeStep('update_task', 'Suivi de mission', text.slice(0, 60))
  ctx.send({ type: 'step', ...s, status: 'running' })

  const nameMatch = text.match(/mission\s+(?:de\s+|«\s*|["']\s*)([\p{L}\d\s'-]{3,50}?)(?:\s*»|["']|[,.:!?]|$)/iu)
  const name = (nameMatch?.[1] ?? '').trim().slice(0, 80)
  let status = 'running'
  if (/termin|fini|clotur|done/i.test(text)) status = 'done'
  else if (/bloqu|probl[èe]me|block/i.test(text)) status = 'blocked'
  else if (/r[ée]ouvr|reactive|todo|a faire/i.test(text)) status = 'todo'
  const note =
    text
      .replace(/^(mets? [àa] jour|avancement|statut|bilan|note dans)\s*(de la |la )?mission[^:]*:?/i, '')
      .trim()
      .slice(0, 400) || `Point d'étape enregistré`

  const result = await updateMission(name, status, note)
  if (!result) {
    ctx.send({ type: 'step', ...s, tool: 'update_task', label: 'Suivi de mission', detail: 'aucune mission trouvée', status: 'error' })
    return R.taskNotFound(name)
  }
  const statusLabel = result.status === 'running' ? 'en cours' : result.status === 'done' ? 'terminée' : result.status === 'blocked' ? 'bloquée' : 'à faire'
  ctx.send({ type: 'task', name: result.name, status: result.status, note })
  ctx.send({ type: 'step', ...s, tool: 'update_task', label: 'Suivi de mission', detail: `${result.name} → ${statusLabel}`, status: 'done' })
  return R.taskUpdated(result.name, statusLabel, note)
}

// ── Compétence : base de connaissances ───────────────────────────────────────

async function skillKnowledgeSave(ctx: Ctx): Promise<string> {
  const text = ctx.lastUser
  const s = makeStep('save_knowledge', 'Base de connaissances', text.slice(0, 60))
  ctx.send({ type: 'step', ...s, status: 'running' })

  const m = text.match(/(?:retiens|note\s+(?:ca|ça|que)|enregistre|souviens.?toi\s+que|stocke|ajoute\s+(?:a\s+)?(?:ma|ta)\s+base)\s*:?\s*(.{10,2000})/i)
  const content = (m?.[1] ?? text).trim()
  const words = content.split(/\s+/).slice(0, 6).join(' ')
  const title = (words.length > 3 ? words : 'Note').replace(/[.,;:!?]+$/, '').slice(0, 80)
  const tags = stems(text).slice(0, 5)
  const category = /roblox|luau/i.test(text) ? 'Programmation/Roblox' : /python|code|script/i.test(text) ? 'Programmation' : 'Général'

  const result = await saveNote(title, content, category, tags)
  if (result === 'error') {
    ctx.send({ type: 'step', ...s, tool: 'save_knowledge', label: 'Base de connaissances', detail: 'échec d’enregistrement', status: 'error' })
    return R.apology('écriture en base impossible')
  }
  ctx.send({ type: 'knowledge', title, category })
  ctx.send({ type: 'step', ...s, tool: 'save_knowledge', label: 'Base de connaissances', detail: `« ${title} » → ${category}`, status: 'done' })
  return R.knowledgeSaved(title, category)
}

async function skillKnowledgeQuery(ctx: Ctx): Promise<string> {
  const query = extractTopic(ctx.lastUser)
  const s = makeStep('search_knowledge', 'Recherche dans tes notes', query)
  ctx.send({ type: 'step', ...s, status: 'running' })

  const notes = await searchNotes(query, 4)
  const bankHits = searchKnowledgeBank(query, 1)

  if (notes.length === 0 && bankHits.length === 0) {
    ctx.send({ type: 'step', ...s, tool: 'search_knowledge', label: 'Recherche dans tes notes', detail: 'aucune note trouvée', status: 'done' })
    return R.knowledgeNotFound(query)
  }

  ctx.send({ type: 'step', ...s, tool: 'search_knowledge', label: 'Recherche dans tes notes', detail: `${notes.length} note${notes.length > 1 ? 's' : ''} trouvée${notes.length > 1 ? 's' : ''}`, status: 'done' })

  const notePart = notes
    .map((k) => `**— ${k.title}** [${k.category}]\n${k.content.slice(0, 700)}`)
    .join('\n\n')
  const bankPart = bankHits.length > 0 && notes.length === 0 ? bankHits[0].entry.answer : ''
  return `Voici ce que j'ai retrouvé${notes.length > 0 ? ' dans **ta** base de connaissances' : ''} sur « ${query} » :\n\n${notePart || bankPart}\n\n*Tu peux enrichir ces notes : dis-moi « retiens que … » à tout moment.*`
}

// ── Compétence : « regarde la dernière vidéo de X » (YouTube RÉEL) ──────────
// Historique : « Peux-tu regarder la dernière vidéo youtube de fugu… » était
// classée intention « video » (génération) et l'agent répondait « je ne peux
// pas générer de vidéos » — à côté de la plaque. Désormais :
//   1. détection DÉTERMINISTE des demandes de visionnage (jamais la génération),
//   2. recherche de la CHAÎNE (channelRenderer), puis SA dernière vidéo via
//      l'onglet /videos (le vrai « dernier »),
//   3. enrichissement (description / transcription quand YouTube les sert),
//   4. réponse factuelle — ET, en discussion avec un agent, un rappel NEXUS
//      dans une bulle séparée : l'utilisateur a TOUJOURS la réponse.

const VIDEO_SUBJECT_STOP = new Set([
  'et', 'ou', 'pour', 'me', 'moi', 'de', 'du', 'la', 'le', 'les', 'dis', 'dire', 'dit',
  'parle', 'parler', 'quoi', 'elle', 'il', 'son', 'sa', 'ses', 'ces', 'cette', 'ce',
  'qui', 'que', 'en', 'y', 'a', 'ensuite', 'apres', 'après', 'sur', 'veux', 'voudrais',
  'peux', 'tu', 'te', 'toi', 'svt', 'stp', 'merci', 'aujourd', 'hier', 'recemment', 'récemment',
])

function normLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Détecte une demande de VISIONNAGE (regarder/trouver une vidéo, pas en générer). */
export function isWatchVideoRequest(text: string): boolean {
  const t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Génération explicite (sans aucun mot de visionnage) → PAS une demande de visionnage
  if (/\b(genere|gener|generation|cree|creation|fabrique|dessine|fais[- ]moi une video)\b/i.test(t) && !/regarde|visionne|derniere|youtube|chaine|de quoi/i.test(t)) return false
  return (
    /derni[èe]res?\s+(?:vid[ée]o|clip)/i.test(text) ||
    /(?:regarde|regarder|regarder|visionn\w+|mate|mater|vois|voir)\b[^.?!]{0,60}\b(?:vid[ée]o|youtube|cha[îi]ne)/i.test(text) ||
    /\b(?:vid[ée]o|youtube|cha[îi]ne)\b[^.?!]{0,60}\b(?:de quoi|parle|parlent|parler)/i.test(text) ||
    /cha[îi]ne\s+(?:youtube\s+)?de\b/i.test(text)
  )
}

/** Extrait le sujet (chaîne/créateur) d'une demande « la vidéo de X ». */
export function extractVideoSubject(text: string): string {
  const cleaned = text.replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()
  const m =
    cleaned.match(/(?:vid[ée]os?|cha[îi]nes?|youtube)\s*(?:youtube\s*)?(?:de|du|d'|sur)\s+([\p{L}\d'’-]+(?:\s+[\p{L}\d'’-]+)?)/iu) ??
    cleaned.match(/(?:de|du|d')\s+([\p{L}\d'’-]+(?:\s+[\p{L}\d'’-]+)?)\s*(?:me\s*)?(?:dire|dis|parle)/iu)
  if (!m) return ''
  const kept: string[] = []
  for (const w of m[1].trim().split(/\s+/)) {
    if (VIDEO_SUBJECT_STOP.has(w.toLowerCase())) break
    kept.push(w)
  }
  return kept.join(' ').trim()
}

interface YouTubeWatchData {
  subject: string
  video: YouTubeSearchHit
  channelUrl: string
  description: string
  transcriptWords: number
  alternatives: YouTubeSearchHit[]
  foundViaChannel: boolean
}

/**
 * Trouve la DERNIÈRE vidéo du sujet demandé : recherche de chaîne d'abord
 * (onglet /videos = le vrai dernier), repli sur la recherche vidéo native.
 * N'émet AUCUN événement : la même préparation sert le chemin déterministe
 * (NEXUS), l'agent seul (injection de résultats) et le collectif.
 */
async function prepareYouTubeWatch(subjectRaw: string): Promise<YouTubeWatchData | null> {
  const subject = subjectRaw.trim()
  const subjNorm = normLabel(subject)

  // 1) Recherche de CHAÎNES
  let channel: YouTubeChannelHit | null = null
  if (subjNorm.length >= 2) {
    const channels = await searchYouTubeChannels(subject, 6)
    const scored = channels
      .map((c) => {
        const t = normLabel(c.title)
        let sc = 0
        if (t === subjNorm) sc += 3
        if (t.includes(subjNorm)) sc += 2
        else if (subjNorm.includes(t) && t.length >= 3) sc += 1
        return { c, sc }
      })
      .sort((a, b) => b.sc - a.sc)
    if (scored[0] && scored[0].sc > 0) channel = scored[0].c
  }

  let video: YouTubeSearchHit | null = null
  let alternatives: YouTubeSearchHit[] = []
  let foundViaChannel = false

  // 2) SA dernière vidéo (onglet /videos — ordonné du plus récent)
  if (channel) {
    video = await latestChannelVideo(channel.channelId, channel.handle)
    if (video) foundViaChannel = true
  }

  // 3) Repli : recherche vidéo native, meilleure correspondance de chaîne
  if (!video) {
    const queries = [subject ? `dernière vidéo ${subject}` : '', subject, ...(subject ? [subject.split(/\s+/)[0]] : [])].filter(Boolean)
    const seen = new Set<string>()
    const all: YouTubeSearchHit[] = []
    for (const q of queries) {
      const hits = await searchYouTubeNative(q, 8)
      for (const h of hits) if (!seen.has(h.videoId)) { seen.add(h.videoId); all.push(h) }
      if (all.length >= 8) break
    }
    const matched = subjNorm ? all.filter((h) => normLabel(h.channel).includes(subjNorm)) : []
    alternatives = (matched.length > 0 ? matched : all).slice(0, 4)
    video = matched[0] ?? all[0] ?? null
  }

  if (!video) return null

  // 4) Enrichissement (description quand YouTube ne bloque pas, sinon snippet)
  //    Le snippet des recherches natives est souvent la ligne « 163 k · il y a 11 j » :
  //    c'est une MÉTADONNÉE, pas une description — on ne la confond pas.
  const full = await readYouTubeVideo(video.url)
  const metaLike = /^[\d.,]+\s*[kKmM]?\s*·\s*il y a /.test(video.snippet)
  const description = (full?.description || (metaLike ? '' : video.snippet) || '').trim()
  return {
    subject,
    video,
    channelUrl: channel?.url ?? '',
    description,
    transcriptWords: full?.transcript ? full.transcript.split(/\s+/).length : 0,
    alternatives,
    foundViaChannel,
  }
}

/** Données de recherche → bloc injectable dans un prompt (agents, collectif). */
function youtubeFactsBlock(d: YouTubeWatchData): string {
  const parts = [
    `VIDÉO TROUVÉE : « ${d.video.title} »`,
    `Chaîne : ${d.video.channel || d.subject}`,`Durée : ${d.video.duration || 'inconnue'}`,
    d.video.snippet && !d.description ? `Aperçu : ${d.video.snippet.slice(0, 300)}` : '',
    d.description ? `De quoi elle parle : ${d.description.slice(0, 700)}` : '',
    `Lien : ${d.video.url}`,
    d.alternatives.length > 1 ? `Autres vidéos récentes : ${d.alternatives.slice(1, 4).map((h) => `« ${h.title.slice(0, 60)} » (${h.channel})`).join(', ')}` : '',
  ]
  return parts.filter(Boolean).join('\n')
}

/** « 163 k · il y a 11 j » (métadonnées YouTube natives) → ligne lisible. */
function youtubeMetaLine(snippet: string): string {
  const m = snippet.match(/^([\d.,]+\s*[kKmM]?)\s*·\s*(il y a .+)$/)
  if (m) return `Vues : ${m[1]} · publiée ${m[2]}`
  return ''
}

/** Réponse factuelle finale (markdown) — sert NEXUS et le rappel après-agent. */
function youtubeWatchAnswer(d: YouTubeWatchData): string {
  const dur = d.video.duration ? ` (${d.video.duration})` : ''
  const chLine = d.channelUrl ? `[${d.video.channel || d.subject}](${d.channelUrl})` : d.video.channel || d.subject
  const meta = youtubeMetaLine(d.video.snippet)
  const about = d.description
    ? d.description
        .split(/(?<=[.!?])\s+/)
        .slice(0, 3)
        .join(' ')
        .slice(0, 480)
    : ''
  const alt = d.alternatives.length > 1
    ? `\n\n**Autres vidéos récentes de la chaîne :**\n${d.alternatives.slice(1, 4).map((h) => `- « ${h.title} »${h.duration ? ` (${h.duration})` : ''}`).join('\n')}`
    : ''
  const head = d.foundViaChannel
    ? `J'ai trouvé la **dernière vidéo** de **${chLine}**${dur} :`
    : `Voici la vidéo la plus pertinente que j'ai trouvée pour **${d.subject}**${dur} :`
  const body = [meta, about, !about ? '*La description détaillée n\'est pas accessible depuis ce serveur (YouTube bloque les IP de datacenter) — le titre, la chaîne et la durée ci-dessus viennent en direct de YouTube.*' : '']
    .filter(Boolean)
    .join('\n\n')
  return `${head}\n\n## 🎬 ${d.video.title}\n\n${body}\n\n▶️ **Regarder :** ${d.video.url}${alt}`
}

/** Compétence complète (chemin déterministe NEXUS) : étapes + sources + réponse. */
async function skillYouTubeWatch(ctx: Ctx): Promise<string> {
  const subject = extractVideoSubject(ctx.lastUser)
  const s = makeStep('web_search', 'Recherche YouTube', subject ? `dernière vidéo de « ${subject} »` : ctx.lastUser.slice(0, 60))
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: `Je cherche la chaîne de « ${subject || 'ce créateur'} » sur YouTube, puis je lis son onglet de vidéos pour trouver LA plus récente — pas une simple recherche par pertinence.` })

  const data = await prepareYouTubeWatch(subject || ctx.lastUser.slice(0, 60))
  if (!data) {
    ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche YouTube', detail: 'aucune chaîne/vidéo trouvée', status: 'error' })
    return `Je n'ai pas trouvé de chaîne YouTube correspondant à « ${subject || ctx.lastUser.slice(0, 60)} ». Peux-tu vérifier l'orthographe exacte du nom (ou me donner le lien de la chaîne/vidéo) ? Je relirai immédiatement.`
  }

  const sources: SourceItem[] = [
    { title: data.video.title, url: data.video.url, domain: 'youtube.com', snippet: `${data.video.channel}${data.video.duration ? ` · ${data.video.duration}` : ''}${data.description ? ` · ${data.description.slice(0, 140)}` : ''}` },
    ...data.alternatives.slice(1, 3).map((h) => ({ title: h.title, url: h.url, domain: 'youtube.com', snippet: `${h.channel}${h.duration ? ` · ${h.duration}` : ''}` })),
  ]
  ctx.send({ type: 'sources', sources })
  ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche YouTube', detail: `« ${data.video.title.slice(0, 50)} » — ${data.video.channel}`, status: 'done' })
  return youtubeWatchAnswer(data)
}

// ── Comptes connectés : détecteurs + compétences déterministes ───────────────

const noAccents = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '')

/** « lis ma boîte mail », « mes mails », « tu as de nouveaux mails ? »… */
export function isInboxRequest(text: string): boolean {
  const t = noAccents(text.toLowerCase())
  if (/\b(genere|cree|fabrique|ecri[s]?[t]?|programme)\b/.test(t) && !/\bmail|boite/.test(t)) return false
  return (
    /\b(lis|lire|regarde|regarder|verifie|check|ouvre|montre|affiche|consulte)\b[^.?!]{0,30}\b(ma|mes|la|mon|des)?\s*(mails?|boite mail|courriels?|inbox)\b/.test(t) ||
    /\b(ma|mes)\s+(mails?|boite mail|courriels?|inbox)\b/.test(t) ||
    /\b(nouveaux?|nouveautes?|derniers?)\s+mails?\b/.test(t) ||
    /\bai[- ]je\s+(des|de|mes)\s+mails?\b/.test(t)
  )
}

/** « mes repos GitHub », « mes notifications GitHub », « regarde mon GitHub »… */
export function isGithubAccountRequest(text: string): boolean {
  const t = noAccents(text.toLowerCase())
  if (!/\bgithub\b/.test(t)) return false
  // Demande de recherche/création générique ≠ consultation du COMPTE relié
  if (/\b(genere|cree|fabrique|code)\b/.test(t) && !/\b(mes|mon)\b/.test(t)) return false
  return (
    /\b(mes|mon)\b.{0,24}\bgithub\b/.test(t) ||
    /\bgithub\b.{0,24}\b(mes|mon)\b/.test(t) ||
    /\b(notifications?|repos?|activite|profil)\s+github\b/.test(t) ||
    (/^\s*(regarde|regarder|verifie|check|consulte|montre|affiche)\b/.test(t) && /\bgithub\b.{0,20}\b(notifications?|repos?|compte|activite|profil)\b/.test(t))
  )
}

/** « mon TikTok », « mon profil TikTok », « regarde mon compte TikTok »… */
export function isTiktokAccountRequest(text: string): boolean {
  const t = noAccents(text.toLowerCase())
  if (!/\btiktok\b/.test(t)) return false
  if (/\b(genere|cree|fabrique)\b/.test(t) && !/\b(mon|ma|mes)\b/.test(t)) return false
  return (
    /\b(mon|ma|mes)\b.{0,18}\btiktok\b/.test(t) ||
    /\btiktok\b.{0,18}\b(mon|ma|mes)\b/.test(t) ||
    (/^\s*(regarde|regarder|verifie|check|consulte|montre|affiche|lis)\b/.test(t) && /\btiktok\b.{0,14}\b(profil|compte|videos?)\b/.test(t))
  )
}

/** Lecture réelle de la boîte mail connectée (chemin déterministe). */
async function skillCheckEmail(ctx: Ctx): Promise<string> {
  const s = makeStep('check_email', 'Boîte mail', 'lecture IMAP de la boîte connectée')
  ctx.send({ type: 'step', ...s, status: 'running' })
  ctx.send({ type: 'thought', text: 'Connexion IMAP réelle à la boîte Gmail reliée (le mot de passe d\'application est stocké localement) : je récupère les derniers mails avec expéditeurs, sujets, dates et extraits.' })
  const result = await fetchRecentEmails(6)
  if (!result.ok) {
    ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: result.note ?? 'boîte inaccessible', status: 'error' })
    return result.note?.startsWith('Aucun compte') ? R.notConnected('Gmail') : `Je n'ai pas réussi à lire ta boîte mail : ${result.note ?? 'erreur inconnue'}. Réessaie dans un instant — ou vérifie la connexion dans le panneau **Connexions**.`
  }
  ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: `${result.emails.length} mail(s) lus en direct`, status: 'done' })
  return R.emailAnswer(result.emails)
}

/** Activité réelle du compte GitHub connecté (API officielle). */
async function skillGithubAccount(ctx: Ctx): Promise<string> {
  const s = makeStep('github_activity', 'GitHub', 'repos + notifications du compte connecté')
  ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: 'appel de l\'API GitHub officielle…', status: 'running' })
  ctx.send({ type: 'thought', text: 'J\'interroge l\'API GitHub avec le token relié : profil, repos poussés récemment, notifications en attente.' })
  const result = await fetchGithubActivity()
  if (!result.ok) {
    ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: result.note ?? 'compte inaccessible', status: 'error' })
    return result.note?.startsWith('Aucun compte') ? R.notConnected('GitHub') : `Je n'ai pas réussi à lire ton compte GitHub : ${result.note ?? 'erreur inconnue'}. Réessaie dans un instant.`
  }
  ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: `${result.repos.length} repos · ${result.notifications.length} notifications`, status: 'done' })
  return R.githubAnswer(result)
}

/** Profil TikTok relié : stats + dernières vidéos (page publique). */
async function skillTiktokAccount(ctx: Ctx): Promise<string> {
  const s = makeStep('tiktok_activity', 'TikTok', 'profil connecté + dernières vidéos')
  ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: 'lecture du profil public…', status: 'running' })
  ctx.send({ type: 'thought', text: 'Je lis le profil TikTok relié : abonnés, j\'aime, et les dernières vidéos avec leurs compteurs réels.' })
  const result = await fetchTikTokProfile()
  if (!result.ok) {
    ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: result.note ?? 'profil inaccessible', status: 'error' })
    return result.note?.startsWith('Aucun compte') ? R.notConnected('TikTok') : `Je n'ai pas réussi à lire ton TikTok : ${result.note ?? 'erreur inconnue'}. Réessaie dans un instant.`
  }
  ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: `@${result.handle} · ${result.videos.length} vidéos récentes`, status: 'done' })
  return R.tiktokAnswer(result)
}

async function handleMissionMessage(text: string, ctx: Ctx): Promise<string> {
  const s = makeStep('update_task', 'Mission reçue', text.slice(0, 60))
  ctx.send({ type: 'step', ...s, status: 'running' })

  const nameMatch = text.match(/MISSION\s*:\s*([^\n]+)/i)
  const name = (nameMatch?.[1] ?? 'Mission').trim().slice(0, 100)
  const objectives = (text.match(/Objectifs\s*:\s*([^\n]+)/i)?.[1] ?? '').trim()
  const description = (text.match(/Description\s*:\s*([\s\S]+)$/i)?.[1] ?? '').trim().slice(0, 600)

  const result = await updateMission(name, 'running', 'Mission prise en charge — exécution autonome démarrée')
  if (result) {
    ctx.send({ type: 'task', name: result.name, status: 'running', note: 'Mission prise en charge — exécution autonome démarrée' })
    ctx.send({ type: 'step', ...s, tool: 'update_task', label: 'Mission', detail: `${result.name} → exécution en arrière-plan`, status: 'done' })
    // 🚀 Lancement du runner autonome (arrière-plan serveur : travaille même
    // quand tu n'es pas devant l'app). Toutes les erreurs sont gérées dedans.
    void startMissionRun(result.id ?? '')
  } else {
    ctx.send({ type: 'step', ...s, tool: 'update_task', label: 'Mission', detail: 'mission non trouvée en base', status: 'error' })
  }

  const plan: string[] = objectives
    ? objectives.split(/[,;/]|\bet\b/).map((o) => o.trim()).filter((o) => o.length > 2).slice(0, 5)
    : []
  const planText = plan.length > 0 ? `\n\n**Mon plan d'action :**\n${plan.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : ''
  const descText = description ? `\n\n> ${description.slice(0, 300)}` : ''
  return `Mission **« ${name} »** prise en charge ✅ — je travaille dessus **en arrière-plan**, même quand tu n'es pas devant l'application.${descText}${planText}

**Concrètement :** je vais chercher des informations sur le web (Google, YouTube, TikTok, sources IA), lire les meilleures pages, en extraire des compétences et les ranger dans ma base de connaissances pour m'améliorer. Chaque étape sera notée dans le **journal d'avancement** du panneau **Task**, avec un **rapport final** à la fin.

Tu peux vaquer à tes occupations — surveille le panneau Task, la progression est en direct. 🚀`
}

// ── Conversation générale (repli local) ──────────────────────────────────────

async function handleGeneral(ctx: Ctx, classification: Classification): Promise<string> {
  const topic = extractTopic(ctx.lastUser)

  // 1) Banque de connaissances intégrée
  const bankHit = searchKnowledgeBank(ctx.lastUser, 1)[0]
  if (bankHit && bankHit.score >= 0.9) {
    ctx.send({ type: 'thought', text: `Correspondance directe dans mon savoir intégré (${bankHit.entry.question}) — je réponds depuis la banque locale.` })
    return bankHit.entry.answer
  }

  // 2) Notes personnelles pertinentes
  const notes = await searchNotes(ctx.lastUser, 2)
  if (notes.length > 0 && overlap(ctx.lastUser, notes[0].title + ' ' + notes[0].content) > 0.5) {
    ctx.send({ type: 'thought', text: `Tes notes contiennent quelque chose de pertinent (${notes[0].title}) — je m'en sers.` })
    return `D'après **tes notes** sur ce sujet : \n\n**— ${notes[0].title}**\n${notes[0].content.slice(0, 600)}\n\nEt voici ce que mon savoir intégré ajoute : ${bankHit?.entry.answer.slice(0, 400) ?? 'demande-moi de chercher sur le web pour compléter !'}`
  }

  // 3) Réponse conversationnelle structurée
  ctx.send({ type: 'thought', text: `Pas de correspondance exacte (${Math.round(classification.confidence * 100)} % de confiance). Je réponds avec ma personnalité locale et je propose des actions concrètes.` })
  const memoryHits = ctx.memories.filter((m) => overlap(ctx.lastUser, m) > 0.3).slice(0, 3)
  return R.generalAnswer(topic, undefined, memoryHits)
}

// ── Moteur LLM : boucle agentique avec garde-fou JSON ────────────────────────

const TOOLS_PROTOCOL_LINES: { tool: string; spec: string }[] = [
  { tool: 'web_search', spec: '{"tool":"web_search","query":"...","site":"youtube.com|tiktok.com|(optionnel)"}' },
  { tool: 'read_webpage', spec: '{"tool":"read_webpage","url":"https://..."}' },
  { tool: 'generate_code', spec: '{"tool":"generate_code","language":"python|javascript|typescript|lua|csharp|...","filename":"main.py","brief":"ce qu\'il faut coder"}' },
  { tool: 'generate_webpage', spec: '{"tool":"generate_webpage","brief":"page web à créer"}' },
  { tool: 'generate_image', spec: '{"tool":"generate_image","prompt":"description visuelle"}' },
  { tool: 'generate_video', spec: '{"tool":"generate_video","prompt":"scène animée à filmer (paysage, ville, océan, espace, aurore…)"}' },
  { tool: 'create_3d_scene', spec: '{"tool":"create_3d_scene","brief":"scène à construire"}' },
  { tool: 'save_knowledge', spec: '{"tool":"save_knowledge","title":"...","content":"...","category":"..."}' },
  { tool: 'update_task', spec: '{"tool":"update_task","name":"...","status":"todo|running|done|blocked","note":"..."}' },
  { tool: 'check_email', spec: '{"tool":"check_email","max":6}' },
  { tool: 'github_activity', spec: '{"tool":"github_activity"}' },
  { tool: 'tiktok_activity', spec: '{"tool":"tiktok_activity"}' },
]

/** Protocole d'outils, filtré selon les autorisations de l'agent courant. */
function toolsProtocol(allowed?: Set<string>, exclude?: Set<string>): string {
  const lines = TOOLS_PROTOCOL_LINES.filter((l) => (!allowed || allowed.has(l.tool)) && (!exclude || !exclude.has(l.tool))).map((l) => l.spec)
  return `OUTILS DISPONIBLES — pour en appeler un, réponds UNIQUEMENT avec l'objet JSON correspondant (RIEN d'autre : aucun texte avant ni après, aucun préambule) :
${lines.join('\n')}
{"tool":"none"} — si aucun outil n'est utile.`
}
const TOOLS_PROTOCOL = toolsProtocol()

async function buildSystemPrompt(): Promise<string> {
  const now = new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
  const [memories, skills, missions, team] = await Promise.all([loadMemories(), loadRecentSkills(), loadActiveMissions(), loadTeam()])
  const parts: string[] = [
    `Tu es NEXUS, un agent IA autonome intégré dans une application web personnelle. Tu réponds TOUJOURS en français, de façon amicale, directe et efficace. Tu tutoies l'utilisateur.`,
    `Date et heure actuelles : ${now}.`,
  ]
  if (memories.length > 0) {
    parts.push(`MÉMOIRE LONGUE TERME sur l'utilisateur :\n${memories.slice(0, 12).map((m) => `- ${m}`).join('\n')}`)
  }
  if (team.length > 0) {
    parts.push(`TON ÉQUIPE D'AGENTS (créés par l'utilisateur, chacun avec son prompt personnel) :\n${team.map((a) => `- ${a.emoji} ${a.name} (${a.role})${a.prompt ? ` — « ${a.prompt} »` : ''}`).join('\n')}\nL'utilisateur peut leur parler directement via le sélecteur de destinataire : agent seul, table ronde (tous ou un groupe), ou BUREAU (les agents délibèrent ensemble et tu livres la réponse consolidée). Si on te demande qui ils sont, présente-les fidèlement.`)
  }
  if (skills.length > 0) {
    parts.push(`COMPÉTENCES QUE TU AS APPRISES lors de tes missions autonomes (utilise-les pour répondre plus justement) :\n${skills.map((s) => `- [${s.category}] ${s.title} : ${s.content}`).join('\n')}`)
  }
  if (missions.length > 0) {
    parts.push(`MISSIONS ACTIVES confiées par l'utilisateur :\n${missions.map((m) => `- « ${m.name} » (${m.status}${m.duration ? `, ${m.duration}` : ''})`).join('\n')}\nSi l'utilisateur parle de ses missions, tu connais leur état.`)
  }
  return parts.join('\n\n')
}

interface ToolCall {
  tool: string
  query?: string
  site?: string
  url?: string
  language?: string
  filename?: string
  brief?: string
  prompt?: string
  title?: string
  content?: string
  category?: string
  name?: string
  status?: string
  note?: string
  max?: number
}

/** Exécute un appel d'outil décidé par le LLM. Retourne le résultat injecté au LLM. */
async function executeTool(call: ToolCall, ctx: Ctx): Promise<{ result: string; sources?: SourceItem[]; artifact?: string }> {
  const tool = call.tool
  // Spécialisation : certains agents (codeurs) n'ont qu'un accès restreint aux outils
  if (ctx.allowedTools && !ctx.allowedTools.has(tool)) {
    const allowedList = [...ctx.allowedTools].join(', ')
    return { result: `Outil « ${tool} » NON AUTORISÉ pour ton rôle (spécialisation restreinte). Outils autorisés : ${allowedList}. Continue avec l'un de ceux-là ou réponds directement.` }
  }
  if (tool === 'web_search') {
    const baseQuery = (call.query ?? '').slice(0, 160) || extractTopic(ctx.lastUser)
    const isYoutube = /youtube/i.test(call.site ?? '')
    const s = makeStep('web_search', 'Recherche web', `${baseQuery}${call.site ? ` · site:${call.site}` : ''}`)
    ctx.send({ type: 'step', ...s, status: 'running' })

    // Stratégie à variantes : première tentative, puis reformulations si vide.
    // Les moteurs ratent souvent les requêtes trop spécifiques (« dernière vidéo
    // de X ») : on retente en simplifiant, et pour YouTube on double avec la
    // recherche NATIVE (ytInitialData) qui voit les vidéos que Bing ignore.
    const variants = [baseQuery]
    const simplified = baseQuery
      .replace(/(derni[èe]re|derni[èe]res|latest|nouvelle|nouvelles|r[ée]cente[s]?)\s+(vid[ée]o[s]?)\s+(de|du|d')?\s*/gi, '')
      .replace(/^(regarde?|regarder?|trouve?|cherche?|montre?|dis[- ]moi|fais[- ]moi)\s+(moi\s+)?/i, '')
      .trim()
    if (simplified && simplified.toLowerCase() !== baseQuery.toLowerCase()) variants.push(simplified)
    const shortWords = baseQuery.split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(' ')
    if (shortWords && shortWords.toLowerCase() !== simplified.toLowerCase()) variants.push(shortWords)

    let results: SearchResult[] | null = null
    let usedQuery = baseQuery
    for (const q of variants) {
      results = await webSearch(q, 8, call.site || undefined)
      if (results && results.length > 0) {
        usedQuery = q
        break
      }
    }

    // YouTube : toujours doubler avec la recherche native (résultats vidéo réels)
    let ytHits: Awaited<ReturnType<typeof searchYouTubeNative>> = []
    if (isYoutube) {
      ytHits = await searchYouTubeNative(usedQuery, 6)
      if ((ytHits.length === 0 || !results || results.length === 0) && variants.length > 1) {
        for (const q of variants.slice(1)) {
          ytHits = await searchYouTubeNative(q, 6)
          if (ytHits.length > 0) {
            usedQuery = q
            break
          }
        }
      }
    }

    if ((!results || results.length === 0) && ytHits.length === 0) {
      ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche web', detail: 'aucun résultat', status: 'done' })
      return { result: `Aucun résultat web pour « ${baseQuery} » (recherches essayées : ${variants.map((v) => `« ${v} »`).join(', ')}). Le sujet est peut-être trop récent, mal orthographié, ou peu référencé : propose à l'utilisateur de vérifier l'orthographe exacte (nom de chaîne, titre) ou de donner un lien direct.` }
    }

    const sources: SourceItem[] = [
      ...(results ?? []).map((r) => ({ title: r.title, url: r.url, domain: r.domain, snippet: r.snippet })),
      ...ytHits.map((h) => ({ title: h.title, url: h.url, domain: 'youtube.com', snippet: `${h.channel}${h.duration ? ` · ${h.duration}` : ''}${h.snippet ? ` · ${h.snippet.slice(0, 120)}` : ''}` })),
    ]
    ctx.send({ type: 'sources', sources })

    const goodPages = await readBestPages(results ?? [], 2)
    ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche web', detail: `${sources.length} sources · ${goodPages.length} pages lues${ytHits.length > 0 ? ` · ${ytHits.length} vidéos YouTube` : ''}`, status: 'done' })

    const extra = goodPages.map((p) => `PAGE LUE « ${p.title} » (${p.domain}):\n${p.text.slice(0, 3500)}`).join('\n\n')
    const ytPart =
      ytHits.length > 0
        ? `\n\nVIDÉOS YOUTUBE TROUVÉES (recherche native) :\n${ytHits.map((h, i) => `${i + 1}. « ${h.title} » — chaîne : ${h.channel}${h.duration ? ` · durée ${h.duration}` : ''}\n   ${h.url}${h.snippet ? `\n   résumé : ${h.snippet.slice(0, 200)}` : ''}`).join('\n')}\n→ Cite ces vidéos avec leur titre et leur chaîne ; pour « la dernière », prends la plus pertinente et dis ce que son titre/chaîne indiquent — propose de lire la page de la vidéo si l'utilisateur veut le détail.`
        : ''
    return { result: `RÉSULTATS DE RECHERCHE pour « ${usedQuery} » :\n${(results ?? []).map((r, i) => `${i + 1}. ${r.title} — ${r.domain} : ${r.snippet.slice(0, 260)}`).join('\n')}${ytPart}\n\n${extra}` }
  }
  if (tool === 'read_webpage' && call.url) {
    const text = await skillReadPage(call.url, ctx)
    return { result: `Contenu de la page :\n${text.slice(0, 3500)}` }
  }
  if (tool === 'generate_code') {
    const language = (call.language ?? 'python').slice(0, 20)
    const filename = (call.filename ?? 'script').slice(0, 60)
    const brief = (call.brief ?? extractTopic(ctx.lastUser)).slice(0, 500)
    const s = makeStep('generate_code', 'Écriture du code', `${language} — ${filename}`)
    ctx.send({ type: 'step', ...s, status: 'running' })
    // Le LLM écrit le code DANS sa réponse finale (markdown) — on lui demande ici
    return { result: `Tu dois maintenant écrire le code complet dans ta réponse finale : langage ${language}, fichier ${filename}. Demande : ${brief}. Mets le code dans un bloc markdown \`\`\`${language} … \`\`\` (un seul bloc, code complet et fonctionnel, commenté en français).`, artifact: 'code' }
  }
  if (tool === 'generate_webpage') {
    const brief = (call.brief ?? extractTopic(ctx.lastUser)).slice(0, 500)
    const s = makeStep('generate_webpage', 'Génération de page web', brief.slice(0, 70))
    ctx.send({ type: 'step', ...s, status: 'running' })
    return { result: `Tu dois maintenant créer la page web complète dans ta réponse finale. Demande : ${brief}. Format OBLIGATOIRE : trois blocs markdown distincts — \`\`\`html … \`\`\`, \`\`\`css … \`\`\`, \`\`\`javascript … \`\`\` (HTML sémantique responsive, CSS moderne, JS interactif ; textes en français).`, artifact: 'webpage' }
  }
  if (tool === 'generate_image') {
    const prompt = (call.prompt ?? ctx.lastUser).slice(0, 200)
    const text = await skillImage(prompt, '1024x1024', ctx)
    return { result: `Image générée localement (art procédural). Message affiché : ${text}` }
  }
  if (tool === 'generate_video') {
    const prompt = (call.prompt ?? extractTopic(ctx.lastUser) ?? ctx.lastUser).slice(0, 300)
    const text = await skillVideoWithPrompt(prompt, ctx)
    return { result: `Vidéo MP4 générée localement (moteur procédural + ffmpeg). Message affiché : ${text}` }
  }
  if (tool === 'create_3d_scene') {
    const text = await skillScene(ctx)
    return { result: `Scène 3D créée. Message affiché : ${text}` }
  }
  if (tool === 'save_knowledge' && call.title && call.content) {
    const title = call.title.slice(0, 120)
    const content = call.content.slice(0, 8000)
    const category = (call.category ?? 'Général').slice(0, 100)
    const res = await saveNote(title, content, category, stems(content).slice(0, 5))
    const s = makeStep('save_knowledge', 'Base de connaissances', title)
    ctx.send({ type: 'step', ...s, tool: 'save_knowledge', label: 'Base de connaissances', detail: `« ${title} » → ${category}`, status: res === 'error' ? 'error' : 'done' })
    if (res !== 'error') ctx.send({ type: 'knowledge', title, category })
    return { result: res === 'error' ? 'Échec de sauvegarde en base.' : `Note « ${title} » enregistrée dans ${category}.` }
  }
  if (tool === 'update_task') {
    const res = await updateMission(call.name ?? '', call.status ?? 'running', (call.note ?? '').slice(0, 400))
    if (res) {
      ctx.send({ type: 'task', name: res.name, status: res.status, note: call.note ?? '' })
      return { result: `Mission « ${res.name} » mise à jour (${res.status}).` }
    }
    return { result: 'Aucune mission trouvée en base.' }
  }
  if (tool === 'check_email') {
    const max = Math.min(8, Math.max(3, typeof call.max === 'number' ? call.max : 6))
    const s = makeStep('check_email', 'Boîte mail', 'lecture IMAP de la boîte connectée')
    ctx.send({ type: 'step', ...s, status: 'running' })
    const result = await fetchRecentEmails(max)
    if (!result.ok) {
      ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: result.note ?? 'boîte inaccessible', status: 'error' })
      return { result: `Lecture de la boîte mail IMPOSSIBLE : ${result.note ?? 'cause inconnue'}. Dis-le honnêtement à l'utilisateur et oriente-le vers le panneau Connexions pour (re)lier son compte Gmail.` }
    }
    ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: `${result.emails.length} mail(s) lus en IMAP`, status: 'done' })
    return { result: `${emailFactsBlock(result)}\n\nRésume ces mails pour l'utilisateur : expéditeur, sujet, ce qui semble attendre une réponse, et propose un suivi.` }
  }
  if (tool === 'github_activity') {
    const s = makeStep('web_search', 'GitHub', 'repos + notifications du compte connecté')
    ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: 'appel de l\'API GitHub officielle…', status: 'running' })
    const result = await fetchGithubActivity()
    if (!result.ok) {
      ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: result.note ?? 'compte inaccessible', status: 'error' })
      return { result: `Lecture GitHub IMPOSSIBLE : ${result.note ?? 'cause inconnue'}. Dis-le honnêtement et oriente vers le panneau Connexions.` }
    }
    ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: `${result.repos.length} repos · ${result.notifications.length} notifications`, status: 'done' })
    return { result: `${githubFactsBlock(result)}\n\nSynthétise cette activité : ce qui bouge, les notifications à traiter en priorité.` }
  }
  if (tool === 'tiktok_activity') {
    const s = makeStep('web_search', 'TikTok', 'profil connecté + dernières vidéos')
    ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: 'lecture du profil public…', status: 'running' })
    const result = await fetchTikTokProfile()
    if (!result.ok) {
      ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: result.note ?? 'profil inaccessible', status: 'error' })
      return { result: `Lecture TikTok IMPOSSIBLE : ${result.note ?? 'cause inconnue'}. Dis-le honnêtement et oriente vers le panneau Connexions.` }
    }
    ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: `@${result.handle} · ${result.videos.length} vidéos récentes`, status: 'done' })
    return { result: `${tiktokFactsBlock(result)}\n\nSynthétise : profil, tendances de vues entre les vidéos, idée de contenu si pertinent.` }
  }
  return { result: 'Outil inconnu — réponds directement.' }
}

/**
 * Émet un artefact de code : en mode PROPOSITION (agent avec accès au code de
 * l'utilisateur), l'artefact devient une PROPOSITION validable (diff dans le
 * Studio Code) — JAMAIS une écriture directe des fichiers.
 */
function emitCodeArtifact(ctx: Ctx, artifact: { name: string; files: CodeFiles }, note: string): void {
  if (ctx.proposalMode && ctx.currentCode) {
    const isWeb = !artifact.files.language || ['web', 'html'].includes(artifact.files.language)
    const proposal = {
      id: `prop-${Date.now()}`,
      agentName: ctx.agentName ?? 'Agent',
      agentEmoji: ctx.agentEmoji ?? '🤖',
      title: isWeb ? 'Page web proposée' : `Script proposé — ${artifact.files.filename ?? 'nouvelle version'}`,
      note: note.slice(0, 600),
      base: ctx.currentCode,
      proposed: artifact.files,
      at: Date.now(),
    }
    ctx.send({ type: 'proposal', proposal })
    ctx.send({ type: 'step', id: `step-prop-${Date.now()}`, tool: 'generate_code', label: 'Proposition de code', detail: `${artifact.name} — à relire et valider dans le Studio Code (ton code n'est pas modifié sans toi)`, status: 'done' })
    return
  }
  ctx.send({ type: 'code', code: artifact })
}

/** Parse les blocs de code markdown d'une réponse LLM → artefact Studio Code. */
function extractCodeArtifact(text: string, preferWeb: boolean): { name: string; files: CodeFiles } | null {
  const fences = [...text.matchAll(/```(\w+)?\n([\s\S]*?)```/g)]
  if (fences.length === 0) return null
  const get = (lang: string) => fences.find((f) => (f[1] ?? '').toLowerCase() === lang)?.[2]?.trim() ?? ''
  if (preferWeb && (get('html') || get('css') || get('javascript') || get('js'))) {
    const html = get('html')
    const css = get('css')
    const js = get('javascript') || get('js')
    if (html || css || js) {
      return { name: 'Page web NEXUS', files: { html, css, js } }
    }
  }
  const first = fences[0]
  const lang = (first[1] ?? 'code').toLowerCase()
  const code = first[2]?.trim() ?? ''
  if (code.length < 20) return null
  const extMap: Record<string, string> = { python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', lua: 'lua', luau: 'lua', csharp: 'cs', 'c#': 'cs', java: 'java', cpp: 'cpp', 'c++': 'cpp', c: 'c', go: 'go', rust: 'rs', bash: 'sh', sh: 'sh', sql: 'sql', glsl: 'glsl', html: 'html', css: 'css' }
  const ext = extMap[lang] ?? 'txt'
  const language = ['py', 'js', 'ts', 'lua', 'cs', 'java', 'cpp', 'c', 'go', 'rs', 'sh', 'sql', 'glsl'].includes(ext) ? (lang === 'py' ? 'python' : lang === 'lua' ? 'lua' : lang === 'rs' ? 'rust' : lang === 'cpp' ? 'cpp' : lang === 'cs' ? 'csharp' : lang) : ext === 'html' ? 'web' : 'javascript'
  return { name: 'Script NEXUS', files: { html: '', css: '', js: code, language, filename: `script.${ext}` } }
}

// ── Mémoire de chat : résolution des demandes de suivi ──────────────────────
// « réalise-le », « ok fais ça », « continue »… doivent pointer sur le sujet
// réellement discuté juste avant — sinon l'agent « ne comprend pas » alors
// qu'il a l'information dans l'historique.

const FOLLOWUP_PATTERN =
  /^(?:ok|alors|bon|ben|et)?\s*(?:vas[- ]?y|go\b|fais(?:[- ](?:le|la|les))?|r[ée]alise(?:[- ](?:le|la|les))?|ex[ée]cute(?:[- ](?:le|la|les))?|impl[ée]mente(?:[- ](?:le|la|les))?|lance(?:[- ](?:le|la|les))?|termine|continue|fais[- ]?ça|fais[- ]?ca|fais comme (?:tu|je|j')\S*|comme (?:dit|pr[ée]vu|convenu)|c['']est parti|fonce|tu peux (?:le )?faire|maintenant\b)/i

/**
 * Détecte une demande de SUIVI anaphorique et construit la demande enrichie :
 * la demande courte + le sujet précédent de la conversation. Retourne null si
 * la demande est autosuffisante.
 */
function resolveFollowUp(lastUser: string, history: { role: 'user' | 'assistant'; content: string }[]): string | null {
  const trimmed = lastUser.trim()
  if (trimmed.length > 90) return null
  const isFollowUp =
    FOLLOWUP_PATTERN.test(trimmed) ||
    /^(et\s+(?:pour|avec|si|le|la|les| ensuite)|à partir de (?:ça|ce)|[àa] partir de l[àa])\b/i.test(trimmed)
  if (!isFollowUp) return null

  // Le dernier VRAI sujet de l'utilisateur (substantiel et différent)
  const refUser = [...history]
    .reverse()
    .find((m) => m.role === 'user' && m.content.trim().length >= 30 && m.content.trim() !== trimmed)?.content
  // Le dernier extrait de réponse de l'assistant (ce qui était proposé)
  const refAssistant = [...history]
    .reverse()
    .find((m) => m.role === 'assistant' && m.content.trim().length >= 60)?.content

  if (!refUser && !refAssistant) return null
  const parts = [
    trimmed,
    refUser ? `[Suivi : cette demande fait référence au sujet précédent de la conversation — « ${refUser.trim().slice(0, 400)} »]` : '',
    refAssistant ? `[Ta dernière réponse (extrait) : « ${refAssistant.trim().slice(0, 300)} » — agis dessus si c'est cohérent.]` : '',
  ]
  return parts.filter(Boolean).join('\n\n')
}

// ── Boucle principale ────────────────────────────────────────────────────────

export async function processTurn(input: BrainInput, send: Emit): Promise<void> {
  const history = input.messages.filter((m) => typeof m.content === 'string').slice(-14)
  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
  if (!lastUser.trim()) {
    send({ type: 'error', message: 'Message vide' })
    return
  }

  warmUpClassifier()
  const entities = extractEntities(lastUser)
  const memories = await loadMemories()
  const isFirstExchange = history.filter((m) => m.role === 'user').length <= 1
  const effectiveUser = resolveFollowUp(lastUser, history) ?? lastUser
  const ctx: Ctx = { lastUser, effectiveUser, history, entities, memories, send, isFirstExchange, currentCode: input.currentCode }

  const nameMatch = memories.find((m) => /s'appelle/i.test(m))?.match(/s'appelle\s+([\p{L}-]+)/iu)
  const userName = nameMatch?.[1]

  // ── Discussion ciblée (sélecteur du chat) : agent seul ou table ronde ──────
  // Les missions (« MISSION : … ») restent gérées par NEXUS : c'est son rôle.
  const target = input.target ?? { kind: 'nexus' as const }
  const isMissionMessage = /^mission\s*:/i.test(lastUser.trim())
  if (target.kind !== 'nexus' && !isMissionMessage) {
    try {
      if (target.kind === 'agent') await handleSoloAgentTurn(target.agentId, ctx)
      else await handleEnsembleTurn(target, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      send({ type: 'error', message: `Un imprévu est survenu dans la discussion multi-agents : ${message}. Réessaie — les replis locaux prennent le relais automatiquement.` })
    } finally {
      await finishTurn(ctx, isFirstExchange, send)
    }
    return
  }

  // ── Étape 1 : analyse locale affichée (menu déroulant de réflexion) ───────
  const classification = classify(lastUser)
  const tokens = stems(lastUser)
  send({ type: 'thought', text: `Analyse de ta demande : ${tokens.length} terme(s) significatif(s), intention « ${classification.intent} » (${Math.round(classification.confidence * 100)} %). Je choisis le meilleur moteur pour y répondre.` })

  const analysisStep = makeStep('system', 'Cerveau', 'sélection du moteur de raisonnement')
  send({ type: 'step', ...analysisStep, status: 'running' })

  // ── Étape 2 : chemins déterministes (zéro latence réseau) ─────────────────
  let handled = false
  let finalText = ''

  if (/^mission\s*:/i.test(lastUser.trim())) {
    send({ type: 'step', ...analysisStep, detail: 'mission détectée → exécution autonome', status: 'done' })
    finalText = await handleMissionMessage(lastUser, ctx)
    handled = true
  } else if (entities.url) {
    send({ type: 'step', ...analysisStep, detail: 'URL détectée → lecture directe', status: 'done' })
    finalText = await skillReadPage(entities.url, ctx)
    handled = true
  } else if (classification.intent === 'math') {
    const m = evaluateMath(lastUser)
    if (m) {
      send({ type: 'step', ...analysisStep, detail: 'calcul exact → moteur mathématique local', status: 'done' })
      finalText = m.ok
        ? R.mathAnswer(m.expression, m.result, m.detail)
        : `Hmm, « ${m.expression} » n'est pas un calcul que je peux évaluer : ${m.result}. Écris-le par exemple comme « 12 + 45 », « racine de 144 », « 15% de 240 », « moyenne de 12 15 et 9 »…`
      handled = true
    }
  } else if (classification.intent === 'time') {
    send({ type: 'step', ...analysisStep, detail: 'heure/date → horloge locale', status: 'done' })
    finalText = R.timeAnswer(new Date())
    handled = true
  } else if (isWatchVideoRequest(lastUser)) {
    // « Regarde la dernière vidéo de X » : chemin DÉTERMINISTE (recherche de
    // chaîne + onglet /videos) — jamais dépendant d'une décision LLM.
    // ⚠️ Toutes les demandes d'ACTION réelles (visionnage, comptes connectés)
    // sont testées AVANT la branche « conversation simple » : sinon un routage
    // flou (réel : « regarde mon tiktok » → greeting 47 %) les avalait.
    send({ type: 'step', ...analysisStep, detail: 'demande de visionnage → recherche YouTube réelle', status: 'done' })
    finalText = await skillYouTubeWatch(ctx)
    handled = true
  } else if (isInboxRequest(lastUser)) {
    // « Lis ma boîte mail » : lecture IMAP RÉELLE de la boîte connectée —
    // chemin déterministe, pas de LLM requis.
    send({ type: 'step', ...analysisStep, detail: 'boîte mail connectée → lecture IMAP réelle', status: 'done' })
    finalText = await skillCheckEmail(ctx)
    handled = true
  } else if (isGithubAccountRequest(lastUser)) {
    send({ type: 'step', ...analysisStep, detail: 'compte GitHub connecté → API officielle', status: 'done' })
    finalText = await skillGithubAccount(ctx)
    handled = true
  } else if (isTiktokAccountRequest(lastUser)) {
    send({ type: 'step', ...analysisStep, detail: 'compte TikTok relié → lecture du profil public', status: 'done' })
    finalText = await skillTiktokAccount(ctx)
    handled = true
  } else if (['greeting', 'farewell', 'thanks', 'howareyou', 'identity', 'capabilities'].includes(classification.intent)) {
    send({ type: 'step', ...analysisStep, detail: `conversation simple → réponse immédiate (${classification.intent})`, status: 'done' })
    switch (classification.intent) {
      case 'greeting': finalText = R.greeting(userName); break
      case 'farewell': finalText = R.farewell(); break
      case 'thanks': finalText = R.thanks(); break
      case 'howareyou': finalText = R.howAreYou(); break
      case 'identity': finalText = R.identity(); break
      case 'capabilities': finalText = R.capabilities(); break
    }
    handled = true
  } else if (classification.intent === 'task') {
    send({ type: 'step', ...analysisStep, detail: 'suivi de mission → base de données', status: 'done' })
    finalText = await skillTask(ctx)
    handled = true
  } else if (classification.intent === 'knowledge_save' || classification.intent === 'about_user') {
    send({ type: 'step', ...analysisStep, detail: 'mémorisation → base de connaissances + mémoire', status: 'done' })
    const retention = extractExplicitRetention(lastUser)
    if (retention) await saveMemoryItems([retention])
    const freshItems = extractMemories(lastUser)
    if (freshItems.length > 0) {
      const added = await saveMemoryItems(freshItems)
      if (added > 0) send({ type: 'meta', memoryAdded: added })
    }
    if (classification.intent === 'knowledge_save') {
      finalText = await skillKnowledgeSave(ctx)
    } else {
      const freshMemories = await loadMemories()
      finalText = freshItems.length > 0 ? R.memorySavedIntro(freshMemories, freshItems) : R.aboutUser(memories)
    }
    handled = true
  } else if (classification.intent === 'knowledge_query') {
    send({ type: 'step', ...analysisStep, detail: 'recherche dans tes notes → base de connaissances', status: 'done' })
    finalText = await skillKnowledgeQuery(ctx)
    handled = true
  } else if (classification.intent === 'video' && !isWatchVideoRequest(lastUser)) {
    // « Génère une vidéo de X » : rendu MP4 RÉEL par le moteur procédural local
    // (rendu image par image + ffmpeg) — chemin déterministe, pas de LLM requis.
    send({ type: 'step', ...analysisStep, detail: 'génération de vidéo → moteur procédural local + ffmpeg', status: 'done' })
    finalText = await skillVideo(ctx)
    handled = true
  }

  // ── Étape 3 : moteur LLM (boucle agentique) + repli local ─────────────────
  if (!handled) {
    const system = await buildSystemPrompt()
    await runLlmPipeline(ctx, classification, system, analysisStep)
  } else {
    // Chemin déterministe : streamer la réponse locale
    await streamText(finalText, send)
  }

  // ── Étape 4 : mémoire + titre (arrière-plan local, instantané) ────────────
  await finishTurn(ctx, isFirstExchange, send)
}

/**
 * Pipeline LLM partagé par NEXUS et les agents personnalisés : route ACTION
 * (décision JSON → outils → réponse streamée) puis route CONVERSATION
 * (streaming direct avec garde anti-JSON, y compris quand le LLM écrit un
 * préambule AVANT son JSON), repli local sur indisponibilité.
 */
async function runLlmPipeline(
  ctx: Ctx,
  classification: Classification,
  system: string,
  analysisStep: { id: string; tool: AgentTool; label: string; detail: string } | null
): Promise<void> {
  const historyMsgs: LlmMessage[] = ctx.history.slice(-10).map((m) => ({ role: m.role, content: m.content.slice(0, 2500) }))
  const protocol = toolsProtocol(ctx.allowedTools, ctx.excludeTools)

  const wantsAction = ['search', 'code', 'image', 'scene3d', 'webpage', 'video', 'readpage'].includes(classification.intent)
  if (analysisStep) {
    ctx.send({
      type: 'step',
      ...analysisStep,
      detail: wantsAction ? 'moteur LLM + outils (action détectée)' : 'moteur LLM (conversation)',
      status: 'done',
    })
  }

  let usedLlm = false

  if (wantsAction) {
    // Route ACTION : décision JSON → outils → réponse streamée
    const decision = await llmComplete(
      [
        { role: 'system', content: `${system}\n\n${protocol}\n\nL'utilisateur vient de faire une demande d'ACTION. Réponds UNIQUEMENT avec l'objet JSON de l'outil à utiliser — AUCUN texte avant ou après, aucun préambule, pas de bloc de code markdown.\nMÉMOIRE DE CHAT : les messages précédents sont fournis. Si la demande y fait référence (« fais-le », « réalise-le », « continue »), choisis l'outil qui correspond au SUJET PRÉCÉDENT de la conversation, pas au mot à mot de la demande.` },
        ...historyMsgs,
      ],
      { temperature: 0.2, maxTokens: 200, timeoutMs: 18_000, thinking: false }
    )
    const call = decision ? extractJson<ToolCall>(decision) : null
    if (call && call.tool && call.tool !== 'none') {
      usedLlm = true
      ctx.send({ type: 'thought', text: `Décision : j'utilise l'outil « ${call.tool} » pour cette demande.` })
      const exec = await executeTool(call, ctx)
      const finalMsgs: LlmMessage[] = [
        { role: 'system', content: `${system}\n\n${protocol}\n\nRÉSULTAT D'OUTIL :\n${exec.result.slice(0, 9000)}\n\nRédige MAINTENANT ta réponse finale pour l'utilisateur, en markdown, sans JSON${exec.artifact ? ' — inclus le code demandé dans des blocs markdown comme indiqué' : ''}. Reste concis (5-12 lignes utiles) et TERMINE toujours tes phrases.` },
        { role: 'user', content: ctx.effectiveUser.slice(0, 2400) },
      ]
      // Garde anti-JSON sur la réponse finale : le LLM ré-émet parfois son
      // propre JSON d'action au lieu de rédiger (cas réel : image générée puis
      // {"tool":"generate_image",...} affiché tel quel). Détection en tête de
      // flux ; si c'est le MÊME outil, on ne ré-exécute pas (pas d'image
      // double), on repart sur une rédaction ; si c'est un autre outil, on
      // l'exécute puis on fait rédiger.
      let action2: ToolCall | null = null
      let buf2 = ''
      let mode2: 'detect' | 'stream' | 'tool' = 'detect'
      let emitted2 = 0
      const streamed = await llmStream(finalMsgs, (chunk) => {
        if (mode2 === 'stream') {
          ctx.send({ type: 'token', content: chunk })
          emitted2 += chunk.length
          return
        }
        if (mode2 === 'tool') return
        buf2 += chunk
        const trimmed = buf2.trimStart()
        if (!trimmed) return
        if (trimmed.startsWith('{')) {
          const parsed = extractJson<ToolCall>(trimmed)
          if (parsed && parsed.tool) {
            action2 = parsed
            mode2 = 'tool'
            return
          }
          if (trimmed.length > 1400) {
            mode2 = 'stream'
            ctx.send({ type: 'token', content: buf2 })
            emitted2 += buf2.length
            buf2 = ''
          }
          return
        }
        mode2 = 'stream'
        ctx.send({ type: 'token', content: buf2 })
        emitted2 += buf2.length
        buf2 = ''
      }, { timeoutMs: 60_000 })
      const reAction = action2 as ToolCall | null
      if (reAction && reAction.tool) {
        const sameTool = reAction.tool === call.tool
        const exec2 = sameTool ? exec : await executeTool(reAction, ctx)
        ctx.send({ type: 'thought', text: sameTool ? 'Le moteur a renvoyé sa décision au lieu de rédiger — je fais la rédaction moi-même.' : `Décision en vol : outil « ${reAction.tool} ».` })
        const msgs2: LlmMessage[] = [
          { role: 'system', content: `${system}\n\nRÉSULTAT D'OUTIL :\n${exec2.result.slice(0, 9000)}\n\nRédige ta réponse finale en markdown pour l'utilisateur — INTERDIT d'écrire un objet JSON (aucun {...}), INTERDIT de répéter la décision d'outil. Reste concis et termine tes phrases.` },
          { role: 'user', content: ctx.effectiveUser.slice(0, 2400) },
        ]
        const second = await llmStream(msgs2, (chunk) => ctx.send({ type: 'token', content: chunk }), { timeoutMs: 60_000 })
        if (!second || !second.trim()) await localFallback(ctx, classification, true)
        else if (!sameTool && (exec2.artifact === 'code' || exec2.artifact === 'webpage')) {
          const artifact = extractCodeArtifact(second, exec2.artifact === 'webpage')
          if (artifact) emitCodeArtifact(ctx, artifact, second.slice(0, 500))
        }
      } else if (streamed && emitted2 === 0) {
        // Rien affiché et pas de JSON : réponse vide → repli local
        await localFallback(ctx, classification, true)
      } else if (streamed && (exec.artifact === 'code' || exec.artifact === 'webpage')) {
        // Artefact code/page web extrait des blocs markdown
        const artifact = extractCodeArtifact(streamed, exec.artifact === 'webpage')
        if (artifact) {
          emitCodeArtifact(ctx, artifact, streamed.slice(0, 500))
          ctx.send({ type: 'step', id: 'step-artifact', tool: exec.artifact === 'webpage' ? 'generate_webpage' : 'generate_code', label: exec.artifact === 'webpage' ? 'Page web' : 'Script', detail: ctx.proposalMode ? `${artifact.name} — proposition à valider dans le Studio Code` : `${artifact.name} prêt dans le Studio Code`, status: 'done' })
        } else if (exec.artifact === 'code') {
          // Le LLM n'a pas produit de bloc exploitable → gabarit local
          const fallback = await skillCode(ctx)
          ctx.send({ type: 'token', content: `\n\n${fallback}` })
        } else {
          const fallback = await skillWebpage(ctx)
          ctx.send({ type: 'token', content: `\n\n${fallback}` })
        }
      }
    }
  }

  if (!usedLlm) {
    // Route CONVERSATION : streaming direct avec double garde anti-JSON :
    // (a) réponse commençant par un JSON d'action, (b) JSON d'action qui
    // apparaît APRÈS un préambule de texte (cas réel observé : le LLM annonce
    // puis écrit {"tool":...} — le JSON ne doit JAMAIS s'afficher tel quel).
    let buffer = ''
    let mode: 'detect' | 'stream' | 'tool' = 'detect'
    let emitted = 0
    let actionJson: ToolCall | null = null
    let holdBack = '' // texte retenu après un '{' suspect en plein flux
    const flushHold = () => {
      if (!holdBack) return
      ctx.send({ type: 'token', content: holdBack })
      emitted += holdBack.length
      holdBack = ''
    }
    const streamed = await llmStream(
      [
        { role: 'system', content: `${system}\n\n${protocol}\n\nMÉMOIRE DE CHAT : les messages précédents de la conversation sont fournis — appuie-toi dessus (si l'utilisateur dit « fais-le », « réalise-le », « continue », c'est le sujet précédent qu'il vise).\nSi la demande nécessite clairement un OUTIL, réponds UNIQUEMENT avec l'objet JSON d'action, SANS aucun texte autour. Sinon, réponds directement et naturellement en markdown (concis, structuré, en français).` },
        ...historyMsgs,
      ],
      (chunk) => {
        if (mode === 'tool') return // JSON déjà capturé : on ignore la suite
        if (mode === 'stream') {
          if (holdBack) {
            // On retient déjà un candidat JSON : accumuler et tester
            holdBack += chunk
            const parsed = extractJson<ToolCall>(holdBack)
            if (parsed && parsed.tool) {
              actionJson = parsed
              mode = 'tool'
              return
            }
            if (holdBack.length > 1600) {
              // Faux positif (accolade de markdown…) → relâcher tel quel
              flushHold()
            }
            return
          }
          // Un '{' surgit après du texte déjà affiché → candidat JSON potentiel
          const brace = chunk.indexOf('{')
          if (brace >= 0 && emitted > 0) {
            const before = chunk.slice(0, brace)
            if (before) {
              ctx.send({ type: 'token', content: before })
              emitted += before.length
            }
            holdBack = chunk.slice(brace)
            const parsed = extractJson<ToolCall>(holdBack)
            if (parsed && parsed.tool) {
              actionJson = parsed
              mode = 'tool'
            }
            return
          }
          ctx.send({ type: 'token', content: chunk })
          emitted += chunk.length
          return
        }
        buffer += chunk
        const trimmed = buffer.trimStart()
        if (trimmed.length === 0) return
        if (mode === 'detect') {
          if (trimmed.startsWith('{')) {
            mode = 'tool'
          } else {
            mode = 'stream'
            ctx.send({ type: 'token', content: buffer })
            emitted += buffer.length
            buffer = ''
          }
          return
        }
        // mode 'tool' : on accumule jusqu'à pouvoir parser l'action
        const parsed = extractJson<ToolCall>(trimmed)
        if (parsed && parsed.tool) {
          actionJson = parsed
          mode = 'tool'
          return
        }
        if (trimmed.length > 1200) {
          // Faux positif (texte commençant par {) → on le stream tel quel
          mode = 'stream'
          ctx.send({ type: 'token', content: buffer })
          emitted += buffer.length
          buffer = ''
        }
      },
      { timeoutMs: 45_000 }
    )

    // État final du détecteur (rempli par le callback ci-dessus) — l'annotation
    // élargie évite le narrowing TS incorrect sur les variables de closure.
    const finalMode = mode as 'detect' | 'stream' | 'tool'
    const finalAction = actionJson as ToolCall | null

    // Tampons non résolus (JSON malformé / faux positif) → on ne perd rien
    if (finalMode !== 'tool' && holdBack.trim().length > 0) {
      flushHold()
    }
    if (finalMode === 'tool' && !finalAction && buffer.trim().length > 0) {
      ctx.send({ type: 'token', content: buffer })
      emitted += buffer.length
      buffer = ''
    }

    if (streamed && (emitted > 0 || streamed.trim())) {
      if (finalAction && finalAction.tool && finalAction.tool !== 'none') {
        // Le LLM a répondu par une action malgré la route directe → on l'exécute
        ctx.send({ type: 'thought', text: `Décision en vol : outil « ${finalAction.tool} ».` })
        const exec = await executeTool(finalAction, ctx)
        const finalMsgs: LlmMessage[] = [
          { role: 'system', content: `${system}\n\nRÉSULTAT D'OUTIL :\n${exec.result.slice(0, 9000)}\n\nRédige ta réponse finale en markdown, sans JSON, et termine tes phrases.` },
          { role: 'user', content: ctx.effectiveUser.slice(0, 2400) },
        ]
        const second = await llmStream(finalMsgs, (chunk) => ctx.send({ type: 'token', content: chunk }), { timeoutMs: 60_000 })
        if (!second || !second.trim()) await localFallback(ctx, classification, true)
        else if (exec.artifact === 'code' || exec.artifact === 'webpage') {
          const artifact = extractCodeArtifact(second, exec.artifact === 'webpage')
          if (artifact) emitCodeArtifact(ctx, artifact, second.slice(0, 500))
        }
      } else if (ctx.proposalMode && ctx.currentCode && /\`\`\`/.test(streamed)) {
        // Mode PROPOSITION, route conversationnelle : l'agent a répondu avec des
        // blocs de code (demande d'amélioration) → on les transforme en
        // PROPOSITION validable au lieu d'un artefact écrit directement.
        const looksLikeEdit = /am[ée]liore|modifie|change|corrige|refactor|optimise|ajoute|rajoute|retravaille|remplace|met[s]? [àa] jour|update/i.test(ctx.lastUser)
        if (looksLikeEdit) {
          // Des blocs html/css → page web complète ; sinon le premier bloc (script)
          const preferWeb = /```(?:html|css)/i.test(streamed) || /<|html/i.test(ctx.lastUser)
          const artifact = extractCodeArtifact(streamed, preferWeb)
          if (artifact && (artifact.files.html.length + artifact.files.css.length + artifact.files.js.length) > 120) {
            emitCodeArtifact(ctx, artifact, streamed.replace(/```[\s\S]*?```/g, '').trim().slice(0, 500) || 'Version améliorée de ton code actuel.')
          }
        }
      }
      // Sinon la réponse a déjà été streamée au fil de l'eau
    } else {
      // LLM indisponible → cerveau local instantané
      await localFallback(ctx, classification, false)
    }
  }
}

/** Fin de tour commune : extraction mémoire + titre de conversation + done. */
async function finishTurn(ctx: Ctx, isFirstExchange: boolean, send: Emit): Promise<void> {
  let memoryAdded = 0
  if (ctx.lastUser.length >= 15) {
    const retention = extractExplicitRetention(ctx.lastUser)
    const extracted = [...extractMemories(ctx.lastUser), ...(retention ? [retention] : [])]
    if (extracted.length > 0) {
      memoryAdded = await saveMemoryItems(extracted)
    }
  }
  const meta: { type: 'meta'; title?: string; memoryAdded?: number } = { type: 'meta' }
  if (isFirstExchange) {
    const title = autoTitle(ctx.lastUser)
    if (title.length >= 4) meta.title = title
  }
  if (memoryAdded > 0) meta.memoryAdded = memoryAdded
  if (meta.title || meta.memoryAdded) send(meta)

  send({ type: 'done' })
}

// ── Discussion avec UN agent personnalisé (cible « agent ») ───────────────────

/** Présentation de soi pour un agent personnalisé (fiche + prompt du créateur). */
function personaIdentity(agent: NexusAgent): string {
  const role = ROLE_LABELS[agent.role] ?? 'Spécialiste'
  const specs = agent.specialties.length > 0 ? `\n\n**Spécialités :** ${agent.specialties.join(', ')}` : ''
  return `Je suis **${agent.emoji} ${agent.name}**, un agent de ton équipe NEXUS — rôle : **${role}**.${agent.description ? ` ${agent.description}` : ''}${specs}${agent.prompt ? `\n\n*Ma personnalité, écrite par mon créateur :*\n> ${agent.prompt.slice(0, 400)}` : ''}\n\nJe discute avec mon propre prompt, je participe aux missions avec le reste de l'équipe, et tu peux me choisir en discussion privée dans le sélecteur au-dessus de la saisie. 🤝`
}

/** Tour de discussion avec un agent seul : SA personnalité (prompt) pilote tout. */
async function handleSoloAgentTurn(agentId: string, ctx: Ctx): Promise<void> {
  const row = await db.agentProfile.findUnique({ where: { id: agentId } })
  if (!row) {
    ctx.send({ type: 'token', content: '⚠️ Cet agent n\'existe plus (il a peut-être été supprimé). Choisis une autre cible dans le sélecteur au-dessus de la saisie.' })
    return
  }
  const me = parseAgentRow(row)
  ctx.send({ type: 'speaker', id: me.id, name: me.name, emoji: me.emoji, color: me.color })
  ctx.send({ type: 'thought', text: `Discussion privée avec ${me.emoji} ${me.name} — son prompt personnel pilote cette réponse.` })
  ctx.agentName = me.name
  ctx.agentEmoji = me.emoji

  // Le code actuel du Studio Code est fourni → mode PROPOSITION : l'agent peut
  // lire le code de l'utilisateur et le retoucher, mais toute modification passe
  // par une proposition validable (diff) — JAMAIS d'écriture directe.
  const code = ctx.currentCode
  const hasCode = Boolean(code && (code.html.trim() || code.css.trim() || code.js.trim()))
  if (hasCode) ctx.proposalMode = true

  const classification = classify(ctx.lastUser)

  // Identité : l'agent se décrit avec SA fiche et SON prompt personnel
  if (classification.intent === 'identity') {
    await streamText(personaIdentity(me), ctx.send)
    return
  }

  // Spécialisation CODEUR : accès limité au studio 3D, à l'éditeur de code
  // et au navigateur — pas d'images, pas de missions, pas de mémoire.
  if (me.role === 'codeur') {
    ctx.allowedTools = new Set<string>(CODER_TOOLS)
  }

  const now = new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
  const toolLine =
    me.role === 'codeur'
      ? `Tu es dans l'application NEXUS avec une spécialisation CODEUR : tes SEULS outils sont l'éditeur de code (generate_code, generate_webpage), le studio 3D (create_3d_scene) et le navigateur (web_search pour trouver, read_webpage pour lire). Tu ne génères PAS d'images, tu ne gères NI les missions NI la base de connaissances.`
      : `Tu es dans l'application NEXUS : tu peux utiliser ses outils comme lui (recherche web, lecture de page, code, image, VIDÉO MP4, scène 3D, connaissances, suivi de mission).`

  // « Regarde la dernière vidéo de X » : la recherche part AVANT le LLM —
  // elle est déterministe (chaîne + onglet /videos), ses résultats sont
  // injectés dans le prompt : l'agent répond avec les VRAIES données même si
  // le moteur distant décroche ensuite. Et NEXUS ajoute ensuite son rappel.
  let ytData: Awaited<ReturnType<typeof prepareYouTubeWatch>> = null
  if (isWatchVideoRequest(ctx.lastUser)) {
    const subject = extractVideoSubject(ctx.lastUser)
    const s = makeStep('web_search', 'Recherche YouTube', subject ? `dernière vidéo de « ${subject} »` : ctx.lastUser.slice(0, 50))
    ctx.send({ type: 'step', ...s, status: 'running' })
    ytData = await prepareYouTubeWatch(subject || ctx.lastUser.slice(0, 60))
    if (ytData) {
      ctx.send({
        type: 'sources',
        sources: [
          { title: ytData.video.title, url: ytData.video.url, domain: 'youtube.com', snippet: `${ytData.video.channel}${ytData.video.duration ? ` · ${ytData.video.duration}` : ''}` },
          ...ytData.alternatives.slice(1, 3).map((h) => ({ title: h.title, url: h.url, domain: 'youtube.com', snippet: h.channel })),
        ],
      })
      ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche YouTube', detail: `« ${ytData.video.title.slice(0, 50)} » — ${ytData.video.channel}`, status: 'done' })
    } else {
      ctx.send({ type: 'step', ...s, tool: 'web_search', label: 'Recherche YouTube', detail: 'aucune chaîne/vidéo trouvée', status: 'error' })
    }
  }

  const ytLine = ytData ? `\n\nRÉSULTATS DE TA RECHERCHE YOUTUBE (déjà effectuée en direct — APPUIE-TOI DESSUS, n'invente rien) :\n${youtubeFactsBlock(ytData)}\nUtilise CES données réelles : cite le titre exact, la chaîne, la durée, dis ce que la vidéo contient (titre/description) et donne le lien.` : ''

  // Comptes connectés (mail / GitHub / TikTok) : la lecture part AVANT le LLM
  // (déterministe) et ses RÉSULTATS RÉELS sont injectés dans le prompt —
  // l'agent « a accès à la boîte mail » exactement comme NEXUS.
  let connFacts = ''
  let connKind: 'email' | 'github' | 'tiktok' | null = null
  if (isInboxRequest(ctx.lastUser)) connKind = 'email'
  else if (isGithubAccountRequest(ctx.lastUser)) connKind = 'github'
  else if (isTiktokAccountRequest(ctx.lastUser)) connKind = 'tiktok'
  if (connKind === 'email') {
    const s = makeStep('check_email', 'Boîte mail', 'lecture IMAP de la boîte connectée')
    ctx.send({ type: 'step', ...s, status: 'running' })
    const mails = await fetchRecentEmails(6)
    if (mails.ok) {
      ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: `${mails.emails.length} mail(s) lus en direct`, status: 'done' })
      ctx.excludeTools = new Set(['check_email']) // déjà exécuté : ne pas ré-exécuter (double latence)
      connFacts = `\n\nRÉSULTATS DE TA LECTURE MAIL (déjà effectuée en IMAP — APPUIE-TOI DESSUS, n'invente rien) :\n${emailFactsBlock(mails)}\nRésume ces mails réels : expéditeur, sujet, ce qui attend une réponse.`
    } else {
      ctx.send({ type: 'step', ...s, tool: 'check_email', label: 'Boîte mail', detail: mails.note ?? 'boîte inaccessible', status: 'error' })
      connFacts = `\n\nTENTATIVE DE LECTURE MAIL ÉCHOUÉE : ${mails.note ?? 'cause inconnue'} — informe honnêtement et oriente vers le panneau Connexions.`
    }
  } else if (connKind === 'github') {
    const s = makeStep('github_activity', 'GitHub', 'repos + notifications du compte connecté')
    ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: 'appel de l\'API officielle…', status: 'running' })
    const gh = await fetchGithubActivity()
    if (gh.ok) {
      ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: `${gh.repos.length} repos · ${gh.notifications.length} notifications`, status: 'done' })
      ctx.excludeTools = new Set(['github_activity']) // déjà exécuté
      connFacts = `\n\nDONNÉES GITHUB RÉELLES (déjà lues via l'API — APPUIE-TOI DESSUS) :\n${githubFactsBlock(gh)}`
    } else {
      ctx.send({ type: 'step', ...s, tool: 'github_activity', label: 'GitHub', detail: gh.note ?? 'compte inaccessible', status: 'error' })
      connFacts = `\n\nTENTATIVE DE LECTURE GITHUB ÉCHOUÉE : ${gh.note ?? 'cause inconnue'} — informe honnêtement et oriente vers le panneau Connexions.`
    }
  } else if (connKind === 'tiktok') {
    const s = makeStep('tiktok_activity', 'TikTok', 'profil connecté + dernières vidéos')
    ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: 'lecture du profil public…', status: 'running' })
    const tt = await fetchTikTokProfile()
    if (tt.ok) {
      ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: `@${tt.handle} · ${tt.videos.length} vidéos récentes`, status: 'done' })
      ctx.excludeTools = new Set(['tiktok_activity']) // déjà exécuté
      connFacts = `\n\nDONNÉES TIKTOK RÉELLES (déjà lues — APPUIE-TOI DESSUS) :\n${tiktokFactsBlock(tt)}`
    } else {
      ctx.send({ type: 'step', ...s, tool: 'tiktok_activity', label: 'TikTok', detail: tt.note ?? 'profil inaccessible', status: 'error' })
      connFacts = `\n\nTENTATIVE DE LECTURE TIKTOK ÉCHOUÉE : ${tt.note ?? 'cause inconnue'} — informe honnêtement et oriente vers le panneau Connexions.`
    }
  }

  const codeLine = hasCode && code
    ? `\n\nCODE ACTUEL du Studio Code de l'utilisateur (fichiers : ${[
        code.html.trim() ? 'HTML' : '',
        code.css.trim() ? 'CSS' : '',
        code.js.trim() ? (code.language && code.language !== 'web' ? code.language.toUpperCase() : 'JS') : '',
      ]
        .filter(Boolean)
        .join(', ') || 'vides'})${code.filename ? ` — fichier « ${code.filename} »` : ''} : tu peux le LIRE librement. Si l'utilisateur te demande de l'améliorer, le modifier ou le corriger : écris la version COMPLÈTE modifiée dans des blocs markdown (tout le fichier, pas juste un extrait) — elle lui sera présentée comme une PROPOSITION à valider (tu ne modifies jamais son code directement, il revoit et valide). Si c'est une question ou une analyse, réponds simplement.\n\n=== CODE ACTUEL ===\n${code.language && !['web', 'html'].includes(code.language) ? `\n\`\`\`${code.language}\n${code.js.slice(0, 6000)}\n\`\`\`` : `${code.html.trim() ? `\n\`\`\`html\n${code.html.slice(0, 4000)}\n\`\`\`` : ''}${code.css.trim() ? `\n\`\`\`css\n${code.css.slice(0, 3000)}\n\`\`\`` : ''}${code.js.trim() ? `\n\`\`\`javascript\n${code.js.slice(0, 4000)}\n\`\`\`` : ''}`}\n=== FIN DU CODE ===`
    : ''
  const system = `${personaSystemPrompt(me, ctx.memories)}\n\nDate et heure actuelles : ${now}.\n${toolLine}${ytLine}${connFacts}${codeLine} Ce n'est PAS une table ronde : tu es seul avec l'utilisateur, tu peux développer davantage (6 à 12 lignes utiles) et tu TERMINES toujours tes phrases.`
  await runLlmPipeline(ctx, classification, system, null)

  // Rappel NEXUS : quelle que soit la réponse de l'agent, l'utilisateur reçoit
  // la réponse factuelle de NEXUS dans une bulle séparée (recherche directe).
  if (ytData) {
    ctx.send({ type: 'speaker', ...NEXUS_SPEAKER })
    ctx.send({ type: 'thought', text: 'Vérification directe de NEXUS : les données vidéo ont été extraites en direct de YouTube pendant la réponse de l\'agent.' })
    await streamText(youtubeWatchAnswer(ytData), ctx.send)
  }
}

// ── Discussion collective (cible « all », « group » ou « bureau ») ────────────

async function handleEnsembleTurn(target: ChatTarget, ctx: Ctx): Promise<void> {
  const mode: 'table' | 'bureau' = target.kind === 'bureau' ? 'bureau' : 'table'
  let participants: NexusAgent[] = []
  let label = "toute l'équipe"

  const groupId = target.kind === 'group' || (target.kind === 'bureau' && target.groupId) ? (target as { groupId?: string }).groupId : undefined
  if (groupId) {
    const groupRow = await db.agentGroup.findUnique({ where: { id: groupId } })
    if (!groupRow) {
      ctx.send({ type: 'token', content: '⚠️ Ce groupe n\'existe plus — recrée-le dans le panneau **Équipe → Groupes**, puis redemande.' })
      return
    }
    const group = parseAgentGroupRow(groupRow)
    label = `le groupe ${group.emoji} ${group.name}`
    const rows = await db.agentProfile.findMany()
    participants = rows.map(parseAgentRow).filter((a) => group.members.includes(a.id) && a.enabled)
  } else {
    const rows = await db.agentProfile.findMany({ where: { enabled: true } })
    participants = rows.map(parseAgentRow)
  }

  if (participants.length === 0) {
    ctx.send({ type: 'token', content: `Aucun agent actif dans ${label}. Recrute des agents dans le panneau **Équipe**, puis redemande — ou repasse en discussion « NEXUS » dans le sélecteur.` })
    return
  }

  if (mode === 'bureau') {
    ctx.send({ type: 'thought', text: `Bureau convoqué (${label}) : ${participants.length} agent${participants.length > 1 ? 's' : ''} vont délibérer ensemble en coulisses — tu recevras UNE seule réponse consolidée.` })
  } else {
    ctx.send({ type: 'thought', text: `Table ronde lancée avec ${participants.length} agent${participants.length > 1 ? 's' : ''} (${label}) — chacun répond avec sa personnalité, puis je rédige la synthèse.` })
  }

  // Demande de visionnage : NEXUS prépare la recherche et l'injecte dans la
  // délibération — les agents délibèrent sur des DONNÉES RÉELLES.
  let contextHint = ctx.effectiveUser !== ctx.lastUser ? ctx.effectiveUser : undefined
  if (isWatchVideoRequest(ctx.lastUser)) {
    const subject = extractVideoSubject(ctx.lastUser)
    const data = await prepareYouTubeWatch(subject || ctx.lastUser.slice(0, 60))
    if (data) {
      ctx.send({ type: 'sources', sources: [{ title: data.video.title, url: data.video.url, domain: 'youtube.com', snippet: `${data.video.channel}${data.video.duration ? ` · ${data.video.duration}` : ''}` }] })
      contextHint = `[Résultats de la recherche YouTube déjà effectuée par NEXUS — utilise ces données réelles :\n${youtubeFactsBlock(data)}]\n\n${contextHint ?? ctx.lastUser}`
    }
  }

  await runEnsemble(
    { messages: ctx.history, lastUser: ctx.lastUser, contextHint, agents: participants, send: ctx.send },
    mode
  )
}

/** Repli local : exécute la compétence locale correspondant à l'intention. */
async function localFallback(ctx: Ctx, classification: Classification, midStream: boolean): Promise<void> {
  ctx.send({ type: 'thought', text: midStream ? 'Le moteur distant a décroché en cours de route — je termine avec mes compétences locales, sans te faire attendre.' : 'Moteur distant indisponible — je réponds immédiatement avec mes compétences locales.' })
  if (midStream) {
    // On enchaîne proprement après un flux partiel
    ctx.send({ type: 'token', content: '\n\n' })
  }
  let text: string
  switch (classification.intent) {
    case 'search': {
      const query = buildSearchQuery(extractTopic(ctx.lastUser)) || ctx.lastUser.slice(0, 80)
      text = await skillSearch(query, ctx)
      break
    }
    case 'code':
      text = await skillCode(ctx)
      break
    case 'image': {
      const size = ctx.entities.size ?? '1024x1024'
      text = await skillImage(ctx.lastUser, size, ctx)
      break
    }
    case 'scene3d':
      text = await skillScene(ctx)
      break
    case 'webpage':
      text = await skillWebpage(ctx)
      break
    case 'video':
      // Une demande de visionnage part sur la vraie recherche YouTube ; une
      // demande de GÉNÉRATION part sur le moteur vidéo local (MP4 réel).
      text = isWatchVideoRequest(ctx.lastUser)
        ? await skillYouTubeWatch(ctx)
        : await skillVideo(ctx)
      break
    case 'readpage':
      text = `Pour lire une page, donne-moi l'adresse complète (https://…). Exemple : *« lis https://create.roblox.com/docs »* — je la lirai, la capturerai et te la résumerai.`
      break
    default:
      text = await handleGeneral(ctx, classification)
  }
  await streamText(text, ctx.send)
}
