// ─── NEXUS — Moteur d'exécution des BLUEPRINTS ───────────────────────────────
// Un blueprint est un schéma dessiné par l'utilisateur : il décrit exactement
// comment son agent doit traiter un message (règles, conditions, cerveau local,
// connaissances, outils, réponse finale).
//
// Tout est exécuté ici, en local, de façon déterministe :
//   - les nœuds « Règle » appliquent le moteur src/lib/rules.ts
//   - les nœuds « Cerveau » appellent le cerveau local src/lib/brain (jamais un
//     service externe) — import dynamique pour éviter le cycle blueprint ↔ brain
//   - les nœuds « Outil » réutilisent les moteurs locaux (recherche, maths, IMAP…)
// Gardes-fous : nombre de nœuds plafonné, visites par nœud limitées (anti-boucle),
// et délai global pour qu'une clé API ne puisse jamais rester bloquée.

import { db } from '@/lib/db'
import { ownerFilter } from '@/lib/auth'
import { findMatchingRule, type ReplyRule } from '@/lib/rules'
import type { BlueprintEdge, BlueprintGraph, BlueprintNode, BlueprintNodeType } from '@/lib/nexus-types'
import { webSearch, readWebpage } from '@/lib/brain/search'
import { evaluateMath } from '@/lib/brain/math-engine'
import { fetchGithubActivity, fetchRecentEmails } from '@/lib/connections-tools'
import { createHash } from 'crypto'
import { sendPlainMail } from '@/lib/mailer'
import { validateSafeExternalUrl } from '@/lib/security'

export interface BlueprintStep {
  nodeId: string
  type: BlueprintNodeType
  label: string
  detail: string
  status: 'running' | 'done' | 'error'
}

export interface RunOptions {
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  /** Propriétaire du compte : cloisonne connaissances/mémoire/connexions. */
  userId?: string | null
  /** Réponse utilisée si le schéma se termine sans texte. */
  fallback?: string
  /** Délai global d'exécution (ms). */
  timeoutMs?: number
  /** Suivi en direct (étapes affichées dans le chat). */
  onStep?: (step: BlueprintStep) => void
  /** Blueprint exécuté (sert à mémoriser l'état des surveillances de sites). */
  blueprintId?: string
}

export interface RunResult {
  reply: string
  steps: BlueprintStep[]
  vars: Record<string, string>
  /** Déclencheur de la règle qui a répondu (diagnostic). */
  matchedRule?: string
  finished: boolean
  error?: string
}

const MAX_STEPS = 80
const MAX_VISITS_PER_NODE = 4
const DEFAULT_TIMEOUT = 45_000

/** Remplace les {{variables}} par leur valeur (inconnue → chaîne vide). */
export function subst(text: string, vars: Record<string, string>): string {
  return String(text ?? '').replace(/\{\{\s*([\p{L}\p{N}_.-]+)\s*\}\}/giu, (_all, name: string) => {
    const key = Object.keys(vars).find((k) => k.toLowerCase() === name.toLowerCase())
    return key ? (vars[key] ?? '') : ''
  })
}

function cfgStr(node: BlueprintNode, key: string, fallback = ''): string {
  const v = node.config?.[key]
  return v === undefined || v === null ? fallback : String(v)
}

function cfgNum(node: BlueprintNode, key: string, fallback: number): number {
  const n = Number(node.config?.[key])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function cfgBool(node: BlueprintNode, key: string, fallback = false): boolean {
  const v = node.config?.[key]
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') return v.toLowerCase() === 'true'
  return fallback
}

function nextEdge(edges: BlueprintEdge[], nodeId: string, port: string): BlueprintEdge | undefined {
  return (
    edges.find((e) => e.from === nodeId && e.fromPort === port) ??
    edges.find((e) => e.from === nodeId && e.fromPort === 'out')
  )
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      const t = setTimeout(() => resolve(fallback), Math.max(500, ms))
      // Évite de retenir le process ouvert si la promesse principale gagne
      promise.finally(() => clearTimeout(t)).catch(() => {})
    }),
  ])
}

/** Recherche locale dans la base de connaissances du compte. */
async function searchKnowledge(userId: string | null | undefined, query: string, max: number): Promise<string> {
  try {
    const rows = await db.knowledge.findMany({
      where: ownerFilter(userId),
      orderBy: { updatedAt: 'desc' },
      take: 300,
    })
    if (!rows || rows.length === 0) return ''
    const q = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)
    const scored = rows
      .map((r) => {
        const title = String(r.title ?? '')
        const content = String(r.content ?? '')
        const hay = `${title} ${content}`.toLowerCase()
        let score = 0
        for (const w of q) if (hay.includes(w)) score++
        return { title, content, score }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
    if (scored.length === 0) return ''
    return scored.map((r) => `• ${r.title} : ${r.content.slice(0, 1200)}`).join('\n\n')
  } catch {
    return ''
  }
}

/** Mémoire longue terme du compte. */
async function loadMemory(userId: string | null | undefined, max = 12): Promise<string> {
  try {
    const rows = await db.memory.findMany({ where: ownerFilter(userId), orderBy: { createdAt: 'desc' }, take: max })
    return (rows ?? []).map((r) => String(r.content ?? '')).filter(Boolean).join('\n')
  } catch {
    return ''
  }
}

/**
 * Nœud « Cerveau » : fait réfléchir le cerveau LOCAL de NEXUS.
 * Import dynamique : brain.ts importe ce module (branche blueprint des agents),
 * on casse ainsi le cycle d'imports.
 */
async function runBrainNode(
  instruction: string,
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  useHistory: boolean,
  ms: number
): Promise<string> {
  try {
    const { processTurn } = await import('@/lib/brain/brain')
    let text = ''
    const messages = [...(useHistory ? history.slice(-10) : []), { role: 'user' as const, content: message }]
    await withTimeout(
      processTurn(
        {
          messages,
          target: { kind: 'nexus' },
          noBlueprint: true,
          // La consigne part en prompt SYSTÈME : le message du visiteur reste
          // intact (sinon il fausse l'analyse du sujet et les réponses locales).
          systemPrompt: instruction.trim() || undefined,
        },
        (event) => {
          if (event.type === 'token') text += event.content
        }
      ),
      ms,
      undefined
    )
    return text.trim()
  } catch (err) {
    return `(_Le cerveau local n'a pas pu répondre : ${err instanceof Error ? err.message : 'erreur'}_)`
  }
}

/** Exécution d'un nœud « Outil » avec les moteurs 100 % locaux de NEXUS. */
async function runToolNode(tool: string, argument: string, message: string, ms: number, userId?: string | null): Promise<string> {
  const arg = (argument || '').trim() || message
  try {
    if (tool === 'web_search') {
      const results = await withTimeout(webSearch(arg.slice(0, 160), 5), ms, null)
      if (!results || results.length === 0) return 'Aucun résultat trouvé.'
      return results
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${String(r.snippet ?? '').slice(0, 400)}`)
        .join('\n\n')
    }
    if (tool === 'read_webpage') {
      const url = arg.match(/https?:\/\/[^\s]+/)?.[0]
      if (!url) return "Aucune URL valide dans le message (ex. https://…)."
      const page = await withTimeout(readWebpage(url, 4000), ms, null)
      if (!page) return 'Page illisible.'
      return `${page.title ?? ''}\n${String(page.text ?? '').slice(0, 2000)}`
    }
    if (tool === 'math') {
      const r = evaluateMath(arg)
      return r ? `${r.expression} = ${r.result}${r.detail ? ` (${r.detail})` : ''}` : "Je n'ai pas reconnu de calcul dans le message."
    }
    if (tool === 'check_email') {
      const r = await withTimeout(fetchRecentEmails(5, undefined, userId), ms, { ok: false, emails: [], note: 'délai dépassé' })
      if (!r.ok) return r.note ?? 'Boîte mail indisponible.'
      if (!r.emails?.length) return 'Boîte de réception vide.'
      return r.emails.map((e) => `• ${e.subject} — de ${e.from} (${e.date})${e.snippet ? `\n${e.snippet}` : ''}`).join('\n')
    }
    if (tool === 'github_activity') {
      const r = await withTimeout(fetchGithubActivity(userId), ms, null)
      if (!r || !r.ok) return r?.note ?? 'Compte GitHub non connecté.'
      return [
        `Compte GitHub : ${r.login}`,
        ...(r.repos ?? []).slice(0, 5).map((repo) => `• ${repo.name} — ${repo.description ?? ''}`),
      ].join('\n')
    }
    if (tool === 'datetime') {
      return new Date().toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' })
    }
    return `Outil « ${tool} » inconnu.`
  } catch (err) {
    return `Outil « ${tool} » en échec : ${err instanceof Error ? err.message : 'erreur'}`
  }
}

/** Surveillance d'un site : compare la page à la dernière visite (empreinte SHA-256). */
async function runWatchNode(
  node: BlueprintNode,
  vars: Record<string, string>,
  ms: number,
  blueprintId: string
): Promise<{ ok: boolean; text: string; changed: 'initial' | 'oui' | 'non'; found: boolean; title: string; excerpt: string }> {
  const fail = (text: string) => ({ ok: false, text, changed: 'non' as const, found: false, title: '', excerpt: '' })
  const rawUrl = subst(cfgStr(node, 'url'), vars).trim()
  const safe = await validateSafeExternalUrl(rawUrl)
  if (!safe.ok || !safe.url) return fail(`URL refusée : ${safe.reason ?? 'adresse invalide'}`)
  const page = await withTimeout(readWebpage(safe.url, 6000), Math.min(ms, 20_000), null)
  if (!page || !String(page.text ?? '').trim()) return fail('Page illisible ou vide.')
  const text = String(page.text).replace(/\s+/g, ' ').trim().slice(0, 6000)
  const digest = createHash('sha256').update(text).digest('hex')

  // Mémoire de la dernière visite : une ligne SiteSetting par (blueprint, nœud, adresse).
  const key = `bp.watch.${blueprintId || 'libre'}.${node.id}.${createHash('sha1').update(safe.url).digest('hex').slice(0, 12)}`
  let previous = ''
  try {
    const row = (await db.siteSetting.findUnique({ where: { key } })) as { value?: unknown } | null
    if (row) previous = String((JSON.parse(String(row.value ?? '{}')) as { digest?: string }).digest ?? '')
  } catch {
    previous = ''
  }
  const payload = JSON.stringify({ digest, at: new Date().toISOString(), url: safe.url })
  try {
    if (previous || (await db.siteSetting.findUnique({ where: { key } }))) {
      await db.siteSetting.update({ where: { key }, data: { value: payload, updatedBy: 'blueprint' } })
    } else {
      await db.siteSetting.create({ data: { key, value: payload, updatedBy: 'blueprint' } })
    }
  } catch {
    /* mémoire indisponible : la surveillance reste utilisable */
  }

  const keyword = subst(cfgStr(node, 'keyword'), vars).trim().toLowerCase()
  const found = keyword ? text.toLowerCase().includes(keyword) : true
  const changed: 'initial' | 'oui' | 'non' = !previous ? 'initial' : previous === digest ? 'non' : 'oui'
  return { ok: true, text: changed === 'oui' ? 'Le contenu a changé depuis la dernière visite.' : changed === 'initial' ? 'Première visite : contenu mémorisé.' : 'Aucun changement.', changed, found, title: String(page.title ?? '').slice(0, 160), excerpt: text.slice(0, 1200) }
}

/** Informer l'utilisateur : notification dans NEXUS et/ou e-mail (SMTP configuré). */
async function runNotifyNode(node: BlueprintNode, vars: Record<string, string>, userId?: string | null): Promise<{ ok: boolean; detail: string }> {
  const title = subst(cfgStr(node, 'title', 'NEXUS'), vars).slice(0, 120) || 'NEXUS'
  const body = subst(cfgStr(node, 'body', '{{reponse}}'), vars).slice(0, 4000)
  const channel = cfgStr(node, 'channel', 'inapp')
  const parts: string[] = []
  let ok = true
  if (channel !== 'email') {
    try {
      await db.notification.create({ data: { userId: userId ?? '', title, body, source: 'blueprint', read: false } })
      parts.push('notification NEXUS')
    } catch (err) {
      ok = false
      parts.push(`notification impossible (${err instanceof Error ? err.message : 'erreur'})`)
    }
  }
  if (channel !== 'inapp') {
    const user = userId ? ((await db.user.findUnique({ where: { id: userId } })) as { email?: string } | null) : null
    if (!user?.email) {
      ok = false
      parts.push('e-mail : aucune adresse sur le compte')
    } else {
      const r = await sendPlainMail(user.email, `[NEXUS] ${title}`, body)
      if (!r.sent) ok = false
      parts.push(r.sent ? 'e-mail envoyé' : `e-mail non envoyé (${r.error ?? 'erreur'})`)
    }
  }
  return { ok, detail: parts.join(' · ') || 'aucun canal' }
}

/** Appel HTTP sortant (webhook) — vers VOTRE infrastructure, jamais unLLM. */
async function runWebhook(node: BlueprintNode, vars: Record<string, string>, ms: number): Promise<{ text: string; ok: boolean }> {
  const url = subst(cfgStr(node, 'url'), vars).trim()
  if (!/^https?:\/\//i.test(url)) return { text: 'URL de webhook invalide.', ok: false }
  const method = cfgStr(node, 'method', 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST'
  const bodyRaw = cfgStr(node, 'body')
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(ms, 15_000))
    const res = await fetch(url, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? subst(bodyRaw || '{"message":"{{message}}"}', vars) : undefined,
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = (await res.text()).slice(0, 8000)
    return { text, ok: res.ok }
  } catch (err) {
    return { text: `Webhook injoignable : ${err instanceof Error ? err.message : 'erreur'}`, ok: false }
  }
}

/**
 * Exécute un blueprint de bout en bout et renvoie la réponse à envoyer.
 * Ne jette jamais : en cas de schéma cassé, on rend le texte de repli.
 */
export async function runBlueprintGraph(graph: BlueprintGraph, options: RunOptions): Promise<RunResult> {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const edges = Array.isArray(graph?.edges) ? graph.edges : []
  const steps: BlueprintStep[] = []
  const vars: Record<string, string> = {
    message: options.message ?? '',
    historique: (options.history ?? []).map((m) => `${m.role === 'user' ? 'Client' : 'Assistant'}: ${m.content}`).join('\n'),
  }
  const started = Date.now()
  const budget = options.timeoutMs ?? DEFAULT_TIMEOUT
  const emit = (s: BlueprintStep) => {
    steps.push(s)
    options.onStep?.(s)
  }

  const result: RunResult = { reply: '', steps, vars, finished: false }

  if (nodes.length === 0) {
    result.reply = options.fallback ?? ''
    result.error = 'Blueprint vide'
    return result
  }

  const byId = new Map<string, BlueprintNode>()
  for (const n of nodes) if (n?.id) byId.set(String(n.id), n)

  const start =
    nodes.find((n) => n.type === 'start') ??
    nodes.find((n) => !edges.some((e) => e.to === n.id)) ??
    nodes[0]
  if (!start) {
    result.reply = options.fallback ?? ''
    result.error = 'Aucun nœud de départ'
    return result
  }

  let current: BlueprintNode | undefined = start
  const visits = new Map<string, number>()
  let guard = 0

  while (current && guard < MAX_STEPS) {
    guard++
    const elapsed = Date.now() - started
    if (elapsed > budget) {
      emit({ nodeId: current.id, type: current.type, label: 'Garde-fou', detail: `délai de ${budget} ms atteint`, status: 'error' })
      result.error = 'timeout'
      result.finished = true
      break
    }

    const count = (visits.get(current.id) ?? 0) + 1
    visits.set(current.id, count)
    if (count > MAX_VISITS_PER_NODE) {
      emit({ nodeId: current.id, type: current.type, label: 'Boucle détectée', detail: `nœud visité ${count} fois — arrêt`, status: 'error' })
      result.error = 'loop'
      result.finished = true
      break
    }

    const node = current
    const remaining = budget - (Date.now() - started)
    const stepBase = { nodeId: node.id, type: node.type, label: node.title || node.type }

    // ── Départ ──────────────────────────────────────────────────────────────
    if (node.type === 'start') {
      const greeting = cfgStr(node, 'greeting')
      if (greeting) vars.accueil = subst(greeting, vars)
      current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Règle : « quand tu lis X → réponds Y » ──────────────────────────────
    if (node.type === 'rule') {
      const rule: ReplyRule = {
        id: node.id,
        match: cfgStr(node, 'match'),
        mode: (cfgStr(node, 'mode', 'contains') as ReplyRule['mode']) || 'contains',
        reply: cfgStr(node, 'reply'),
        caseSensitive: cfgBool(node, 'caseSensitive'),
      }
      const hit = findMatchingRule([rule], options.message)
      if (hit) {
        result.matchedRule = hit.match
        emit({ ...stepBase, label: `Règle : « ${hit.match.slice(0, 40)} »`, detail: 'déclencheur reconnu', status: 'done' })
        const target = nextEdge(edges, node.id, 'match')
        if (target?.to) {
          vars.reponse = subst(hit.reply, vars)
          current = byId.get(target.to)
          continue
        }
        result.reply = subst(hit.reply, vars)
        result.finished = true
        break
      }
      emit({ ...stepBase, label: `Règle : « ${rule.match.slice(0, 40)} »`, detail: 'aucune correspondance', status: 'done' })
      const alt = edges.find((e) => e.from === node.id && e.fromPort === 'nomatch')
      current = byId.get(alt?.to ?? '')
      continue
    }

    // ── Condition ───────────────────────────────────────────────────────────
    if (node.type === 'condition') {
      const left = cfgStr(node, 'left', 'message')
      const variable = cfgStr(node, 'variable')
      const operator = cfgStr(node, 'operator', 'contains')
      const value = subst(cfgStr(node, 'value'), vars)
      const subject = left === 'variable' ? (vars[variable] ?? '') : options.message
      const a = subject.toLowerCase().trim()
      const b = value.toLowerCase().trim()
      let ok = false
      if (operator === 'contains') ok = a.includes(b)
      else if (operator === 'equals') ok = a === b
      else if (operator === 'notEquals') ok = a !== b
      else if (operator === 'isEmpty') ok = a.length === 0
      else if (operator === 'startsWith') ok = a.startsWith(b)
      else if (operator === 'regex') {
        try { ok = new RegExp(value, 'i').test(subject) } catch { ok = false }
      }
      emit({ ...stepBase, label: `Condition ${operator}`, detail: `${left === 'variable' ? variable : 'message'} → ${ok ? 'VRAI' : 'FAUX'}`, status: 'done' })
      const branch = edges.find((e) => e.from === node.id && e.fromPort === (ok ? 'true' : 'false'))
      current = byId.get(branch?.to ?? '')
      continue
    }

    // ── Cerveau local ───────────────────────────────────────────────────────
    if (node.type === 'brain') {
      emit({ ...stepBase, label: 'Cerveau NEXUS', detail: 'réflexion locale en cours…', status: 'running' })
      const instruction = subst(cfgStr(node, 'instruction'), vars)
      const text = await runBrainNode(instruction, options.message, options.history ?? [], cfgBool(node, 'useHistory', true), remaining)
      const name = cfgStr(node, 'variable', 'reponse')
      if (name) vars[name] = text
      vars.reponse = text
      emit({ ...stepBase, label: 'Cerveau NEXUS', detail: `${text.length} caractères produits`, status: text ? 'done' : 'error' })
      current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Base de connaissances du compte ─────────────────────────────────────
    if (node.type === 'knowledge') {
      emit({ ...stepBase, label: 'Base de connaissances', detail: 'recherche…', status: 'running' })
      const query = subst(cfgStr(node, 'query'), vars).trim() || options.message
      const text = await searchKnowledge(options.userId, query, cfgNum(node, 'max', 3))
      const name = cfgStr(node, 'variable', 'connaissances')
      if (name) vars[name] = text
      emit({ ...stepBase, label: 'Base de connaissances', detail: text ? `${text.length} caractères trouvés` : 'aucune note pertinente', status: 'done' })
      current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Outil ───────────────────────────────────────────────────────────────
    if (node.type === 'tool') {
      const tool = cfgStr(node, 'tool', 'web_search')
      emit({ ...stepBase, label: `Outil : ${tool}`, detail: 'exécution…', status: 'running' })
      const text = tool === 'memory' ? await loadMemory(options.userId, cfgNum(node, 'max', 10)) : await runToolNode(tool, subst(cfgStr(node, 'argument'), vars), options.message, remaining, options.userId)
      const failed = /^(Aucun|Outil «|Webhook|Boîte mail|Compte GitHub)/.test(text)
      const name = cfgStr(node, 'variable', 'donnees')
      if (name) vars[name] = text
      emit({ ...stepBase, label: `Outil : ${tool}`, detail: text.slice(0, 120), status: failed ? 'error' : 'done' })
      const branch = failed ? edges.find((e) => e.from === node.id && e.fromPort === 'error') : undefined
      current = byId.get(branch?.to ?? nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Variable ────────────────────────────────────────────────────────────
    if (node.type === 'variable') {
      const name = cfgStr(node, 'name', 'variable')
      const value = subst(cfgStr(node, 'value'), vars)
      vars[name] = value
      emit({ ...stepBase, label: `Variable ${name}`, detail: value.slice(0, 80) || '(vide)', status: 'done' })
      current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Webhook ─────────────────────────────────────────────────────────────
    if (node.type === 'webhook') {
      emit({ ...stepBase, label: 'Webhook', detail: 'appel HTTP…', status: 'running' })
      const { text, ok } = await runWebhook(node, vars, remaining)
      const name = cfgStr(node, 'variable', 'api')
      if (name) vars[name] = text
      emit({ ...stepBase, label: 'Webhook', detail: ok ? 'réponse reçue' : text.slice(0, 120), status: ok ? 'done' : 'error' })
      const branch = ok ? undefined : edges.find((e) => e.from === node.id && e.fromPort === 'error')
      current = byId.get(branch?.to ?? nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Surveillance de site ────────────────────────────────────────────────
    if (node.type === 'watch') {
      emit({ ...stepBase, label: 'Surveillance', detail: 'lecture de la page…', status: 'running' })
      const w = await runWatchNode(node, vars, remaining, options.blueprintId ?? '')
      const name = cfgStr(node, 'variable', 'veille') || 'veille'
      vars[name] = w.excerpt
      vars[`${name}_titre`] = w.title
      vars[`${name}_changed`] = w.changed
      vars[`${name}_found`] = w.found ? 'oui' : 'non'
      emit({ ...stepBase, label: 'Surveillance', detail: w.ok ? `${w.text}${cfgStr(node, 'keyword') ? ` · mot-clé ${w.found ? 'trouvé' : 'absent'}` : ''}` : w.text, status: w.ok ? 'done' : 'error' })
      const branch = w.ok ? undefined : edges.find((e) => e.from === node.id && e.fromPort === 'error')
      current = byId.get(branch?.to ?? nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Informer l'utilisateur ──────────────────────────────────────────────
    if (node.type === 'notify') {
      const n = await runNotifyNode(node, vars, options.userId)
      emit({ ...stepBase, label: 'Information', detail: n.detail, status: n.ok ? 'done' : 'error' })
      current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
      continue
    }

    // ── Réponse finale ──────────────────────────────────────────────────────
    if (node.type === 'reply') {
      result.reply = subst(cfgStr(node, 'text'), vars) || vars.reponse || ''
      emit({ ...stepBase, label: 'Réponse', detail: `${result.reply.length} caractères`, status: 'done' })
      result.finished = true
      break
    }

    // ── Fin ─────────────────────────────────────────────────────────────────
    if (node.type === 'end') {
      const finalText = subst(cfgStr(node, 'text'), vars)
      result.reply = finalText || vars.reponse || ''
      emit({ ...stepBase, label: 'Fin du schéma', detail: finalText ? 'texte final défini' : 'réponse calculée renvoyée', status: 'done' })
      result.finished = true
      break
    }

    // Type de nœud inconnu : on avance prudemment
    current = byId.get(nextEdge(edges, node.id, 'out')?.to ?? '')
  }

  if (!result.reply) result.reply = vars.reponse || options.fallback || ''
  return result
}
