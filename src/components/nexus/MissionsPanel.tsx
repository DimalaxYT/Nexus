'use client'

import { useEffect, useState } from 'react'
import {
  Bot,
  CircleCheck,
  CircleDashed,
  FileText,
  Loader2,
  Pause,
  Play,
  Plus,
  Rocket,
  StickyNote,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Markdown } from '@/components/nexus/Markdown'
import type { NexusAgent, NexusTask, TaskStatus } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

const DURATIONS = ["Aujourd'hui", 'Cette semaine', 'Ce mois-ci', 'Personnalisée…']

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  todo: { label: 'À faire', className: 'border-border bg-muted/60 text-muted-foreground' },
  running: { label: 'En cours', className: 'border-sky-500/40 bg-sky-500/10 text-sky-300' },
  done: { label: 'Terminée', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' },
  blocked: { label: 'Bloquée', className: 'border-rose-500/40 bg-rose-500/10 text-rose-300' },
}

function formatTs(ts: number): string {
  try {
    return new Date(ts).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/**
 * Panneau « Task » : l'utilisateur assigne des MISSIONS à NEXUS
 * (nom, durée, objectifs, description) puis les lance dans la conversation.
 * L'agent fait son rapport via l'outil update_task (journal d'avancement).
 */
export function MissionsPanel({
  open,
  onOpenChange,
  tasks,
  onRefresh,
  onLaunch,
  busy,
  agents,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  tasks: NexusTask[]
  onRefresh: () => void
  onLaunch: (task: NexusTask) => void
  busy: boolean
  agents: NexusAgent[]
}) {
  const [name, setName] = useState('')
  const [durationChoice, setDurationChoice] = useState(DURATIONS[1])
  const [customDuration, setCustomDuration] = useState('')
  const [objectivesText, setObjectivesText] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [launchingId, setLaunchingId] = useState<string | null>(null)
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [reportTask, setReportTask] = useState<NexusTask | null>(null)
  const enabledAgents = agents.filter((a) => a.enabled)

  // Rafraîchissement live tant que le panneau est ouvert (progression des
  // missions exécutées en arrière-plan par NEXUS)
  useEffect(() => {
    if (!open) return
    const timer = setInterval(onRefresh, 3000)
    return () => clearInterval(timer)
  }, [open, onRefresh])

  const duration = durationChoice === 'Personnalisée…' ? customDuration.trim() : durationChoice

  const createTask = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Donne un nom à la mission')
      return
    }
    setCreating(true)
    try {
      const objectives = objectivesText
        .split('\n')
        .map((o) => o.replace(/^[-*\d.\s]+/, '').trim())
        .filter(Boolean)
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          duration,
          objectives,
          description: description.trim(),
          agents: selectedAgentIds,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Création impossible')
      setName('')
      setObjectivesText('')
      setDescription('')
      setCustomDuration('')
      setSelectedAgentIds([])
      toast.success('Mission créée — l\'équipe NEXUS la démarre automatiquement en arrière-plan')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  const setStatus = async (task: NexusTask, status: TaskStatus) => {
    try {
      const res = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, status }),
      })
      if (!res.ok) throw new Error('Mise à jour impossible')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mise à jour impossible')
    }
  }

  const removeTask = async (task: NexusTask) => {
    try {
      const res = await fetch(`/api/tasks?id=${encodeURIComponent(task.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Suppression impossible')
      toast.success('Mission supprimée')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible')
    }
  }

  /** Exécution autonome en arrière-plan (sans passer par le chat). */
  const runInBackground = async (task: NexusTask) => {
    setLaunchingId(task.id)
    try {
      const res = await fetch('/api/missions/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id }),
      })
      if (!res.ok) throw new Error('Lancement impossible')
      toast.success(`Mission « ${task.name} » lancée en arrière-plan`, {
        description: 'NEXUS cherche sur Google, YouTube, TikTok et les sources IA — progression en direct ici.',
      })
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Lancement impossible')
    } finally {
      setLaunchingId(null)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl" style={{ scrollbarWidth: 'thin' }}>
        <SheetHeader className="border-b border-border/70 px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <StickyNote className="h-4 w-4 text-amber-400" />
            Missions
          </SheetTitle>
          <SheetDescription className="text-xs">
            Assignez une mission à NEXUS : nom, durée, objectifs, description. Il l'exécute
            automatiquement en arrière-plan — même quand vous n'êtes pas devant l'app.
          </SheetDescription>
        </SheetHeader>

        {/* Formulaire de création */}
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/30 p-4">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Nom de la mission
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ex : Veille concurrentielle Roblox"
              className="h-9 border-border bg-background text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Durée
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDurationChoice(d)}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs transition-colors',
                    durationChoice === d
                      ? 'border-amber-500/50 bg-amber-500/10 text-amber-300'
                      : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent'
                  )}
                >
                  {d}
                </button>
              ))}
            </div>
            {durationChoice === 'Personnalisée…' && (
              <Input
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                placeholder="ex : 2 semaines, 3 jours…"
                className="mt-2 h-9 border-border bg-background text-sm"
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Objectifs <span className="font-normal normal-case">(un par ligne)</span>
            </label>
            <Textarea
              value={objectivesText}
              onChange={(e) => setObjectivesText(e.target.value)}
              rows={3}
              placeholder={'Trouver les 3 jeux les plus rentables\nAnalyser leurs mécaniques\nRédiger une synthèse'}
              className="resize-none border-border bg-background text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Contexte, contraintes, format attendu du résultat…"
              className="resize-none border-border bg-background text-sm"
            />
          </div>
          {enabledAgents.length > 0 && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Équipe assignée <span className="font-normal normal-case">(optionnel — sinon toute l&apos;équipe)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {enabledAgents.map((agent) => {
                  const active = selectedAgentIds.includes(agent.id)
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() =>
                        setSelectedAgentIds((prev) =>
                          prev.includes(agent.id) ? prev.filter((id) => id !== agent.id) : [...prev, agent.id]
                        )
                      }
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-xs transition-colors',
                        active
                          ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                          : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent'
                      )}
                    >
                      {agent.emoji} {agent.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <Button
            className="h-9 gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
            onClick={createTask}
            disabled={creating || name.trim().length === 0}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Créer la mission
          </Button>
        </div>

        {/* Liste des missions */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          {tasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground/70">
              Aucune mission pour l&apos;instant — créez-en une ci-dessus.
            </p>
          ) : (
            tasks.map((task) => {
              const meta = STATUS_META[task.status]
              return (
                <div key={task.id} className="rounded-xl border border-border bg-muted/40 p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold', meta.className)}>
                          {meta.label}
                        </span>
                        {task.duration && (
                          <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
                            {task.duration}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/60">créée le {formatTs(task.createdAt)}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                      onClick={() => removeTask(task)}
                      aria-label={`Supprimer la mission ${task.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {task.objectives.length > 0 && (
                    <ul className="mt-2.5 flex flex-col gap-1">
                      {task.objectives.map((o, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-foreground/85">
                          <CircleDashed className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                          <span className="min-w-0 flex-1">{o}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {task.description && (
                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground">
                      {task.description}
                    </p>
                  )}

                  {task.progress.length > 0 && (
                    <div className="mt-2.5 rounded-lg border border-border/70 bg-background/60 p-2.5">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Avancement de NEXUS
                      </p>
                      <ul className="flex flex-col gap-1">
                        {task.progress.slice(-4).reverse().map((p, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-foreground/80">
                            <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-sky-400" />
                            <span className="min-w-0 flex-1">{p.note}</span>
                            <span className="shrink-0 text-[9px] text-muted-foreground/50">{formatTs(p.at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {task.report && (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 bg-emerald-500 px-2.5 text-xs text-white hover:bg-emerald-600"
                        onClick={() => setReportTask(task)}
                        title="Lire la synthèse finale rédigée par l'équipe"
                      >
                        <FileText className="h-3 w-3" />
                        Voir le rapport
                      </Button>
                    )}
                    {task.status !== 'running' && task.status !== 'done' && (
                      <Button
                        size="sm"
                        className="h-7 gap-1.5 bg-amber-500 px-2.5 text-xs text-white hover:bg-amber-600"
                        onClick={() => runInBackground(task)}
                        disabled={launchingId === task.id}
                        title="NEXUS exécute la mission en autonomie (recherche multi-sources + apprentissage + rapport)"
                      >
                        {launchingId === task.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Rocket className="h-3 w-3" />
                        )}
                        Lancer en arrière-plan
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 border-border px-2.5 text-xs hover:bg-accent"
                      onClick={() => onLaunch(task)}
                      disabled={busy}
                      title={busy ? 'Attendez la fin de la réponse en cours' : 'Annoncer la mission dans la conversation'}
                    >
                      <Play className="h-3 w-3" />
                      Annoncer dans le chat
                    </Button>
                    {task.status !== 'done' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-border px-2.5 text-xs hover:bg-accent"
                        onClick={() => setStatus(task, 'done')}
                      >
                        <CircleCheck className="h-3 w-3" />
                        Terminée
                      </Button>
                    )}
                    {task.status === 'done' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-border px-2.5 text-xs hover:bg-accent"
                        onClick={() => setStatus(task, 'todo')}
                      >
                        <Pause className="h-3 w-3" />
                        Réouvrir
                      </Button>
                    )}
                    {task.status !== 'blocked' && task.status !== 'done' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-rose-500/30 px-2.5 text-xs text-rose-300 hover:bg-rose-500/10"
                        onClick={() => setStatus(task, 'blocked')}
                      >
                        <TriangleAlert className="h-3 w-3" />
                        Bloquée
                      </Button>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>

      {/* Rapport final de la mission */}
      <Dialog open={reportTask !== null} onOpenChange={(v) => !v && setReportTask(null)}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
          <DialogHeader className="border-b border-border/70 px-5 py-3.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-emerald-400" />
              Rapport — {reportTask?.name}
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5 text-xs">
              <Bot className="h-3 w-3" />
              Synthèse rédigée par l&apos;équipe NEXUS à la fin de la mission
              {reportTask?.reportAt
                ? ` · ${new Date(reportTask.reportAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div
            className="flex-1 overflow-y-auto px-5 py-4"
            style={{ scrollbarWidth: 'thin' }}
          >
            {reportTask?.report ? (
              <Markdown content={reportTask.report} />
            ) : (
              <p className="text-sm text-muted-foreground">Rapport indisponible.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
