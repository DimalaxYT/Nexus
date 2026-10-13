// ─── NEXUS — API PUBLIQUE v1 (chatbots revendables) ──────────────────────────
// Une clé API = un chatbot prêt à vendre. Le client (votre client) appelle
// cette URL avec SA clé et reçoit une réponse produite par le cerveau LOCAL de
// NEXUS, en respectant exactement la configuration que vous avez définie :
//
//   1. les RÈGLES « quand tu lis X → réponds Y » (prioritaires, réponse exacte)
//   2. le BLUEPRINT lié (le schéma que vous avez construit)
//   3. l'AGENT lié (sa personnalité) ou le cerveau NEXUS avec votre prompt
//
// Exemple :
//   curl -X POST https://votre-serveur/api/v1/chat \
//        -H "Authorization: Bearer nx_…" \
//        -H "Content-Type: application/json" \
//        -d '{"message":"Pourquoi mon ordinateur ne fonctionne pas"}'

import { NextRequest } from 'next/server'
import { authenticateApiKey, corsHeaders, logApiCall, type ApiKeyInfo } from '@/lib/api-keys'
import { findMatchingRule } from '@/lib/rules'
import { runBlueprintGraph, type BlueprintStep } from '@/lib/blueprint'
import { processTurn } from '@/lib/brain/brain'
import { db } from '@/lib/db'
import { parseGraph } from '@/lib/nexus-types'
import type { UserProfile } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ChatBody {
  message?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  sessionId?: string
}

interface ChatResult {
  reply: string
  source: 'rule' | 'blueprint' | 'agent' | 'brain' | 'welcome' | 'fallback'
  matched?: string | null
  steps?: { label: string; detail: string; status: string }[]
}

function cleanHistory(history: unknown): { role: 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(history)) return []
  return history
    .filter((m) => m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: String(m.content).slice(0, 4000) }))
}

/** Fait répondre le cerveau LOCAL de NEXUS (aucun service externe). */
async function runLocalBrain(
  messages: { role: 'user' | 'assistant'; content: string }[],
  systemPrompt: string,
  target: { kind: 'nexus' } | { kind: 'agent'; agentId: string },
  userId: string,
  profile: UserProfile | undefined
): Promise<string> {
  let text = ''
  // Le prompt système voyage à part du message : le texte du visiteur reste
  // intact, sinon il fausse l'analyse du sujet (le sujet remontait dans la
  // réponse sous la forme « consignes propriétaire tu es l'assistant… »).
  await processTurn(
    { messages, target, userId, profile, systemPrompt: systemPrompt.trim() || undefined },
    (event) => {
      if (event.type === 'token') text += event.content
    }
  )
  return text.trim()
}

/** Résout le blueprint à utiliser : celui de la clé, sinon celui de l'agent. */
async function resolveBlueprint(key: ApiKeyInfo): Promise<{ graph: ReturnType<typeof parseGraph>; id: string } | null> {
  const id = key.blueprintId
  if (id) {
    const row = await db.blueprint.findUnique({ where: { id } })
    if (row && row.enabled !== false) return { graph: parseGraph(row.graph), id }
  }
  if (key.agentId) {
    const agent = await db.agentProfile.findUnique({ where: { id: key.agentId } })
    const bpId = String(agent?.blueprintId ?? '')
    if (bpId) {
      const row = await db.blueprint.findUnique({ where: { id: bpId } })
      if (row && row.enabled !== false) return { graph: parseGraph(row.graph), id: bpId }
    }
  }
  return null
}

async function handleChat(req: NextRequest): Promise<Response> {
  const started = Date.now()
  const auth = await authenticateApiKey(req)
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status })
  }
  const { key, userId } = auth

  let body: ChatBody = {}
  if (req.method === 'POST') body = (await req.json().catch(() => ({}))) as ChatBody
  else body = { message: new URL(req.url).searchParams.get('message') ?? '' }

  const message = String(body.message ?? '').trim().slice(0, 8000)
  const history = cleanHistory(body.history)
  const config = key.config

  // Profil du propriétaire : le chatbot parle comme le compte qui l'a créé.
  const owner = await db.user.findUnique({ where: { id: userId } })
  let profile: UserProfile | undefined
  try {
    profile = owner?.profile ? (JSON.parse(String(owner.profile)) as UserProfile) : undefined
  } catch {
    profile = undefined
  }

  const finish = (result: ChatResult, ok = true) => {
    const payload: Record<string, unknown> = {
      reply: result.reply,
      source: result.source,
      matched: result.matched ?? null,
      model: 'nexus-local',
      ms: Date.now() - started,
      key: { name: key.name, prefix: key.prefix },
      ...(config.debug && result.steps ? { steps: result.steps } : {}),
    }
    void logApiCall(key.id, ok, Date.now() - started, message, result.reply)
    return Response.json(payload, { headers: corsHeaders(key, req.headers.get('origin')) })
  }

  // 0 — Message vide : on renvoie l'accueil configuré
  if (!message) {
    return finish({ reply: config.welcomeMessage || 'Bonjour 👋 Comment puis-je vous aider ?', source: 'welcome' })
  }

  // 1 — RÈGLES : « quand tu lis X → réponds Y » (réponse EXACTE, prioritaire)
  const rule = findMatchingRule(config.rules, message)
  if (rule) {
    return finish({ reply: rule.reply, source: 'rule', matched: rule.match })
  }
  if (config.strictRulesOnly) {
    return finish({ reply: config.fallbackMessage, source: 'fallback' }, false)
  }

  // 2 — BLUEPRINT : le schéma construit à la main
  try {
    const bp = await resolveBlueprint(key)
    if (bp && bp.graph.nodes.length > 0) {
      const steps: BlueprintStep[] = []
      const result = await runBlueprintGraph(bp.graph, {
        message,
        history,
        userId,
        fallback: config.fallbackMessage,
        timeoutMs: 40_000,
        onStep: (s) => steps.push(s),
      })
      if (result.reply) {
        return finish({
          reply: result.reply,
          source: 'blueprint',
          matched: result.matchedRule ?? null,
          steps: steps.map((s) => ({ label: s.label, detail: s.detail, status: s.status })),
        })
      }
    }
  } catch {
    /* schéma en erreur → on continue avec le repli */
  }

  // 3 — AGENT lié (sa personnalité) ou cerveau NEXUS
  try {
    const target =
      config.useAgent && key.agentId ? ({ kind: 'agent', agentId: key.agentId } as const) : ({ kind: 'nexus' } as const)
    const text = await runLocalBrain(
      [...history, { role: 'user' as const, content: message }],
      config.systemPrompt,
      target,
      userId,
      profile
    )
    if (text) return finish({ reply: text, source: key.agentId && config.useAgent ? 'agent' : 'brain' })
  } catch {
    /* cerveau indisponible → repli */
  }

  return finish({ reply: config.fallbackMessage, source: 'fallback' }, false)
}

export async function POST(req: NextRequest) {
  return handleChat(req)
}

/** GET ?message=… : intégration ultra-simple (iframes, webhooks, tests). */
export async function GET(req: NextRequest) {
  return handleChat(req)
}

/** Pré-vol CORS (le widget de vos clients appelle depuis un autre domaine). */
export async function OPTIONS(req: NextRequest) {
  const auth = await authenticateApiKey(req)
  if (auth.ok) {
    return new Response(null, { status: 204, headers: corsHeaders(auth.key, req.headers.get('origin')) })
  }
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': req.headers.get('origin') ?? '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
    },
  })
}
