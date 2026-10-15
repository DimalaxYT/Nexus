// Client du LLM « code-v1 » : pilote le Web Worker depuis l'interface.
// Le serveur ne fait que servir les fichiers de poids ; l'inférence a lieu ici,
// dans le navigateur de l'utilisateur (aucune API, aucun appel à un modèle distant).
import type { WorkerRequest, WorkerResponse } from './nexus-code.worker'

export interface LocalGenOptions {
  onText?: (chunk: string) => void
  onProgress?: (loaded: number, total: number) => void
  signal?: AbortSignal
  maxNew?: number
}

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void; opts: LocalGenOptions }>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./nexus-code.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data
      const job = pending.get(msg.id)
      if (!job) return
      if (msg.type === 'progress') job.opts.onProgress?.(msg.loaded, msg.total)
      else if (msg.type === 'chunk') job.opts.onText?.(msg.text)
      else if (msg.type === 'done') {
        pending.delete(msg.id)
        job.resolve(msg.text)
      } else if (msg.type === 'error') {
        pending.delete(msg.id)
        job.reject(new Error(msg.message))
      } else if (msg.type === 'ready') {
        pending.delete(msg.id)
        job.resolve('')
      }
    }
    worker.onerror = () => {
      for (const [id, job] of pending) job.reject(new Error('le moteur local a planté'))
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

function post(req: WorkerRequest, opts: LocalGenOptions): Promise<string> {
  const w = getWorker()
  return new Promise<string>((resolve, reject) => {
    pending.set(req.id, { resolve, reject, opts })
    w.postMessage(req)
  })
}

/** Charge le modèle dans le navigateur (une seule fois) et renvoie ses dimensions. */
export function loadLocalModel(opts: LocalGenOptions = {}): Promise<string> {
  return post({ type: 'load', id: nextId++ }, opts)
}

/** Répond à une question avec le modèle local. Renvoie le texte complet. */
export function askLocalModel(question: string, opts: LocalGenOptions = {}): Promise<string> {
  const id = nextId++
  const abort = () => {
    // Un worker ne sait pas annuler une génération en cours : on le réinitialise.
    const job = pending.get(id)
    if (!job) return
    pending.delete(id)
    job.reject(new DOMException('annulé', 'AbortError'))
    worker?.terminate()
    worker = null
  }
  opts.signal?.addEventListener('abort', abort, { once: true })
  return post({ type: 'generate', id, question, maxNew: opts.maxNew }, opts).finally(() => {
    opts.signal?.removeEventListener('abort', abort)
  })
}
