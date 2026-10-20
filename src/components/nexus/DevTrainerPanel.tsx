'use client'

// ─── NEXUS — Entraînement autonome ───────────────────────────────────────────
// Le tableau de bord de l'agent Dev qui apprend 24 h/24 : état du daemon,
// journal des cycles, couverture mesurée de NEXUS, curriculum, entrées
// produites, navigateur de l'agent, et les leçons qu'il tire de ses essais.

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  BookOpen,
  Brain,
  Clock,
  Cpu,
  Globe,
  GraduationCap,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { TrainerConfig } from '@/lib/devtrainer'

interface CycleStep { at: number; label: string; detail: string; status: 'ok' | 'warn' | 'error' }

interface Snapshot {
  config: TrainerConfig
  score: { covered: number; total: number; score: number; misses: string[] }
  counts: {
    objectives: number; objectivesDone: number; items: number; itemsValid: number
    itemsCandidate: number; runs: number; pages: number; domains: number; lessons: number
  }
  runs: {
    id: string; objective: string; status: string; mode: string; pages: number; items: number
    scoreBefore: number; scoreAfter: number; offline: boolean; error: string
    startedAt: unknown; endedAt: unknown; steps: CycleStep[]
  }[]
  objectives: { id: string; label: string; query: string; category: string; status: string; attempts: number; lastScore: number; origin: string }[]
  items: { id: string; question: string; answer: string; score: number; status: string; sources: string[]; offline: boolean; createdAt: unknown }[]
  lessons: { kind: string; key: string; value: number; samples: number }[]
  daemon: {
    alive: boolean; enabled: boolean; running: boolean; lastRunAt: number | null
    nextRunAt: number | null; cyclesToday: number; consecutiveErrors: number
    lastError: string; minutesToNext: number | null
    lastReport: { objective: string; mode: string; pages: number; items: number; scoreBefore: number; scoreAfter: number; at: number } | null
  }
}

interface PageRow { id: string; url: string; title: string; domain: string; bytes: number; hits: number; fetchedAt: unknown }

function Card({ title, icon: Icon, children, action }: {
  title: string
  icon: typeof Cpu
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card/60 p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-bold',
        tone === 'ok' && 'text-neutral-300',
        tone === 'warn' && 'text-amber-300',
        tone === 'bad' && 'text-rose-300',
        !tone && 'text-foreground'
      )}>{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function when(v: unknown): string {
  if (!v) return '—'
  const t = new Date(v as string | number | Date).getTime()
  if (!Number.isFinite(t)) return '—'
  return new Date(t).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

const STEP_TONE: Record<string, string> = {
  ok: 'border-neutral-500/30 bg-neutral-500/5 text-neutral-200',
  warn: 'border-neutral-300/30 bg-neutral-300/5 text-amber-200',
  error: 'border-rose-500/30 bg-rose-500/5 text-rose-200',
}

export function DevTrainerPanel() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [pages, setPages] = useState<PageRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [newObjective, setNewObjective] = useState('')

  const json = useCallback(async <T,>(input: string, init?: RequestInit): Promise<T | null> => {
    try {
      const res = await fetch(input, { cache: 'no-store', ...init })
      const d = (await res.json().catch(() => null)) as (T & { error?: string }) | null
      if (!res.ok) {
        toast.error(d?.error ?? `Erreur ${res.status}`)
        return null
      }
      return d
    } catch {
      toast.error('Réseau indisponible')
      return null
    }
  }, [])

  const load = useCallback(async () => {
    const [snap, lib] = await Promise.all([
      json<Snapshot>('/api/dev/training'),
      json<{ pages: PageRow[] }>('/api/dev/browser'),
    ])
    if (snap) setData(snap)
    if (lib) setPages(lib.pages)
  }, [json])

  useEffect(() => {
    let alive = true
    const tick = () => {
      void load().then(() => {
        if (!alive) return
      })
    }
    tick()
    const id = setInterval(tick, 12_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [load])

  const act = async (body: Record<string, unknown>, label: string) => {
    setBusy(label)
    const res = await json<{ ok: boolean }>('/api/dev/training', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(null)
    if (res) {
      if (label === 'run') toast.success('Cycle terminé — voir le journal')
      await load()
    }
  }

  const browse = async () => {
    if (!url.trim()) return
    setBusy('browse')
    const res = await json<{ ok: boolean; cached: boolean; page: PageRow }>('/api/dev/browser', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    setBusy(null)
    if (res) {
      toast.success(res.cached ? 'Page déjà en bibliothèque' : 'Page lue et rangée')
      setUrl('')
      await load()
    }
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement de l’entraînement…
      </div>
    )
  }

  const { daemon, score, counts, config } = data
  const pct = Math.round(score.score * 100)
  const lastRun = data.runs[0]

  return (
    <div className="space-y-4 p-4">
      {/* État du daemon */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Daemon"
          value={daemon.enabled ? (daemon.running ? 'en cycle' : 'actif') : 'en pause'}
          hint={daemon.alive ? `monté · ${daemon.cyclesToday} cycle(s) aujourd’hui` : 'non monté'}
          tone={daemon.enabled ? (daemon.running ? 'ok' : 'ok') : 'warn'}
        />
        <Stat
          label="Prochain cycle"
          value={daemon.enabled ? (daemon.minutesToNext === null ? 'dès que possible' : `${daemon.minutesToNext} min`) : '—'}
          hint={`cadence ${config.intervalMin} min`}
        />
        <Stat label="Couverture NEXUS" value={`${pct} %`} hint={`${score.covered}/${score.total} du banc d’épreuve`} tone={pct >= 60 ? 'ok' : 'warn'} />
        <Stat label="Savoirs appris" value={counts.itemsValid} hint={`${counts.itemsCandidate} en attente`} tone="ok" />
        <Stat label="Pages lues" value={counts.pages} hint={`${counts.domains} domaine(s)`} />
        <Stat label="Leçons tirées" value={counts.lessons} hint="mémoire de l’entraîneur" />
      </div>

      {daemon.lastError ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Dernier incident :</strong> {daemon.lastError}
            {daemon.consecutiveErrors > 1 ? ` (${daemon.consecutiveErrors} consécutifs — prochain essai différé)` : ''}
          </p>
        </div>
      ) : null}

      {/* Contrôles */}
      <Card
        title="Pilotage"
        icon={Activity}
        action={
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} aria-label="Rafraîchir">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-foreground">
            <Switch
              checked={config.enabled}
              onCheckedChange={(on) => void act({ action: 'config', config: { enabled: on } }, 'enabled')}
              aria-label="Entraînement actif"
            />
            Entraînement 24 h/24
          </label>
          <Button
            size="sm"
            className="bg-neutral-500 hover:bg-neutral-500"
            onClick={() => void act({ action: 'run' }, 'run')}
            disabled={busy === 'run' || daemon.running}
          >
            {busy === 'run' || daemon.running ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
            Forcer un cycle
          </Button>
          {config.enabled ? null : (
            <Button size="sm" variant="outline" onClick={() => void act({ action: 'config', config: { enabled: true } }, 'enabled')}>
              <Play className="mr-1.5 h-3 w-3" /> Reprendre
            </Button>
          )}
          {config.enabled ? (
            <Button size="sm" variant="outline" onClick={() => void act({ action: 'config', config: { enabled: false } }, 'enabled')}>
              <Pause className="mr-1.5 h-3 w-3" /> Mettre en pause
            </Button>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Cadence (minutes entre deux cycles)</span>
            <Input
              type="number"
              min={5}
              max={720}
              defaultValue={config.intervalMin}
              key={`iv-${config.intervalMin}`}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v > 0 && v !== config.intervalMin) void act({ action: 'config', config: { intervalMin: v } }, 'cfg')
              }}
              className="text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Pages lues par cycle</span>
            <Input
              type="number"
              min={1}
              max={8}
              defaultValue={config.pagesPerCycle}
              key={`pp-${config.pagesPerCycle}`}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v > 0 && v !== config.pagesPerCycle) void act({ action: 'config', config: { pagesPerCycle: v } }, 'cfg')
              }}
              className="text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Seuil de qualité (0–1)</span>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={config.minScore}
              key={`ms-${config.minScore}`}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v >= 0 && v !== config.minScore) void act({ action: 'config', config: { minScore: v } }, 'cfg')
              }}
              className="text-xs"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] text-muted-foreground">Cycles max / 24 h</span>
            <Input
              type="number"
              min={1}
              max={200}
              defaultValue={config.maxCyclesPerDay}
              key={`mc-${config.maxCyclesPerDay}`}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v > 0 && v !== config.maxCyclesPerDay) void act({ action: 'config', config: { maxCyclesPerDay: v } }, 'cfg')
              }}
              className="text-xs"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border/50 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Autonomie</span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={config.autonomy === 'valide' ? 'default' : 'outline'}
              onClick={() => void act({ action: 'config', config: { autonomy: 'valide' } }, 'cfg')}
            >
              Correctifs à valider
            </Button>
            <Button
              size="sm"
              variant={config.autonomy === 'auto' ? 'default' : 'outline'}
              onClick={() => void act({ action: 'config', config: { autonomy: 'auto' } }, 'cfg')}
            >
              Il applique lui-même
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {config.autonomy === 'auto'
              ? 'L’agent écrit directement dans la banque de connaissances (sauvegarde automatique avant chaque écriture).'
              : 'Chaque savoir récolté est déposé dans l’onglet Correctifs, en attente de votre accord.'}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-border/50 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Modèle de langue</span>
          <Switch
            checked={config.llmTraining}
            onCheckedChange={(v) => void act({ action: 'config', config: { llmTraining: v } }, 'cfg')}
            aria-label="Ré-entraîner le modèle de langue pendant les cycles"
          />
          <div className="min-w-[16rem] flex-1">
            <p className="text-xs font-medium">
              {config.llmTraining
                ? 'Les cycles ré-entraînent aussi le transformeur maison.'
                : 'Les cycles enrichissent le savoir sans toucher au modèle.'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              Désactivé par défaut : l&apos;entraînement tourne dans le process du serveur et un pas
              coûte plusieurs secondes de calcul. Même en partageant la boucle d&apos;événements, une
              réponse passe d&apos;environ 0,4 s à quelques secondes pendant toute la durée du run
              (400 pas ≈ 30 min, 1500 pas ≈ 1 h). À activer de préférence en heures creuses — ou,
              pour un entraînement à pleine vitesse sans aucun impact sur le chat :{' '}
              <code className="font-mono text-[10px]">node --import tsx scripts/train-chat.ts</code>.
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border/50 pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Heures creuses</span>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={config.quietFrom}
            key={`qf-${config.quietFrom}`}
            onBlur={(e) => void act({ action: 'config', config: { quietFrom: Number(e.target.value) } }, 'cfg')}
            className="w-20 text-xs"
            aria-label="Début des heures creuses"
          />
          <span className="text-xs text-muted-foreground">h →</span>
          <Input
            type="number"
            min={0}
            max={23}
            defaultValue={config.quietTo}
            key={`qt-${config.quietTo}`}
            onBlur={(e) => void act({ action: 'config', config: { quietTo: Number(e.target.value) } }, 'cfg')}
            className="w-20 text-xs"
            aria-label="Fin des heures creuses"
          />
          <span className="text-xs text-muted-foreground">h (aucun cycle dans cette plage)</span>
        </div>
      </Card>

      {/* Onglets */}
      <Tabs defaultValue="journal" className="w-full">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-1">
          {[
            { v: 'journal', l: 'Journal', i: Activity },
            { v: 'objectifs', l: 'Curriculum', i: Target },
            { v: 'entrees', l: 'Savoirs', i: BookOpen },
            { v: 'navigateur', l: 'Navigateur', i: Globe },
            { v: 'lecons', l: 'Leçons', i: TrendingUp },
          ].map((t) => {
            const Icon = t.i
            return (
              <TabsTrigger key={t.v} value={t.v} className="gap-1.5 px-3 py-1.5 text-xs data-[state=active]:bg-neutral-500/15 data-[state=active]:text-neutral-300">
                <Icon className="h-3.5 w-3.5" />
                {t.l}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {/* Journal */}
        <TabsContent value="journal" className="mt-3 space-y-3">
          {daemon.lastReport ? (
            <Card title="Dernier cycle" icon={Sparkles}>
              <p className="text-sm font-semibold text-foreground">{daemon.lastReport.objective}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {when(daemon.lastReport.at)} · {daemon.lastReport.mode === 'local' ? 'corpus local' : daemon.lastReport.mode} ·{' '}
                {daemon.lastReport.pages} page(s) · {daemon.lastReport.items} savoir(s) · couverture{' '}
                {Math.round(daemon.lastReport.scoreBefore * 100)} % → {Math.round(daemon.lastReport.scoreAfter * 100)} %
              </p>
            </Card>
          ) : null}

          {lastRun ? (
            <Card title={`Déroulé — ${lastRun.objective || 'cycle'}`} icon={Clock}>
              <ol className="space-y-1.5">
                {lastRun.steps.map((s, i) => (
                  <li key={i} className={cn('rounded-lg border px-3 py-2 text-[11px]', STEP_TONE[s.status] ?? STEP_TONE.ok)}>
                    <span className="font-semibold">{s.label}</span>
                    <span className="mx-2 text-muted-foreground">{new Date(s.at).toLocaleTimeString('fr-FR')}</span>
                    <p className="mt-0.5 text-foreground/80">{s.detail}</p>
                  </li>
                ))}
                {!lastRun.steps.length ? <li className="text-[11px] text-muted-foreground">Aucune étape enregistrée.</li> : null}
              </ol>
            </Card>
          ) : null}

          <Card title="Historique des cycles" icon={Activity}>
            <div className="space-y-1">
              {data.runs.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-foreground">{r.objective || '(sans objectif)'}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {when(r.startedAt)} · {r.pages} p. · {r.items} s.
                      {r.offline ? ' · hors-ligne' : ''}
                      {r.error ? ` · ${r.error}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline" className={cn('shrink-0 text-[9px]',
                    r.status === 'ok' && 'border-neutral-500/40 text-neutral-300',
                    r.status === 'echec' && 'border-rose-500/40 text-rose-300'
                  )}>
                    {r.status}
                  </Badge>
                </div>
              ))}
              {!data.runs.length ? <p className="text-xs text-muted-foreground">Aucun cycle pour l’instant — cliquez sur « Forcer un cycle ».</p> : null}
            </div>
          </Card>

          <Card title="Lacunes mesurées" icon={Brain}>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Ce sont les questions du banc d’épreuve que NEXUS ne sait pas encore traiter. Elles alimentent
              automatiquement le curriculum.
            </p>
            {score.misses.length ? (
              <ul className="space-y-1">
                {score.misses.slice(0, 10).map((m, i) => (
                  <li key={i} className="rounded bg-muted/40 px-2 py-1 text-[11px] text-foreground/80">« {m} »</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-neutral-300">Aucune lacune : NEXUS couvre tout le banc d’épreuve.</p>
            )}
          </Card>
        </TabsContent>

        {/* Curriculum */}
        <TabsContent value="objectifs" className="mt-3 space-y-3">
          <Card title="Ajouter un objectif" icon={Target}>
            <div className="flex gap-2">
              <Input
                value={newObjective}
                onChange={(e) => setNewObjective(e.target.value)}
                placeholder="Ex. le fonctionnement d’un moteur de rendu 3D"
                className="text-xs"
              />
              <Button
                size="sm"
                className="shrink-0 bg-neutral-500 hover:bg-neutral-500"
                disabled={!newObjective.trim() || busy === 'obj'}
                onClick={async () => {
                  const label = newObjective.trim()
                  setBusy('obj')
                  const res = await json<{ ok: boolean }>('/api/dev/training', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'objective', label, query: label }),
                  })
                  setBusy(null)
                  if (res) {
                    setNewObjective('')
                    toast.success('Objectif ajouté en priorité haute')
                    await load()
                  }
                }}
              >
                Ajouter
              </Button>
            </div>
          </Card>

          <Card title={`File d’apprentissage (${counts.objectivesDone}/${counts.objectives} traités)`} icon={GraduationCap}>
            <div className="space-y-1">
              {data.objectives.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-foreground">{o.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{o.query}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {o.lastScore ? <span className="text-[10px] text-neutral-300">{o.lastScore.toFixed(2)}</span> : null}
                    <Badge variant="outline" className="text-[9px]">{o.category}</Badge>
                    <Badge variant="outline" className={cn('text-[9px]',
                      o.status === 'fait' && 'border-neutral-500/40 text-neutral-300',
                      o.origin === 'manuel' && 'border-neutral-500/40 text-neutral-300'
                    )}>
                      {o.status === 'fait' ? 'traité' : `${o.attempts} essai(s)`}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[10px]"
                      disabled={busy === o.id || daemon.running}
                      onClick={() => void act({ action: 'run', objectiveId: o.id }, o.id)}
                    >
                      Entraîner
                    </Button>
                  </div>
                </div>
              ))}
              {!data.objectives.length ? <p className="text-xs text-muted-foreground">Curriculum vide.</p> : null}
            </div>
          </Card>
        </TabsContent>

        {/* Savoirs produits */}
        <TabsContent value="entrees" className="mt-3 space-y-3">
          <Card
            title={`Savoirs récoltés (${counts.itemsValid} actifs)`}
            icon={BookOpen}
            action={
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px]"
                onClick={async () => {
                  const res = await json<{ ok: boolean; removed: number }>('/api/dev/training/items?purge=1', { method: 'DELETE' })
                  if (res) {
                    toast.success(`${res.removed ?? 0} entrée(s) rejetée(s) purgée(s)`)
                    await load()
                  }
                }}
              >
                <Trash2 className="mr-1 h-3 w-3" /> Purger les refusées
              </Button>
            }
          >
            <div className="space-y-2">
              {data.items.map((it) => (
                <article key={it.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground">{it.question}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge variant="outline" className={cn('text-[9px]',
                        it.status === 'valide' && 'border-neutral-500/40 text-neutral-300',
                        it.status === 'rejete' && 'border-rose-500/40 text-rose-300',
                        it.status === 'candidat' && 'border-neutral-300/40 text-amber-300'
                      )}>{it.status}</Badge>
                      <span className="text-[10px] text-neutral-300">{it.score.toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11px] text-muted-foreground">{it.answer}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {it.sources.slice(0, 2).map((s, i) => (
                      <span key={i} className="max-w-[220px] truncate font-mono text-[9px] text-muted-foreground">{s}</span>
                    ))}
                    {it.offline ? <Badge variant="outline" className="text-[9px]">hors-ligne</Badge> : null}
                    <span className="text-[9px] text-muted-foreground">{when(it.createdAt)}</span>
                    <div className="ml-auto flex gap-1">
                      {it.status !== 'valide' ? (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-neutral-300"
                          onClick={async () => {
                            await json('/api/dev/training/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, status: 'valide' }) })
                            await load()
                          }}>Valider</Button>
                      ) : null}
                      {it.status !== 'rejete' ? (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-rose-300"
                          onClick={async () => {
                            await json('/api/dev/training/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, status: 'rejete' }) })
                            await load()
                          }}>Refuser</Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
              {!data.items.length ? <p className="text-xs text-muted-foreground">Aucun savoir produit pour l’instant.</p> : null}
            </div>
          </Card>
        </TabsContent>

        {/* Navigateur */}
        <TabsContent value="navigateur" className="mt-3 space-y-3">
          <Card title="Navigateur de l’agent Dev" icon={Globe}>
            <p className="mb-2 text-[11px] text-muted-foreground">
              Un navigateur rien qu’à lui : il visite, extrait le texte lisible et range la page. Vous pouvez aussi
              lui donner une URL à la main.
            </p>
            <div className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void browse() }}
                placeholder="https://…"
                className="text-xs"
              />
              <Button size="sm" className="shrink-0 bg-neutral-500 hover:bg-neutral-500" onClick={() => void browse()} disabled={busy === 'browse' || !url.trim()}>
                {busy === 'browse' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Globe className="mr-1.5 h-3 w-3" />}
                Visiter
              </Button>
            </div>
          </Card>

          <Card title={`Bibliothèque (${counts.pages} pages)`} icon={BookOpen}
            action={
              <Button variant="ghost" size="sm" className="text-[10px] text-rose-300"
                onClick={async () => {
                  const res = await json<{ ok: boolean }>('/api/dev/browser?all=1', { method: 'DELETE' })
                  if (res) { toast.success('Bibliothèque vidée'); await load() }
                }}
              >
                <RotateCcw className="mr-1 h-3 w-3" /> Vider
              </Button>
            }
          >
            <div className="space-y-1">
              {pages.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-1.5">
                  <div className="min-w-0">
                    <p className="truncate text-[11px] text-foreground">{p.title}</p>
                    <p className="truncate font-mono text-[10px] text-muted-foreground">{p.url}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[9px]">{p.domain}</Badge>
                    <span className="text-[10px] text-muted-foreground">{Math.round(p.bytes / 1024)} Ko</span>
                    <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-rose-300"
                      onClick={async () => { await json(`/api/dev/browser?id=${p.id}`, { method: 'DELETE' }); await load() }}
                      aria-label="Supprimer">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
              {!pages.length ? <p className="text-xs text-muted-foreground">Bibliothèque vide.</p> : null}
            </div>
          </Card>
        </TabsContent>

        {/* Leçons */}
        <TabsContent value="lecons" className="mt-3 space-y-3">
          <Card title="Ce que l’entraîneur a appris sur lui-même" icon={TrendingUp}>
            <p className="mb-3 text-[11px] text-muted-foreground">
              À chaque cycle, il note ce qui a marché (domaine, catégorie, moteur web ou local). Ces notes
              orientent ses choix suivants : c’est ainsi qu’il s’améliore indirectement, cycle après cycle.
            </p>
            <div className="space-y-1">
              {data.lessons.map((l, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-1.5">
                  <Badge variant="outline" className="w-24 shrink-0 justify-center text-[9px]">{l.kind}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{l.key}</span>
                  <div className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-muted/50">
                    <div
                      className={cn('h-full rounded-full', l.value >= 0.6 ? 'bg-neutral-500' : l.value >= 0.35 ? 'bg-neutral-300' : 'bg-rose-500')}
                      style={{ width: `${Math.max(3, Math.round(l.value * 100))}%` }}
                    />
                  </div>
                  <span className="w-12 shrink-0 text-right text-[10px] text-muted-foreground">
                    {l.value.toFixed(2)} · {l.samples}
                  </span>
                </div>
              ))}
              {!data.lessons.length ? <p className="text-xs text-muted-foreground">Aucune leçon encore — lancez un cycle.</p> : null}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
