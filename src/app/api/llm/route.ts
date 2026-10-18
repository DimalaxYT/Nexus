// ─── NEXUS — API du vrai modèle de langue local (llm/) ───────────────────────
// GET  /api/llm : le modèle entraîné de zéro est-il en ligne ? (étape, pertes)
// POST /api/llm : { prompt, maxTokens?, temperature?, topK?, topP?, seed? }
//                 -> { text, model } généré par le GPT NumPy local.
// Le modèle tourne dans le serveur d'inférence local (python -m
// nexus_llm.serve) : aucun Ollama, aucune API externe. S'il est éteint,
// GET répond available:false et POST renvoie une 503 explicite.

import { generateWithLocalLlm, getLocalLlmStatus } from '@/lib/brain/llm-local'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const status = await getLocalLlmStatus()
  return Response.json({
    model: 'nexus-llm (GPT NumPy entraîné de zéro, voir llm/)',
    ...status,
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
  if (!prompt) {
    return Response.json({ error: 'prompt manquant' }, { status: 400 })
  }
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback

  const text = await generateWithLocalLlm(prompt, {
    maxTokens: num(body.maxTokens, 120),
    temperature: num(body.temperature, 0.9),
    topK: num(body.topK, 40),
    topP: num(body.topP, 0.95),
    repetitionPenalty: num(body.repetitionPenalty, 1.1),
    minP: num(body.minP, 0),
    beamWidth: num(body.beamWidth, 1),
    seed: typeof body.seed === 'number' ? body.seed : undefined,
  })
  if (text === null) {
    return Response.json(
      {
        error:
          'Modèle local indisponible : lancez `python -m nexus_llm.serve` dans le dossier llm/ (voir llm/README.md).',
      },
      { status: 503 },
    )
  }
  return Response.json({ text, model: 'nexus-llm' })
}
