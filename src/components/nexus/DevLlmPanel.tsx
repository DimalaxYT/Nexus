'use client'

// ─── NEXUS — Espace Dev : modèle de langage maison (entraînement local) ─────
// Le modèle est un petit transformeur écrit à la main (aucune API, aucun Ollama) :
// il s'entraîne sur le corpus de NEXUS (base de connaissances, notes, apprentissages
// validés, mémoires, conversations non exclues) et se met à jour à chaque entraînement.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, Loader2, Play, RefreshCw, Square } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface LlmSnapshot {
  model: {
    id: string; steps: number; loss: number; corpusChars: number; corpusInfo: Record<string, number>
    lexiconSize: number; config: { ctx: number; dim: number; heads: number; layers: number; vocab: number }
    createdAt: string | null; updatedAt: string | null
  } | null
  job: {
    status: 'running' | 'done' | 'stopped' | 'error'; sessionStep: number; sessionTotal: number; totalSteps: number
    loss: number; lr: number; lossHistory: { step: number; loss: number }[]; params: number; resumed: boolean
    error: string; log: string[]; startedAt: number; endedAt: number | null
  } | null
  corpus: { chars: number; sources: Record<string, number>; trainable: boolean }
}

const SOURCE_LABEL: Record<string, string> = {
  nexusKnowledge: 'Connaissances NEXUS',
  knowledge: 'Base de connaissances',
  trainingItems: 'Apprentissages validés',
  memories: 'Mémoires',
  conversations: 'Conversations',
  conversationsExcluded: 'Conversations exclues',
}

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T & { error?: string }> {
  const res = await fetch('/api/dev/llm', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok && !data.error) data.error = `Erreur ${res.status}`
  return data
}

function Sparkline({ points }: { points: { step: number; loss: number }[] }) {
  if (points.length < 2) return <p className="text-xs text-muted-foreground">La courbe apparaîtra pendant l’entraînement.</p>
  const w = 600
  const h = 120
  const xs = points.map((p) => p.step)
  const ys = points.map((p) => p.loss)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs, x0 + 1)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys, y0 + 0.01)
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(((p.step - x0) / (x1 - x0)) * (w - 8) + 4).toFixed(1)},${(h - 4 - ((p.loss - y0) / (y1 - y0)) * (h - 8)).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full rounded-lg border border-border/60 bg-muted/50">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2" className="text-foreground" />
    </svg>
  )
}

export function DevLlmPanel() {
  const [snap, setSnap] = useState<LlmSnapshot | null>(null)
  const [steps, setSteps] = useState('1500')
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    const data = await call<LlmSnapshot>('GET')
    if (data.error) toast.error(data.error)
    else setSnap(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Rafraîchit pendant un entraînement, sinon à la demande.
  useEffect(() => {
    const running = snap?.job?.status === 'running'
    if (running && timer.current === null) {
      timer.current = window.setInterval(() => void load(), 4000)
    }
    if (!running && timer.current !== null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [snap?.job?.status, load])

  const start = async () => {
    setBusy(true)
    const data = await call<LlmSnapshot>('POST', { action: 'start', steps: Number(steps) })
    setBusy(false)
    if (data.error) return toast.error(data.error)
    setSnap(data)
    toast.success('Entraînement lancé en arrière-plan')
  }

  const stop = async () => {
    const data = await call<LlmSnapshot & { message?: string }>('POST', { action: 'stop' })
    if (data.error) return toast.error(data.error)
    toast.message(data.message ?? 'Arrêt demandé')
    setSnap(data)
  }

  const job = snap?.job
  const running = job?.status === 'running'
  const progress = job && job.sessionTotal > 0 ? Math.min(100, Math.round((job.sessionStep / job.sessionTotal) * 100)) : 0

  return (
    <section className="space-y-4 rounded-xl border border-border/70 bg-card/60 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Brain className="h-3.5 w-3.5" /> Modèle de langage maison
          <Badge variant="outline" className="text-[10px]">100 % local · sans API</Badge>
        </h3>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void load()}>
          <RefreshCw className="h-3 w-3" /> Actualiser
        </Button>
      </header>

      {!snap ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Modèle</p>
              <p className="mt-1 font-semibold">{snap.model ? `${snap.model.steps.toLocaleString('fr-FR')} étapes` : 'non entraîné'}</p>
              <p className="text-[10px] text-muted-foreground">{snap.model ? `mis à jour ${new Date(snap.model.updatedAt ?? '').toLocaleString('fr-FR')}` : 'lance un premier entraînement'}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Perte (nats/caractère)</p>
              <p className="mt-1 font-semibold">{snap.model ? snap.model.loss.toFixed(3) : '—'}</p>
              <p className="text-[10px] text-muted-foreground">plus bas = mieux ; ~2,5 au hasard</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Architecture</p>
              <p className="mt-1 font-semibold">{snap.model ? `${snap.model.config.layers} couches · ${snap.model.config.dim} dim.` : '—'}</p>
              <p className="text-[10px] text-muted-foreground">
                {snap.model ? `${snap.model.config.heads} têtes · contexte ${snap.model.config.ctx} · lexique ${snap.model.lexiconSize}` : 'transformeur à caractères'}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Corpus</p>
              <p className="mt-1 font-semibold">{snap.corpus.chars.toLocaleString('fr-FR')} caractères</p>
              <p className={cn('text-[10px]', snap.corpus.trainable ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300')}>
                {snap.corpus.trainable ? 'suffisant pour entraîner' : 'trop court (minimum 4 000)'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {Object.entries(snap.corpus.sources).map(([k, v]) => (
              <Badge key={k} variant="outline" className="text-[10px]">
                {SOURCE_LABEL[k] ?? k} : {v}
              </Badge>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Étapes à effectuer</span>
              <Input value={steps} onChange={(e) => setSteps(e.target.value.replace(/\D/g, ''))} className="h-9 w-32 text-xs" disabled={running} />
            </label>
            <Button size="sm" className="h-9 gap-1.5" disabled={busy || running || !snap.corpus.trainable} onClick={() => void start()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              {snap.model ? 'Poursuivre l’entraînement' : 'Entraîner le modèle'}
            </Button>
            {running ? (
              <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={() => void stop()}>
                <Square className="h-3.5 w-3.5" /> Arrêter (sauvegarde)
              </Button>
            ) : null}
          </div>

          {job ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-medium">
                  {running ? 'Entraînement en cours' : job.status === 'done' ? 'Dernier entraînement terminé' : job.status === 'stopped' ? 'Entraînement arrêté' : job.status === 'error' ? 'Erreur d’entraînement' : 'Entraînement'}
                  {' · '}étape {job.sessionStep}/{job.sessionTotal} · perte {job.loss.toFixed(3)}
                </span>
                <span className="text-[10px] text-muted-foreground">{job.params.toLocaleString('fr-FR')} paramètres</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
              {job.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{job.error}</p> : null}
              <Sparkline points={job.lossHistory} />
              <pre className="max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/50 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {job.log.join('\n')}
              </pre>
            </div>
          ) : null}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Le modèle ne répond dans le chat que lorsqu’il est sûr de lui (perplexité faible et mots appris) ; sinon NEXUS garde son cerveau à règles.
            Plus le corpus grandit et plus l’entraînement dure, plus les réponses deviennent justes. Les conversations exclues dans l’onglet Filtres n’entrent pas dans le corpus.
          </p>
        </>
      )}
    </section>
  )
}
