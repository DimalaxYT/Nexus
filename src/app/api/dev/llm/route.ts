// Modèle de langage maison (espace Dev → Entraînement).
// GET  → modèle actif, état de l'entraînement en cours, aperçu du corpus (sans texte)
// POST → { action: 'start', steps? } | { action: 'stop' }

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { buildCorpus } from '@/lib/llm/corpus'
import { getTrainJob, startTraining, stopTraining } from '@/lib/llm/train'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function safeJson(raw: unknown): Record<string, unknown> {
  try {
    return JSON.parse(String(raw ?? '{}')) as Record<string, unknown>
  } catch {
    return {}
  }
}

async function snapshot() {
  const row = (await db.llmModel.findFirst({ where: { active: true }, orderBy: { updatedAt: 'desc' } })) as Record<string, unknown> | null
  const model = row
    ? {
        id: String(row.id),
        steps: Number(row.steps ?? 0),
        loss: Number(row.loss ?? 0),
        corpusChars: Number(row.corpusChars ?? 0),
        corpusInfo: safeJson(row.corpusInfo),
        lexiconSize: Array.isArray(safeJson(row.config).lexicon) ? (safeJson(row.config).lexicon as unknown[]).length : 0,
        config: { ctx: safeJson(row.config).ctx, dim: safeJson(row.config).dim, heads: safeJson(row.config).heads, layers: safeJson(row.config).layers, vocab: safeJson(row.config).vocab },
        createdAt: row.createdAt ? new Date(row.createdAt as Date).toISOString() : null,
        updatedAt: row.updatedAt ? new Date(row.updatedAt as Date).toISOString() : null,
      }
    : null
  const job = getTrainJob()
  const corpus = await buildCorpus()
  return {
    model,
    job: job
      ? {
          status: job.status,
          sessionStep: job.sessionStep,
          sessionTotal: job.sessionTotal,
          totalSteps: job.totalSteps,
          loss: job.loss,
          lr: job.lr,
          lossHistory: job.lossHistory.slice(-200),
          params: job.params,
          resumed: job.resumed,
          error: job.error,
          log: job.log,
          startedAt: job.startedAt,
          endedAt: job.endedAt,
        }
      : null,
    corpus: { chars: corpus.chars, sources: corpus.sources, trainable: corpus.chars >= 4000 },
  }
}

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  try {
    return Response.json(await snapshot())
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Lecture impossible' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const action = String(body.action ?? '')
  try {
    if (action === 'start') {
      const steps = Number(body.steps) > 0 ? Number(body.steps) : 1500
      await startTraining({ steps, resume: true })
      return Response.json({ ok: true, ...(await snapshot()) })
    }
    if (action === 'stop') {
      const stopped = stopTraining()
      return Response.json({ ok: stopped, message: stopped ? 'Arrêt demandé : le point de contrôle sera enregistré.' : 'Aucun entraînement en cours.', ...(await snapshot()) })
    }
    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : 'Entraînement impossible' }, { status: 400 })
  }
}
