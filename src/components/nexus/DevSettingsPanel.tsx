'use client'

// ─── NEXUS — Espace Dev : Réglages (base Turso & Gardien anti-veille) ───────
// Tout se règle ici, sans redéploiement :
//   • Base de données : Turso (URL + jeton), test, enregistrement, migration des données
//     ou retour à la base locale ;
//   • Gardien : bot externe qui ping l'IA toutes les minutes, 24h/24.

import { useCallback, useEffect, useState } from 'react'
import { Bot, Check, Copy, Database, KeyRound, Loader2, RefreshCw, Trash2, Upload, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface DbSnapshot {
  current: { mode: 'local' | 'turso'; origin: string; target: string }
  saved: { mode: 'local' | 'turso'; origin: string; tursoUrl: string; tokenSet: boolean; localPath: string; savedAt: string | null; envTurso: boolean }
  stats: { latencyMs: number; totalRows: number; tables: { name: string; rows: number }[] } | null
  statsError: string
}

interface GardienResult { ok: boolean; at: string; source: string; aiReady: boolean; aiMs: number; dbMs: number; error?: string }
interface GardienState {
  enabled: boolean
  tokenSet: boolean
  tokenPrefix: string
  intervalSec: number
  pingPath: string
  lastPingAt: string | null
  lastSource: string
  pingCount: number
  lastResult: GardienResult | null
}

function Card({ title, icon: Icon, children, action }: { title: string; icon: typeof Database; children: React.ReactNode; action?: React.ReactNode }) {
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

function when(iso: string | null): string {
  if (!iso) return 'jamais'
  return new Date(iso).toLocaleString('fr-FR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', second: '2-digit' })
}

// ── Base de données ──────────────────────────────────────────────────────────

function DatabaseCard() {
  const [snap, setSnap] = useState<DbSnapshot | null>(null)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const data = await call<DbSnapshot>('/api/dev/database')
    if (data.error) toast.error(data.error)
    else setSnap(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: 'test' | 'save' | 'migrate' | 'use-local' | 'forget') => {
    if (action === 'migrate' && !window.confirm('Copier TOUTES les données de la base actuelle vers Turso, puis basculer dessus ? (les lignes existantes de Turso seront remplacées si elles ont le même identifiant)')) return
    if (action === 'forget' && !window.confirm('Supprimer la configuration Dev de la base ? NEXUS reviendra à TURSO_* (variables d’environnement) ou à la base locale.')) return
    setBusy(action)
    const data = await call<DbSnapshot & { ok?: boolean; message?: string; latencyMs?: number }>('/api/dev/database', { action, url, token })
    setBusy(null)
    if (data.error) {
      toast.error(data.error)
      return
    }
    toast.success(data.message ?? 'Fait')
    if (action === 'save' || action === 'migrate') setToken('')
    if (data.current) setSnap(data as DbSnapshot)
    else void load()
  }

  const cur = snap?.current
  return (
    <Card title="Base de données" icon={Database} action={
      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void load()}>
        <RefreshCw className="h-3 w-3" /> Actualiser
      </Button>
    }>
      {!snap ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Base active</p>
              <p className="mt-1 flex items-center gap-2 font-semibold">
                {cur?.mode === 'turso' ? 'Turso' : 'Locale (fichier)'}
                <Badge variant="outline" className="text-[10px]">{cur?.origin === 'dashboard' ? 'réglée ici' : cur?.origin === 'env' ? 'variables d’env.' : 'par défaut'}</Badge>
              </p>
              <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">{cur?.target}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contenu</p>
              <p className="mt-1 font-semibold">{snap.stats ? `${snap.stats.totalRows.toLocaleString('fr-FR')} lignes` : 'indisponible'}</p>
              <p className="text-[10px] text-muted-foreground">
                {snap.stats ? `latence ${snap.stats.latencyMs} ms · ${snap.stats.tables.length} tables` : snap.statsError}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Turso enregistré</p>
              <p className="mt-1 font-semibold">{snap.saved.tursoUrl ? 'oui' : 'non'}</p>
              <p className="text-[10px] text-muted-foreground">
                {snap.saved.tokenSet ? 'jeton chiffré (AES-256-GCM)' : snap.saved.envTurso ? 'variables TURSO_* détectées' : 'aucun jeton'}
                {snap.saved.savedAt ? ` · ${when(snap.saved.savedAt)}` : ''}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Adresse Turso</span>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="libsql://nexus-mon-compte.turso.io" className="h-9 font-mono text-xs" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Jeton d’accès {snap.saved.tokenSet ? '(laisser vide pour garder l’actuel)' : ''}</span>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="eyJhbGciOi…" className="h-9 font-mono text-xs" autoComplete="off" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run('test')}>
              {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Tester la connexion
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void run('save')}>
              {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Utiliser Turso (sans copie)
            </Button>
            <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => void run('migrate')}>
              {busy === 'migrate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Migrer les données vers Turso
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5" disabled={!!busy} onClick={() => void run('use-local')}>
              Revenir à la base locale
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5 text-rose-600 dark:text-rose-300" disabled={!!busy} onClick={() => void run('forget')}>
              <Trash2 className="h-3.5 w-3.5" /> Oublier la config
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Le jeton est chiffré avant d’être écrit sur le disque et n’est jamais ré-affiché. « Migrer » copie toutes les tables
            (comptes, conversations, connaissances, modèle entraîné…) puis bascule sans redémarrer le serveur. Créez le jeton
            dans la console Turso (<span className="font-mono">turso db tokens create</span>).
          </p>
        </div>
      )}
    </Card>
  )
}

// ── Gardien : bot anti-veille ────────────────────────────────────────────────

function GardienCard() {
  const [state, setState] = useState<GardienState | null>(null)
  const [fresh, setFresh] = useState<string>('')
  const [busy, setBusy] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')

  const load = useCallback(async () => {
    const data = await call<GardienState>('/api/dev/gardien')
    if (data.error) toast.error(data.error)
    else setState(data)
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
    const id = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(id)
  }, [load])

  const act = async (action: 'enable' | 'token' | 'test', extra: Record<string, unknown> = {}) => {
    setBusy(action)
    const data = await call<GardienState & { token?: string; result?: GardienResult; ok?: boolean; state?: GardienState }>('/api/dev/gardien', { action, ...extra })
    setBusy(null)
    if (data.error) {
      toast.error(data.error)
      return
    }
    if (action === 'token' && data.token) {
      setFresh(data.token)
      toast.success('Nouveau jeton créé — copie-le maintenant, il ne sera plus affiché.')
    }
    if (action === 'test') {
      if (data.result?.ok) toast.success(`Ping IA OK (${data.result.aiMs} ms, modèle ${data.result.aiReady ? 'entraîné' : 'non entraîné'})`)
      else toast.error(data.result?.error ?? 'Ping en échec')
    }
    if (data.state) setState(data.state)
    else void load()
  }

  const pingUrl = state ? `${origin}${state.pingPath}?token=${fresh || 'VOTRE_JETON'}` : ''
  const last = state?.lastResult
  return (
    <Card title="Gardien — bot anti-veille" icon={Bot}>
      {!state ? (
        <p className="text-xs text-muted-foreground">Chargement…</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div>
              <p className="text-sm font-semibold">Ping de l’IA toutes les {state.intervalSec} s</p>
              <p className="text-[11px] text-muted-foreground">
                Garde le modèle et le serveur éveillés, 24h/24. Le serveur se ping aussi lui-même en production.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={cn(state.enabled ? 'text-foreground' : 'text-muted-foreground')}>{state.enabled ? 'Activé' : 'Désactivé'}</span>
              <Switch checked={state.enabled} disabled={!!busy} onCheckedChange={(v) => void act('enable', { enabled: v })} />
            </div>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Dernier ping</p>
              <p className="mt-1 font-semibold">{when(state.lastPingAt)}</p>
              <p className="text-[10px] text-muted-foreground">source : {state.lastSource || '—'}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pings reçus</p>
              <p className="mt-1 font-semibold">{state.pingCount.toLocaleString('fr-FR')}</p>
              <p className="text-[10px] text-muted-foreground">depuis la dernière installation</p>
            </div>
            <div className="rounded-lg border border-border/60 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">État</p>
              <p className={cn('mt-1 font-semibold', last?.ok ? 'text-foreground' : last ? 'text-rose-600 dark:text-rose-300' : '')}>
                {last ? (last.ok ? 'OK' : 'Erreur') : '—'}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {last ? `IA ${last.aiReady ? 'entraînée' : 'non entraînée'} · ${last.aiMs} ms · base ${last.dbMs} ms` : 'aucun ping encore'}
              </p>
              {last?.error ? <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-300">{last.error}</p> : null}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium">Relier un bot externe</p>
            <p className="text-[11px] text-muted-foreground">
              Crée un jeton, puis configure ton bot (UptimeRobot, cron-job.org, un script 24h/24…) pour appeler l’adresse ci-dessous
              <strong> toutes les minutes</strong>. Le jeton n’est enregistré que haché.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => void act('token')}>
                {busy === 'token' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                {state.tokenSet ? 'Régénérer le jeton' : 'Créer le jeton du bot'}
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => void act('test')}>
                {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Tester le ping maintenant
              </Button>
            </div>
            {state.tokenSet ? (
              <p className="text-[11px] text-muted-foreground">Jeton actuel : <span className="font-mono">{state.tokenPrefix}…</span> (régénérer invalide l’ancien)</p>
            ) : (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">Aucun jeton : le bot externe ne peut pas se connecter tant que tu n’en crées pas un.</p>
            )}
            {fresh ? (
              <div className="rounded-lg border border-amber-300/30 bg-amber-300/5 p-3">
                <p className="mb-2 text-[11px] font-semibold text-amber-700 dark:text-amber-200">Jeton (affiché une seule fois)</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-muted/60 px-2 py-1.5 font-mono text-[11px]">{fresh}</code>
                  <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => { void navigator.clipboard.writeText(fresh); toast.success('Copié') }}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="rounded-lg border border-border/60 bg-muted/50 p-3">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Adresse à appeler chaque minute</p>
              <code className="break-all font-mono text-[11px]">{pingUrl}</code>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Alternative : en-tête <span className="font-mono">Authorization: Bearer &lt;jeton&gt;</span>. Réponse : <span className="font-mono">{'{ ok, aiReady, aiMs, dbMs, at }'}</span>.
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

export function DevSettingsPanel() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <DatabaseCard />
      <GardienCard />
    </div>
  )
}
