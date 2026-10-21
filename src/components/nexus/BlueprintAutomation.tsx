'use client'

// ─── NEXUS — Blueprints : modèles d'assistants, planifications et notifications ─
// Un schéma peut tourner seul (toutes les X minutes) : il surveille un site ou lit
// tes mails, puis te prévient. Les notifications s'affichent ici.

import { useCallback, useEffect, useState } from 'react'
import { Bell, Clock, LayoutTemplate, Loader2, Play, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BLUEPRINT_TEMPLATES } from '@/lib/blueprint-templates'
import type { BlueprintSummary } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

interface Schedule {
  id: string; blueprintId: string; blueprintName: string; everyMin: number; message: string; enabled: boolean
  lastRunAt: string | null; nextRunAt: string | null; lastStatus: string; lastReply: string
}
interface Notice { id: string; title: string; body: string; read: boolean; createdAt: string | null }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

export function BlueprintAutomation({ blueprints, onChanged }: { blueprints: BlueprintSummary[]; onChanged: () => void | Promise<void> }) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [notices, setNotices] = useState<Notice[]>([])
  const [unread, setUnread] = useState(0)
  const [target, setTarget] = useState('')
  const [every, setEvery] = useState('60')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [s, n] = await Promise.all([
      fetch('/api/blueprints/schedules', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/notifications', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ])
    if (Array.isArray(s?.schedules)) setSchedules(s.schedules)
    if (Array.isArray(n?.notifications)) setNotices(n.notifications)
    setUnread(Number(n?.unread ?? 0))
  }, [])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 60_000)
    return () => window.clearInterval(id)
  }, [load])

  const fromTemplate = async (templateId: string) => {
    const tpl = BLUEPRINT_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl) return
    setBusy(templateId)
    try {
      const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tpl.name, description: tpl.description, graph: tpl.graph }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Création impossible')
      toast.success(`Schéma « ${tpl.name} » créé — ouvre-le pour régler l’adresse ou le message.`)
      await onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setBusy(null)
    }
  }

  const post = async (body: Record<string, unknown>, okMsg?: string) => {
    const res = await fetch('/api/blueprints/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) {
      toast.error(data.error ?? 'Opération impossible')
      return false
    }
    if (okMsg) toast.success(okMsg)
    await load()
    return true
  }

  const createSchedule = async () => {
    if (!target) return toast.error('Choisis un schéma à planifier.')
    setBusy('create')
    await post({ action: 'create', blueprintId: target, everyMin: Number(every), message }, 'Planification créée : premier passage dans une minute.')
    setBusy(null)
    setMessage('')
  }

  const readAll = async () => {
    await fetch('/api/notifications', { method: 'POST' })
    await load()
  }

  return (
    <div className="space-y-6">
      <Card className="border-border/70 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LayoutTemplate className="h-4 w-4 text-foreground/80" /> Assistants prêts à l’emploi
          </CardTitle>
          <CardDescription className="text-xs">
            Crée un schéma à partir d’un modèle, puis planifie-le : il agit sans toi et te prévient.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {BLUEPRINT_TEMPLATES.map((t) => (
            <div key={t.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 p-4">
              <div>
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
              </div>
              <Button size="sm" variant="outline" className="w-fit gap-1.5" disabled={!!busy} onClick={() => void fromTemplate(t.id)}>
                {busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LayoutTemplate className="h-3.5 w-3.5" />} Créer ce schéma
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-foreground/80" /> Planifications
          </CardTitle>
          <CardDescription className="text-xs">
            Un schéma planifié s’exécute automatiquement, même quand tu n’es pas connecté (le Gardien passe chaque minute).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Schéma</span>
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-9 w-56 rounded-md border border-input bg-background px-2 text-xs">
                <option value="">Choisir…</option>
                {blueprints.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Toutes les (min)</span>
              <Input value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ''))} className="h-9 w-24 text-xs" />
            </label>
            <label className="min-w-[180px] flex-1 space-y-1 text-xs">
              <span className="text-muted-foreground">Message d’exécution (optionnel)</span>
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Point du matin" className="h-9 text-xs" />
            </label>
            <Button size="sm" className="h-9 gap-1.5" disabled={busy === 'create'} onClick={() => void createSchedule()}>
              <Clock className="h-3.5 w-3.5" /> Planifier
            </Button>
          </div>

          {schedules.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune planification pour l’instant.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {schedules.map((s) => (
                <li key={s.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{s.blueprintName || 'Schéma supprimé'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        toutes les {s.everyMin} min · dernier passage {when(s.lastRunAt)} · prochain {when(s.nextRunAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={cn('text-[10px]', s.lastStatus && s.lastStatus !== 'ok' && 'border-rose-400/40 text-rose-600 dark:text-rose-300')}>
                        {s.lastStatus || 'pas encore exécuté'}
                      </Badge>
                      <Switch checked={s.enabled} onCheckedChange={(v) => void post({ action: 'update', id: s.id, enabled: v })} />
                      <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => void post({ action: 'run', id: s.id }, 'Exécution lancée')}>
                        <Play className="h-3 w-3" /> Lancer
                      </Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600 dark:text-rose-300" onClick={() => void post({ action: 'delete', id: s.id }, 'Planification supprimée')}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {s.lastReply ? <p className="line-clamp-3 rounded-lg bg-muted/30 p-2 text-[11px] text-muted-foreground">{s.lastReply}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-card/60">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between gap-2 text-base">
            <span className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-foreground/80" /> Notifications {unread > 0 ? <Badge className="text-[10px]">{unread} nouvelle(s)</Badge> : null}
            </span>
            {unread > 0 ? (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => void readAll()}>Tout marquer lu</Button>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {notices.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune notification. Les assistants t’écrivent ici quand il y a du neuf.</p>
          ) : (
            <ul className="space-y-2">
              {notices.map((n) => (
                <li key={n.id} className={cn('rounded-lg border border-border/60 p-3', !n.read && 'bg-primary/5')}>
                  <p className="text-xs font-semibold">{n.title}</p>
                  <p className="mt-1 whitespace-pre-line text-[11px] text-muted-foreground">{n.body}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/70">{when(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
