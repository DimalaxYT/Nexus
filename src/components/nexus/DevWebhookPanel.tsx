'use client'

// ─── NEXUS — Espace Dev : Webhooks & confirmations ──────────────────────────
// Un seul endroit pour brancher NEXUS sur Discord, Slack ou n'importe quelle
// URL : on choisit les événements (entraînement, savoir compris, correctif…),
// on teste, et on retrouve ici les confirmations en attente avec les mêmes
// boutons Accepter / Refuser que dans le webhook.

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Webhook,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Hook {
  id: string
  name: string
  url: string
  format: 'auto' | 'discord' | 'slack' | 'generic'
  events: string[]
  enabled: boolean
  baseUrl: string
  secretSet: boolean
  lastStatus: string
  lastError: string
  lastDeliveryAt: string | null
  createdAt: string | null
}

interface Log {
  id: string
  event: string
  ok: boolean
  status: number
  ms: number
  error: string
  preview: string
  createdAt: string | null
}

interface Approval {
  id: string
  kind: string
  refId: string
  title: string
  summary: string
  status: string
  token: string
  decidedBy: string
  decidedAt: string | null
  createdAt: string | null
  acceptUrl: string
  refuseUrl: string
}

interface EventMeta {
  id: string
  label: string
  description: string
  group: string
}

interface Snapshot {
  webhooks: Hook[]
  logs: Log[]
  approvals: Approval[]
  decided: Approval[]
  events: EventMeta[]
  suggestedBaseUrl: string
}

const FORMATS: { id: Hook['format']; label: string }[] = [
  { id: 'auto', label: 'Détection automatique' },
  { id: 'discord', label: 'Discord' },
  { id: 'slack', label: 'Slack' },
  { id: 'generic', label: 'JSON générique' },
]

const KIND_LABEL: Record<string, string> = {
  patch: 'Correctif de code',
  item: 'Savoir à valider',
  task: 'Amélioration',
}

function when(iso: string | null): string {
  if (!iso) return 'jamais'
  return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function Card({ title, icon: Icon, children, action }: {
  title: string
  icon: typeof Webhook
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

async function call<T>(url: string, body?: unknown): Promise<T & { error?: string }> {
  const res = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok && !data.error) data.error = `Erreur ${res.status}`
  return data
}

export function DevWebhookPanel() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string>('')
  const [name, setName] = useState('Mon webhook')
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState<Hook['format']>('auto')
  const [baseUrl, setBaseUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [clearSecret, setClearSecret] = useState(false)
  const [events, setEvents] = useState<string[]>(['*'])
  const [enabled, setEnabled] = useState(true)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const res = await call<Snapshot>('/api/dev/webhooks')
    if (res.error) {
      if (!silent) toast.error(res.error)
    } else {
      setData(res)
      setBaseUrl((prev) => prev || res.suggestedBaseUrl || '')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    // Chargement initial + rafraîchissement : les confirmations peuvent arriver
    // pendant qu'on regarde l'écran.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const current = useMemo(() => data?.webhooks.find((w) => w.id === editingId) ?? null, [data, editingId])

  const select = useCallback((hook: Hook) => {
    setEditingId(hook.id)
    setName(hook.name)
    setUrl(hook.url)
    setFormat(hook.format)
    setBaseUrl(hook.baseUrl || data?.suggestedBaseUrl || '')
    setEvents(hook.events.length ? hook.events : ['*'])
    setEnabled(hook.enabled)
    setSecret('')
    setClearSecret(false)
  }, [data])

  const reset = useCallback(() => {
    setEditingId('')
    setName('Mon webhook')
    setUrl('')
    setFormat('auto')
    setBaseUrl(data?.suggestedBaseUrl || '')
    setEvents(['*'])
    setEnabled(true)
    setSecret('')
    setClearSecret(false)
  }, [data])

  const save = async () => {
    if (!url.trim()) {
      toast.error('Colle l’URL du webhook (Discord, Slack ou autre).')
      return
    }
    setBusy('save')
    const res = await call<{ ok?: boolean; webhook?: Hook }>('/api/dev/webhooks', {
      action: 'save',
      webhook: {
        id: editingId || undefined,
        name,
        url,
        format,
        baseUrl,
        events,
        enabled,
        ...(secret.trim() ? { secret } : {}),
        ...(clearSecret ? { clearSecret: true } : {}),
      },
    })
    setBusy(null)
    if (res.error) {
      toast.error(res.error)
      return
    }
    toast.success(editingId ? 'Webhook mis à jour' : 'Webhook enregistré')
    if (res.webhook?.id) {
      setEditingId(res.webhook.id)
      setSecret('')
      setClearSecret(false)
    }
    await load()
  }

  const test = async (id: string) => {
    setBusy(`test:${id}`)
    const res = await call<{ ok?: boolean; result?: { ok: boolean; status: number; ms: number; error: string } }>('/api/dev/webhooks', { action: 'test', id })
    setBusy(null)
    if (res.error) toast.error(res.error)
    else if (res.result?.ok) toast.success(`Test envoyé (HTTP ${res.result.status} · ${res.result.ms} ms)`)
    else toast.error(`Test en échec : ${res.result?.error ?? 'inconnu'}`)
    await load()
  }

  const toggle = async (hook: Hook, next: boolean) => {
    setBusy(`toggle:${hook.id}`)
    const res = await call<{ ok?: boolean }>('/api/dev/webhooks', { action: 'toggle', id: hook.id, enabled: next })
    setBusy(null)
    if (res.error) toast.error(res.error)
    await load()
  }

  const remove = async (hook: Hook) => {
    if (!window.confirm(`Supprimer le webhook « ${hook.name} » ? Les confirmations déjà envoyées restent valides.`)) return
    setBusy(`delete:${hook.id}`)
    const res = await call<{ ok?: boolean }>('/api/dev/webhooks', { action: 'delete', id: hook.id })
    setBusy(null)
    if (res.error) toast.error(res.error)
    else {
      toast.success('Webhook supprimé')
      if (editingId === hook.id) reset()
    }
    await load()
  }

  const decide = async (approval: Approval, decision: 'accept' | 'refuse') => {
    setBusy(`${decision}:${approval.id}`)
    const res = await call<{ ok?: boolean; message?: string }>('/api/dev/approvals', { id: approval.id, decision })
    setBusy(null)
    if (res.error) toast.error(res.error)
    else {
      toast.success(res.message ?? 'Décision enregistrée')
      await load(true)
    }
  }

  // Les liens stockés côté serveur utilisent l'URL publique configurée ; pour
  // les actions depuis CE navigateur, on privilégie son origine réelle (aperçu,
  // IP locale, nom de domaine) et le jeton de la confirmation.
  const actionUrl = (approval: Approval, decision: 'accept' | 'refuse') => {
    if (typeof window === 'undefined') return decision === 'accept' ? approval.acceptUrl : approval.refuseUrl
    return `${window.location.origin}/api/dev/approvals/action?token=${encodeURIComponent(approval.token)}&decision=${decision}`
  }

  const copy = async (value: string, label = 'Lien copié') => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(label)
    } catch {
      toast.error('Copie impossible')
    }
  }

  const toggleEvent = (id: string) => {
    setEvents((prev) => {
      if (id === '*') return ['*']
      const withoutAll = prev.filter((e) => e !== '*')
      const next = withoutAll.includes(id) ? withoutAll.filter((e) => e !== id) : [...withoutAll, id]
      return next.length ? next : ['*']
    })
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Chargement des webhooks…
      </div>
    )
  }

  const hooks = data?.webhooks ?? []
  const groups = [...new Set((data?.events ?? []).map((e) => e.group))]

  return (
    <div className="space-y-4 p-4">
      {/* Bandeau explicatif */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Webhook className="h-4 w-4" /> Tenir l’opérateur au courant
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
              NEXUS envoie un message à chaque étape : <strong>entraînement démarré / terminé</strong>,{' '}
              <strong>ce que l’IA a compris</strong> (question, réponse, score, sources), <strong>correctif proposé</strong> ou{' '}
              <strong>incident</strong>. Les demandes de confirmation arrivent avec deux boutons{' '}
              <span className="font-medium text-foreground">✅ Accepter</span> et{' '}
              <span className="font-medium text-foreground">❌ Refuser</span> qui agissent directement — sans ouvrir le site.
            </p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Actualiser
          </Button>
        </div>
        <p className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Discord :</strong> Paramètres du salon → Intégrations → Webhooks → Nouveau webhook →
          Copier l’URL. <strong className="text-foreground">Slack :</strong> Incoming Webhooks. Tout autre service qui accepte un POST
          JSON fonctionne aussi (<code className="font-mono">/api/dev/webhooks</code>). Le secret optionnel signe chaque envoi
          (<code className="font-mono">X-Nexus-Signature</code>).
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Configuration */}
        <Card
          title={editingId ? 'Modifier le webhook' : 'Ajouter un webhook'}
          icon={Send}
          action={
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={reset}>
                <Plus className="h-3 w-3" /> Nouveau
              </Button>
              {current ? (
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-rose-600 dark:text-rose-300" onClick={() => void remove(current)}>
                  <Trash2 className="h-3 w-3" /> Supprimer
                </Button>
              ) : null}
            </div>
          }
        >
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Nom</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Discord NEXUS" className="h-9 text-xs" />
              </label>
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Format d’envoi</span>
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as Hook['format'])}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                >
                  {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </label>
            </div>

            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">URL du webhook</span>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://discord.com/api/webhooks/…"
                className="h-9 font-mono text-xs"
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">
                URL publique de NEXUS <span className="text-muted-foreground/70">(utilisée dans les boutons Accepter / Refuser)</span>
              </span>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={data?.suggestedBaseUrl || 'https://mon-nexus.onrender.com'}
                className="h-9 font-mono text-xs"
                autoComplete="off"
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="font-medium text-muted-foreground">
                  Secret HMAC {current?.secretSet ? <Badge variant="outline" className="ml-1 text-[9px]">déjà défini</Badge> : '(optionnel)'}
                </span>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => { setSecret(e.target.value); setClearSecret(false) }}
                  placeholder={current?.secretSet ? 'Laisser vide pour conserver' : 'signe les requêtes'}
                  className="h-9 font-mono text-xs"
                  autoComplete="off"
                />
              </label>
              <div className="flex items-end gap-3 pb-1">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch checked={enabled} onCheckedChange={setEnabled} /> Actif
                </label>
                {current?.secretSet ? (
                  <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} /> effacer le secret
                  </label>
                ) : null}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Événements envoyés</p>
                <button
                  type="button"
                  onClick={() => setEvents(['*'])}
                  className={cn('text-[11px]', events.includes('*') ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  Tout recevoir
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleEvent('*')}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    events.includes('*')
                      ? 'border-foreground/40 bg-muted/60 text-foreground'
                      : 'border-border/70 bg-muted/20 text-muted-foreground hover:text-foreground'
                  )}
                >
                  Tous les événements
                </button>
              </div>
              {groups.map((group) => (
                <div key={group} className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{group}</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {(data?.events ?? []).filter((e) => e.group === group).map((evt) => {
                      const active = events.includes('*') || events.includes(evt.id)
                      return (
                        <button
                          key={evt.id}
                          type="button"
                          title={evt.description}
                          onClick={() => toggleEvent(evt.id)}
                          className={cn(
                            'flex items-start gap-2 rounded-lg border p-2 text-left text-[11px] transition-colors',
                            active
                              ? 'border-foreground/30 bg-muted/50 text-foreground'
                              : 'border-border/60 bg-muted/10 text-muted-foreground hover:bg-muted/30'
                          )}
                        >
                          <span className={cn(
                            'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                            active ? 'border-foreground/50 bg-primary text-primary-foreground' : 'border-border'
                          )}>
                            {active ? <Check className="h-2.5 w-2.5" /> : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-medium">{evt.label}</span>
                            <span className="block text-[10px] leading-snug text-muted-foreground">{evt.description}</span>
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => void save()}>
                {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {editingId ? 'Enregistrer les modifications' : 'Ajouter le webhook'}
              </Button>
              {editingId ? (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void test(editingId)}>
                  {busy === `test:${editingId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                  Envoyer un test
                </Button>
              ) : null}
            </div>
          </div>
        </Card>

        {/* Liste des webhooks */}
        <Card title={`Webhooks configurés (${hooks.length})`} icon={Webhook}>
          {!hooks.length ? (
            <p className="text-xs text-muted-foreground">
              Aucun webhook pour l’instant. Ajoute l’URL d’un salon Discord, d’un canal Slack ou d’un service d’automatisation
              (Zapier, n8n, Make…) et NEXUS t’y racontera tout ce qu’il fait.
            </p>
          ) : (
            <ul className="space-y-2">
              {hooks.map((hook) => (
                <li
                  key={hook.id}
                  className={cn(
                    'rounded-lg border p-2.5 transition-colors',
                    hook.id === editingId ? 'border-foreground/30 bg-muted/40' : 'border-border/60 bg-muted/10'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" className="min-w-0 text-left" onClick={() => select(hook)}>
                      <p className="flex items-center gap-1.5 truncate text-xs font-semibold text-foreground">
                        {hook.enabled ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        {hook.name}
                      </p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{hook.url}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {hook.events.includes('*') ? 'tous les événements' : `${hook.events.length} événement(s)`} · {hook.format} ·{' '}
                        dernier envoi {when(hook.lastDeliveryAt)}
                      </p>
                      {hook.lastStatus ? (
                        <p className={cn('mt-0.5 text-[10px]', hook.lastError ? 'text-rose-600 dark:text-rose-300' : 'text-muted-foreground')}>
                          {hook.lastStatus}{hook.lastError ? ` — ${hook.lastError}` : ''}
                        </p>
                      ) : null}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={hook.enabled}
                        disabled={busy === `toggle:${hook.id}`}
                        onCheckedChange={(v) => void toggle(hook, v)}
                        aria-label={hook.enabled ? 'Désactiver' : 'Activer'}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        aria-label="Envoyer un test"
                        disabled={busy === `test:${hook.id}`}
                        onClick={() => void test(hook.id)}
                      >
                        {busy === `test:${hook.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Confirmations en attente */}
      <Card
        title={`Attente de confirmation (${data?.approvals.length ?? 0})`}
        icon={AlertTriangle}
        action={<Badge variant="outline" className="text-[10px]">Accepter applique immédiatement</Badge>}
      >
        {!data?.approvals.length ? (
          <p className="text-xs text-muted-foreground">
            Rien à confirmer. Dès qu’un correctif ou un savoir attend une décision, il apparaît ici <em>et</em> dans le webhook,
            avec les deux boutons.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.approvals.map((approval) => (
              <li key={approval.id} className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Badge variant="outline" className="text-[9px]">{KIND_LABEL[approval.kind] ?? approval.kind}</Badge>
                      {approval.title}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-[11px] leading-relaxed text-muted-foreground">{approval.summary}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">réf. {approval.refId} · {when(approval.createdAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      className="h-8 gap-1 bg-emerald-600 px-2.5 text-xs text-white hover:bg-emerald-700"
                      disabled={!!busy}
                      onClick={() => void decide(approval, 'accept')}
                    >
                      {busy === `accept:${approval.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Accepter
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 border-rose-300/40 px-2.5 text-xs text-rose-600 dark:text-rose-300"
                      disabled={!!busy}
                      onClick={() => void decide(approval, 'refuse')}
                    >
                      {busy === `refuse:${approval.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Refuser
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      aria-label="Copier le lien d’acceptation"
                      onClick={() => void copy(actionUrl(approval, 'accept'))}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Ouvrir le lien" asChild>
                      <a href={actionUrl(approval, 'accept')} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Journal */}
      <Card
        title="Journal des envois"
        icon={Webhook}
        action={<span className="text-[10px] text-muted-foreground">30 derniers</span>}
      >
        {!data?.logs.length ? (
          <p className="text-xs text-muted-foreground">Aucun envoi encore. Le bouton « Envoyer un test » écrit la première ligne.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Quand</th>
                  <th className="py-1 pr-3 font-medium">Événement</th>
                  <th className="py-1 pr-3 font-medium">Résultat</th>
                  <th className="py-1 pr-3 font-medium">Latence</th>
                  <th className="py-1 font-medium">Détail</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log) => (
                  <tr key={log.id} className="border-t border-border/40">
                    <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">{when(log.createdAt)}</td>
                    <td className="py-1.5 pr-3 font-mono">{log.event}</td>
                    <td className={cn('py-1.5 pr-3 font-semibold', log.ok ? 'text-emerald-600 dark:text-emerald-500' : 'text-rose-600 dark:text-rose-400')}>
                      {log.ok ? `OK ${log.status}` : log.status ? `HTTP ${log.status}` : 'Réseau'}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{log.ms} ms</td>
                    <td className="max-w-[28rem] truncate py-1.5 text-muted-foreground" title={log.error || log.preview}>
                      {log.error || log.preview || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
