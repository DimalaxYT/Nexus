// Web Worker : charge le LLM « code-v1 » et génère hors du fil principal, pour
// que l'interface reste fluide. Tout se passe dans le navigateur de l'utilisateur.
/// <reference lib="webworker" />

import { generate, NexusCodeModel, type NexusCodeMeta } from './nexus-code'

export type WorkerRequest =
  | { type: 'generate'; id: number; question: string; maxNew?: number }
  | { type: 'load'; id: number }

export type WorkerResponse =
  | { type: 'progress'; id: number; loaded: number; total: number }
  | { type: 'ready'; id: number; params: number; steps: number }
  | { type: 'chunk'; id: number; text: string }
  | { type: 'done'; id: number; text: string }
  | { type: 'error'; id: number; message: string }

const MODEL_BASE = '/models/nexus-code-v1'
const STOPS = ['<fin>', '### Demande']

let modelPromise: Promise<NexusCodeModel> | null = null

function post(msg: WorkerResponse) {
  ;(self as unknown as Worker).postMessage(msg)
}

async function fetchWithProgress(url: string, id: number): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok || !res.body) throw new Error(`modèle introuvable (${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let loaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.length
    post({ type: 'progress', id, loaded, total })
  }
  const out = new Uint8Array(loaded)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out.buffer
}

function getModel(id: number): Promise<NexusCodeModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const meta = (await (await fetch(`${MODEL_BASE}.json`, { cache: 'force-cache' })).json()) as NexusCodeMeta
      const buf = await fetchWithProgress(`${MODEL_BASE}.bin`, id)
      return new NexusCodeModel(meta, buf)
    })()
    modelPromise.catch(() => {
      modelPromise = null
    })
  }
  return modelPromise
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data
  try {
    const model = await getModel(req.id)
    if (req.type === 'load') {
      post({ type: 'ready', id: req.id, params: model.meta.params, steps: model.meta.steps })
      return
    }
    const question = req.question.slice(0, 600)
    const prompt = `### Demande:\n${question}\n\n### Réponse:\n`
    const text = generate(model, prompt, {
      maxNew: Math.min(req.maxNew ?? 320, 600),
      // Réglages retenus (eval-sampling.ts) : moins de boucles, sans fuite de <fin>.
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
      repeatPenalty: 1.1,
      stops: STOPS,
      onText: (chunk) => post({ type: 'chunk', id: req.id, text: chunk }),
    })
    post({ type: 'done', id: req.id, text: text.trim() })
  } catch (e) {
    post({ type: 'error', id: req.id, message: e instanceof Error ? e.message : String(e) })
  }
}
