// ─── NEXUS — API du modèle de langue local (100 % TypeScript) ─────────────────
// GET  /api/llm : état réel du modèle (poids livrés ou entraînés ici, étapes,
//                 perte, configuration, vocabulaire, options d'échantillonnage).
// POST /api/llm : { prompt, maxTokens?, temperature?, topK?, seed?, … }
//                 -> { text, tokens, avgNll, ms, stop, model }
//
// Le modèle tourne DANS ce process (`src/lib/llm`) : transformateur, cache
// clé/valeur, tokenizer et échantillonnage écrits à la main. Aucun Ollama, aucune
// API externe, et aucun process annexe à lancer.
//
// Cette route pointait auparavant vers le prototype NumPy (`llm/`, serveur
// `python -m nexus_llm.serve`) et répondait 503 « lancez python … » dès que ce
// process n'était pas là — exactement la dépendance externe que le projet
// s'interdit. Le prototype reste dans `llm/` comme référence historique.

import { loadActiveModel } from '@/lib/llm/engine'
import { sample } from '@/lib/llm/generate'
import { countParams } from '@/lib/llm/model'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Réglages réellement implémentés par l'échantillonneur local. */
const SUPPORTED = ['prompt', 'maxTokens', 'temperature', 'topK', 'seed', 'repeatPenalty', 'repetitionPenalty', 'repeatWindow', 'stopAtLine', 'stopAtBlank', 'stopSequences'] as const
/** Réglages demandés par d'anciens clients mais NON implémentés par
 *  l'échantillonneur local (`generate.ts` ne fait que temperature + top-k +
 *  pénalité de répétition) : on refuse plutôt que de faire croire qu'ils ont été
 *  appliqués. */
const NOT_IMPLEMENTED = ['topP', 'minP', 'beamWidth'] as const

export async function GET() {
  const model = await loadActiveModel().catch(() => null)
  if (!model) {
    return Response.json({
      available: false,
      model: null,
      hint: 'Aucun poids trouvé : entraînez avec `node --import tsx scripts/train-chat.ts` ou remettez public/models/nexus-chat-v1.{bin,json}.',
    })
  }
  const { cfg } = model
  return Response.json({
    available: true,
    provider: 'nexus-local-engine',
    model: {
      id: model.id,
      format: cfg.format,
      tokenizer: cfg.tokenizer ?? 'char',
      vocab: cfg.vocab,
      ctx: cfg.ctx,
      dim: cfg.dim,
      heads: cfg.heads,
      layers: cfg.layers,
      params: countParams(model.params),
      steps: model.steps,
      loss: Number(Number(model.loss).toFixed(4)),
      corpusChars: model.corpusChars,
      lexicon: model.lexicon.size,
      // `seeded` = poids livrés dans le dépôt (un déploiement neuf discute tout de
      // suite) ; `false` = modèle entraîné sur cette instance.
      seeded: model.seeded,
    },
    sampling: { supported: SUPPORTED, notImplemented: NOT_IMPLEMENTED },
  })
}

export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'corps JSON invalide' }, { status: 400 })
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
  if (!prompt) return Response.json({ error: 'prompt manquant' }, { status: 400 })

  const refused = NOT_IMPLEMENTED.filter((k) => body[k] !== undefined)
  if (refused.length) {
    return Response.json(
      { error: `Réglage(s) non implémenté(s) par l'échantillonneur local : ${refused.join(', ')}. Retirez-les — rien ne serait appliqué.`, supported: SUPPORTED },
      { status: 400 }
    )
  }

  const model = await loadActiveModel().catch(() => null)
  if (!model) {
    return Response.json(
      {
        error: 'Aucun modèle local chargé : entraînez avec `node --import tsx scripts/train-chat.ts`, ou remettez les poids livrés dans public/models/.',
      },
      { status: 503 }
    )
  }

  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  const repeat = body.repeatPenalty !== undefined ? body.repeatPenalty : body.repetitionPenalty
  const res = sample(model, prompt, {
    maxTokens: Math.max(1, Math.min(1024, num(body.maxTokens, 120))),
    temperature: Math.max(0, num(body.temperature, 0.9)),
    topK: Math.max(1, num(body.topK, 40)),
    seed: typeof body.seed === 'number' ? body.seed : undefined,
    repeatPenalty: num(repeat, 1.1),
    repeatWindow: num(body.repeatWindow, 28),
    stopAtLine: body.stopAtLine === true,
    stopAtBlank: body.stopAtBlank === true,
    stopSequences: Array.isArray(body.stopSequences) ? body.stopSequences.filter((s): s is string => typeof s === 'string') : undefined,
  })

  return Response.json({
    text: res.text,
    tokens: res.tokens,
    promptTokens: res.promptTokens,
    avgNll: Number(res.avgNll.toFixed(3)),
    ms: res.ms,
    stop: res.stop,
    model: { id: model.id, format: model.cfg.format, tokenizer: model.cfg.tokenizer ?? 'char', seeded: model.seeded, steps: model.steps },
  })
}
