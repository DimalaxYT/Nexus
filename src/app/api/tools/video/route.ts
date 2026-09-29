// ─── NEXUS — Génération vidéo 100 % locale (moteur procédural + ffmpeg) ──────
// POST { prompt, duration, quality, variant } → tâche de rendu asynchrone
// GET  ?taskId=… → { status: RUNNING|SUCCESS|FAIL, url, error }
// GET  ?id=… → (route /file) le fichier MP4, avec support Range.

import { NextRequest } from 'next/server'
import { renderVideo, type VideoResult } from '@/lib/brain/videogen'

export const runtime = 'nodejs'
export const maxDuration = 300

interface VideoTask {
  id: string
  status: 'RUNNING' | 'SUCCESS' | 'FAIL'
  url?: string
  error?: string
  prompt: string
  startedAt: number
  result?: VideoResult
}

// Registre persisté sur globalThis (survit au rechargement du module en dev)
const registry = globalThis as unknown as { __nexusVideoTasks?: Map<string, VideoTask> }
const tasks: Map<string, VideoTask> = registry.__nexusVideoTasks ?? new Map()
registry.__nexusVideoTasks = tasks

let active = 0

function startTask(taskId: string, prompt: string, duration: number, quality: 'speed' | 'quality', variant: number) {
  const task = tasks.get(taskId)!
  active++
  renderVideo(prompt, { duration, quality, variant })
    .then((res) => {
      task.status = 'SUCCESS'
      task.url = res.url
      task.result = res
    })
    .catch((err) => {
      task.status = 'FAIL'
      task.error = err instanceof Error ? err.message : 'Rendu impossible'
    })
    .finally(() => {
      active--
      // Nettoyage des vieilles tâches (> 1 h)
      const now = Date.now()
      for (const [k, t] of tasks) {
        if (t.status !== 'RUNNING' && now - t.startedAt > 3600_000) tasks.delete(k)
      }
    })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const prompt = String(body?.prompt ?? '').trim().slice(0, 600)
  if (!prompt) {
    return Response.json({ error: 'Un prompt est requis pour générer une vidéo' }, { status: 400 })
  }
  const duration = Number(body?.duration) === 10 ? 10 : 5
  const quality: 'speed' | 'quality' = body?.quality === 'quality' ? 'quality' : 'speed'
  const variant = Math.max(0, Math.min(20, Number(body?.variant) || 0))

  if (active >= 2) {
    return Response.json({ error: 'Un rendu est déjà en cours — réessaie dans quelques secondes' }, { status: 429 })
  }

  const taskId = `vt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  tasks.set(taskId, { id: taskId, status: 'RUNNING', prompt, startedAt: Date.now() })
  startTask(taskId, prompt, duration, quality, variant)

  return Response.json({ taskId, status: 'RUNNING', engine: 'procédural local + ffmpeg' })
}

export async function GET(req: NextRequest) {
  const taskId = req.nextUrl.searchParams.get('taskId')?.trim()
  if (!taskId) {
    return Response.json({ error: 'taskId requis' }, { status: 400 })
  }
  const task = tasks.get(taskId)
  if (!task) return Response.json({ status: 'FAIL', error: 'Tâche inconnue ou expirée' }, { status: 404 })
  if (task.status === 'SUCCESS') {
    return Response.json({ status: 'SUCCESS', url: task.url, taskId, description: task.result?.description, theme: task.result?.theme })
  }
  if (task.status === 'FAIL') {
    return Response.json({ status: 'FAIL', error: task.error ?? 'Rendu impossible', taskId })
  }
  return Response.json({ status: 'RUNNING', taskId, elapsed: Math.round((Date.now() - task.startedAt) / 1000) })
}
