'use client'

// ─── NEXUS — Espace développeur ──────────────────────────────────────────────
// Sept onglets : vue d'ensemble, personnalisation du site, agent Dev,
// explorateur de code, correctifs à valider, file d'améliorations, journal.
// Tout est réservé au compte Dev (devGuard côté serveur).

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Code2,
  Database,
  FileCode2,
  FolderTree,
  Gauge,
  Layers,
  ListChecks,
  Loader2,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  Server,
  Terminal,
  Trash2,
  Undo2,
  UserX,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { DevAgentPanel } from '@/components/nexus/DevAgentPanel'
import { useSiteSettings } from '@/lib/site-settings-client'
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/site-types'

type UseAsync = <T>(url: string, init?: RequestInit) => Promise<T | null>

function useJson(): UseAsync {
  return useCallback(async <T,>(url: string, init?: RequestInit): Promise<T | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store', ...init })
      const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null
      if (!res.ok) {
        toast.error(data?.error ?? `Erreur ${res.status}`)
        return null
      }
      return data
    } catch {
      toast.error('Réseau indisponible')
      return null
    }
  }, [])
}

function Card({ title, icon: Icon, children, action }: {
  title: string
  icon: typeof Server
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

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-bold text-foreground">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Isole la partie réellement modifiée entre deux textes. */
function splitDiff(a: string, b: string) {
  const minLen = Math.min(a.length, b.length)
  let start = 0
  while (start < minLen && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  return {
    prefix: a.slice(Math.max(0, start - 200), start),
    removed: a.slice(start, endA),
    added: b.slice(start, endB),
    suffix: a.slice(endA, endA + 200),
  }
}

// ─── Vue d'ensemble ──────────────────────────────────────────────────────────

interface Overview {
  counts: Record<string, number>
  code: { files: number; lines: number; bytes: number; byFolder: { folder: string; files: number; lines: number }[]; biggest: { path: string; lines: number }[] }
  weakSpots: { reply: string; count: number; examples: string[] }[]
  patches: { id: string; title: string; filePath: string; status: string }[]
  tasks: { id: string; title: string; status: string; priority: string; category: string; detail: string }[]
  api: { calls24h: number; keys: { id: string; name: string; enabled: boolean; totalCalls: number }[]; lastCalls: { message: string; reply: string; ms: number; ok: boolean }[] }
  system: { node: string; platform: string; uptime: number; memoryMb: number; cpuCount: number; loadAvg: number[]; cwd: string }
}

function OverviewTab() {
  const json = useJson()
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      const d = await json<Overview>('/api/dev/overview')
      if (d) setData(d)
      setLoading(false)
    },
    [json]
  )

  useEffect(() => {
    let alive = true
    json<Overview>('/api/dev/overview').then((d) => {
      if (!alive) return
      if (d) setData(d)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [json])

  const pending = (data?.patches ?? []).filter((p) => p.status === 'propose').length
  const openTasks = (data?.tasks ?? []).filter((t) => t.status !== 'fait' && t.status !== 'refuse').length
  const mb = data ? (data.code.bytes / 1024 / 1024).toFixed(1) : '—'

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Fichiers" value={data?.code.files ?? '—'} hint={`${mb} Mo de code`} />
        <Stat label="Lignes" value={(data?.code.lines ?? 0).toLocaleString('fr-FR')} hint="toutes extensions" />
        <Stat label="Appels API 24 h" value={data?.api.calls24h ?? '—'} hint={`${data?.api.keys.length ?? 0} clé(s)`} />
        <Stat label="Correctifs" value={pending} hint="en attente de validation" />
        <Stat label="Améliorations" value={openTasks} hint="ouvertes" />
        <Stat label="Mémoire" value={data ? `${data.system.memoryMb} Mo` : '—'} hint={`${data?.system.cpuCount ?? 0} cœur(s)`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Base de données"
          icon={Database}
          action={
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()} aria-label="Rafraîchir">
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          }
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
            {Object.entries(data?.counts ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between border-b border-border/40 py-1">
                <span className="font-mono text-[11px] text-muted-foreground">{k}</span>
                <span className="font-semibold text-foreground">{v}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Système" icon={Server}>
          <dl className="grid grid-cols-2 gap-y-1 text-xs">
            {[
              ['Node', data?.system.node],
              ['Plateforme', data?.system.platform],
              ['Disponibilité', data ? `${Math.floor(data.system.uptime / 60)} min` : undefined],
              ['Charge', data?.system.loadAvg.join(' · ')],
              ['Racine', data?.system.cwd],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex items-center justify-between border-b border-border/40 py-1">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="truncate font-mono text-[11px] text-foreground">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Poids du code par dossier" icon={Layers}>
          <div className="space-y-1">
            {(data?.code.byFolder ?? []).map((f) => (
              <div key={f.folder} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate font-mono text-[11px] text-muted-foreground">{f.folder}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                    style={{ width: `${Math.max(3, Math.round((f.lines / (data?.code.lines || 1)) * 100))}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-[11px] text-foreground">
                  {f.lines.toLocaleString('fr-FR')} l.
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Fichiers les plus lourds" icon={FileCode2}>
          <ul className="space-y-1">
            {(data?.code.biggest ?? []).map((f) => (
              <li key={f.path} className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-mono text-muted-foreground">{f.path}</span>
                <span className="shrink-0 font-semibold text-foreground">{f.lines.toLocaleString('fr-FR')}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title="Sujets mal couverts" icon={AlertTriangle}>
        {!data?.weakSpots.length ? (
          <p className="text-xs text-muted-foreground">
            Aucun signal : pas de réponse répétée à des messages différents dans le journal d’appels.
          </p>
        ) : (
          <div className="space-y-3">
            {data.weakSpots.map((w, i) => (
              <div key={i} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3">
                <p className="text-[11px] font-semibold text-amber-300">
                  {w.count} messages différents → la même réponse
                </p>
                <p className="mt-1 line-clamp-2 text-xs text-foreground/80">{w.reply}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {w.examples.map((e, j) => (
                    <span key={j} className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      « {e.slice(0, 60)} »
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

// ─── Personnalisation du site ────────────────────────────────────────────────

const HUB_TILES = [
  { id: 'agent', label: 'Agent IA' },
  { id: 'cerveaux', label: 'Cerveau Jarvis' },
  { id: 'studio3d', label: 'Studio 3D' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Vidéo' },
  { id: 'code', label: 'Code' },
  { id: 'connexions', label: 'Connexions' },
  { id: 'blueprints', label: 'Blueprints' },
  { id: 'cles', label: 'Clés API' },
]

function SiteTab() {
  const { settings, save, reset } = useSiteSettings()
  const [draft, setDraft] = useState<SiteSettings>(settings)
  const [saving, setSaving] = useState(false)

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings])
  const set = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const submit = async () => {
    setSaving(true)
    const ok = await save(draft)
    setSaving(false)
    if (ok) setDraft(settings)
  }

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <Card title="Identité" icon={Palette}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Nom de l’application</span>
              <Input value={draft.appName} onChange={(e) => set('appName', e.target.value)} maxLength={40} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Sous-titre du logo</span>
              <Input value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} maxLength={60} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Emoji du logo (vide = robot)</span>
              <Input value={draft.logoEmoji} onChange={(e) => set('logoEmoji', e.target.value)} maxLength={8} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Couleur principale</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.accent}
                    onChange={(e) => set('accent', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Couleur principale"
                  />
                  <Input value={draft.accent} onChange={(e) => set('accent', e.target.value)} className="font-mono text-xs" />
                </div>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] text-muted-foreground">Couleur secondaire</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.accent2}
                    onChange={(e) => set('accent2', e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                    aria-label="Couleur secondaire"
                  />
                  <Input value={draft.accent2} onChange={(e) => set('accent2', e.target.value)} className="font-mono text-xs" />
                </div>
              </label>
            </div>
          </div>
        </Card>

        <Card title="Textes" icon={ScrollText}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Titre de la page de connexion</span>
              <Input value={draft.loginTitle} onChange={(e) => set('loginTitle', e.target.value)} maxLength={80} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Sous-titre de connexion</span>
              <Input value={draft.loginSubtitle} onChange={(e) => set('loginSubtitle', e.target.value)} maxLength={200} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Titre d’accueil</span>
              <Input value={draft.welcomeTitle} onChange={(e) => set('welcomeTitle', e.target.value)} maxLength={80} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Sous-titre d’accueil</span>
              <Input value={draft.welcomeSubtitle} onChange={(e) => set('welcomeSubtitle', e.target.value)} maxLength={200} />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-[11px] text-muted-foreground">Pied de la barre latérale</span>
              <Input value={draft.footerText} onChange={(e) => set('footerText', e.target.value)} maxLength={240} />
            </label>
          </div>
        </Card>

        <Card title="Tuiles de la page d’accueil" icon={Layers}>
          <div className="grid gap-2 sm:grid-cols-3">
            {HUB_TILES.map((t) => {
              const hidden = draft.hiddenTiles.includes(t.id)
              return (
                <label key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs">
                  <span className="text-foreground/90">{t.label}</span>
                  <Switch
                    checked={!hidden}
                    onCheckedChange={(on) =>
                      set('hiddenTiles', on ? draft.hiddenTiles.filter((x) => x !== t.id) : [...draft.hiddenTiles, t.id])
                    }
                    aria-label={`Afficher ${t.label}`}
                  />
                </label>
              )
            })}
          </div>
        </Card>

        <Card title="CSS personnalisé" icon={Code2}>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Injecté tel quel dans la page. Les variables <code className="text-cyan-300">--dev-accent</code> et{' '}
            <code className="text-cyan-300">--dev-accent-2</code> reprennent vos couleurs. Les scripts et les imports
            distants sont retirés automatiquement.
          </p>
          <Textarea
            value={draft.customCss}
            onChange={(e) => set('customCss', e.target.value)}
            rows={8}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={"/* exemple */\n.sidebar { border-radius: 18px; }"}
          />
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void submit()} disabled={saving || !dirty} className="bg-cyan-600 hover:bg-cyan-500">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              setSaving(true)
              const ok = await reset()
              setSaving(false)
              if (ok) setDraft(DEFAULT_SITE_SETTINGS)
            }}
            disabled={saving}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Réglages d’origine
          </Button>
          {dirty ? <Badge variant="outline" className="border-amber-500/40 text-amber-300">Modifications non enregistrées</Badge> : null}
        </div>
      </div>

      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card title="Aperçu" icon={Terminal}>
          <div
            className="rounded-xl border border-border/70 p-4"
            style={{ background: `linear-gradient(135deg, ${draft.accent}22, ${draft.accent2}18)` }}
          >
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-xl text-lg text-white shadow-lg"
                style={{ background: `linear-gradient(135deg, ${draft.accent}, ${draft.accent2})` }}
              >
                {draft.logoEmoji || '🤖'}
              </span>
              <div className="leading-tight">
                <p className="text-sm font-extrabold tracking-widest text-foreground">{draft.appName}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{draft.tagline}</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border/60 bg-background/50 p-3">
              <p className="text-xs font-bold text-foreground">{draft.loginTitle}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{draft.loginSubtitle}</p>
            </div>
            <div className="mt-3 rounded-lg border border-border/60 bg-background/50 p-3">
              <p className="text-xs font-bold text-foreground">{draft.welcomeTitle} 👋</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{draft.welcomeSubtitle}</p>
            </div>
            <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{draft.footerText}</p>
          </div>
        </Card>
      </div>
    </div>
  )
}

// ─── Explorateur de code ─────────────────────────────────────────────────────

interface TreeEntry { path: string; name: string; type: 'dir' | 'file'; size?: number }
interface FileView { path: string; language: string; totalLines: number; content: string; from: number; to: number; truncated: boolean }
interface SearchHit { path: string; line: number; text: string }

function CodeTab() {
  const json = useJson()
  const [entries, setEntries] = useState<TreeEntry[]>([])
  const [file, setFile] = useState<FileView | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadTree = useCallback(async () => {
    setBusy(true)
    const d = await json<{ entries: TreeEntry[] }>('/api/dev/code?action=tree&depth=6')
    if (d) setEntries(d.entries)
    setBusy(false)
  }, [json])

  useEffect(() => {
    let alive = true
    json<{ entries: TreeEntry[] }>('/api/dev/code?action=tree&depth=6').then((d) => {
      if (!alive) return
      if (d) setEntries(d.entries)
    })
    return () => {
      alive = false
    }
  }, [json])


  const open = async (p: string, line?: number) => {
    setBusy(true)
    const from = line ? Math.max(1, line - 20) : undefined
    const to = line ? line + 60 : undefined
    const d = await json<{ file: FileView }>(
      `/api/dev/code?action=read&path=${encodeURIComponent(p)}${from ? `&from=${from}&to=${to}` : ''}`
    )
    if (d) setFile(d.file)
    setBusy(false)
  }

  const search = async () => {
    if (query.trim().length < 2) return
    setBusy(true)
    const d = await json<{ hits: SearchHit[] }>(`/api/dev/code?action=search&q=${encodeURIComponent(query)}&max=80`)
    if (d) setHits(d.hits)
    setBusy(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (hits) return []
    if (!q) return entries
    return entries.filter((e) => e.type === 'file' && e.path.toLowerCase().includes(q))
  }, [entries, query, hits])

  return (
    <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[300px_1fr]">
      <div className="flex min-h-0 flex-col border-b border-border/70 lg:border-b-0 lg:border-r">
        <div className="space-y-2 p-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHits(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void search()
              }}
              placeholder="Nom de fichier… (Entrée = chercher dans le code)"
              className="text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => void search()} disabled={busy}>
              <Search className="mr-1.5 h-3 w-3" /> Chercher dans le code
            </Button>
            {hits ? (
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setHits(null)}>
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {hits ? (
            <ul className="space-y-1">
              {hits.map((h, i) => (
                <li key={i}>
                  <button
                    onClick={() => void open(h.path, h.line)}
                    className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-accent/50"
                  >
                    <p className="truncate font-mono text-[10px] text-cyan-300">
                      {h.path}:{h.line}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">{h.text.slice(0, 90)}</p>
                  </button>
                </li>
              ))}
              {!hits.length ? <p className="px-2 text-[11px] text-muted-foreground">Aucun résultat.</p> : null}
            </ul>
          ) : (
            <ul className="space-y-0.5">
              {filtered.map((e) => (
                <li key={e.path}>
                  {e.type === 'dir' ? (
                    <p className="mt-2 flex items-center gap-1.5 px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      <FolderTree className="h-3 w-3" />
                      {e.path}
                    </p>
                  ) : (
                    <button
                      onClick={() => void open(e.path)}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-mono text-[11px] hover:bg-accent/50',
                        file?.path === e.path ? 'bg-cyan-500/15 text-cyan-200' : 'text-foreground/80'
                      )}
                    >
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                      <span className="truncate">{e.path}</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-col">
        {file ? (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-cyan-300">{file.path}</p>
                <p className="text-[10px] text-muted-foreground">
                  {file.totalLines} lignes · {file.language}
                  {file.truncated ? ` · affichage ${file.from}–${file.to}` : ''}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                <ArrowLeft className="mr-1.5 h-3 w-3" /> Fermer
              </Button>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-foreground/90">
              {file.content.split('\n').map((l, i) => (
                <div key={i} className="flex">
                  <span className="mr-3 w-10 shrink-0 select-none text-right text-muted-foreground/50">{file.from + i}</span>
                  <code className="whitespace-pre">{l}</code>
                </div>
              ))}
            </pre>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <FileCode2 className="h-8 w-8 opacity-40" />
            <p className="text-xs">Choisis un fichier à gauche, ou cherche un symbole.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Correctifs ──────────────────────────────────────────────────────────────

interface Patch {
  id: string
  title: string
  filePath: string
  before: string
  after: string
  rationale: string
  status: string
  origin: string
  appliedAt: string | null
}

function PatchesTab() {
  const json = useJson()
  const [patches, setPatches] = useState<Patch[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    const d = await json<{ patches: Patch[] }>('/api/dev/patches')
    if (d) setPatches(d.patches)
  }, [json])

  useEffect(() => {
    let alive = true
    json<{ patches: Patch[] }>('/api/dev/patches').then((d) => {
      if (!alive) return
      if (d) setPatches(d.patches)
    })
    return () => {
      alive = false
    }
  }, [json])

  const apply = async (id: string) => {
    setBusy(id)
    const d = await json<{ ok: boolean; backup: string }>('/api/dev/patches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'apply', id }),
    })
    setBusy(null)
    if (d) {
      toast.success(`Correctif appliqué — sauvegarde : ${d.backup}`)
      await load()
    }
  }

  const setStatus = async (id: string, status: string) => {
    setBusy(id)
    await json('/api/dev/patches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setBusy(null)
    await load()
  }

  const remove = async (id: string) => {
    setBusy(id)
    await json(`/api/dev/patches?id=${id}`, { method: 'DELETE' })
    setBusy(null)
    await load()
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Chaque correctif est appliqué par remplacement d’une ancre exacte, après sauvegarde automatique du fichier.
        </p>
        <Button variant="ghost" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {!patches.length ? (
        <p className="rounded-xl border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
          Aucun correctif. Demande à l’agent Dev, par exemple « apprends à NEXUS que… ».
        </p>
      ) : null}

      {patches.map((p) => {
        const expanded = open === p.id
        const diff = splitDiff(p.before, p.after)
        return (
          <article key={p.id} className="rounded-xl border border-border/70 bg-card/60">
            <header className="flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">{p.title}</h4>
                  <Badge variant="outline" className={cn(
                    p.status === 'applique' && 'border-emerald-500/40 text-emerald-300',
                    p.status === 'propose' && 'border-amber-500/40 text-amber-300',
                    p.status === 'refuse' && 'border-border text-muted-foreground'
                  )}>
                    {p.status === 'applique' ? 'appliqué' : p.status === 'refuse' ? 'refusé' : 'à valider'}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">{p.origin}</Badge>
                </div>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{p.filePath}</p>
                {p.rationale ? <p className="mt-1 text-[11px] text-foreground/70">{p.rationale}</p> : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {p.status === 'propose' ? (
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500" onClick={() => void apply(p.id)} disabled={busy === p.id}>
                    {busy === p.id ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Play className="mr-1.5 h-3 w-3" />}
                    Appliquer
                  </Button>
                ) : null}
                {p.status === 'applique' ? (
                  <Button size="sm" variant="outline" onClick={() => void setStatus(p.id, 'propose')} disabled={busy === p.id}>
                    <Undo2 className="mr-1.5 h-3 w-3" /> Rouvrir
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => void setStatus(p.id, p.status === 'refuse' ? 'propose' : 'refuse')} disabled={busy === p.id}>
                    {p.status === 'refuse' ? 'Restaurer' : 'Refuser'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOpen(expanded ? null : p.id)}>
                  {expanded ? 'Masquer' : 'Voir le diff'}
                </Button>
                <Button size="sm" variant="ghost" className="text-rose-300" onClick={() => void remove(p.id)} aria-label="Supprimer">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </header>

            {expanded ? (
              <div className="grid gap-3 border-t border-border/60 p-4 lg:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-rose-300">Avant</p>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed">
                    <span className="text-muted-foreground">{diff.prefix}</span>
                    <span className="bg-rose-500/20 text-rose-200">{diff.removed || '(vide)'}</span>
                    <span className="text-muted-foreground">{diff.suffix}</span>
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">Après</p>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed">
                    <span className="text-muted-foreground">{diff.prefix}</span>
                    <span className="bg-emerald-500/20 text-emerald-200">{diff.added || '(vide)'}</span>
                    <span className="text-muted-foreground">{diff.suffix}</span>
                  </pre>
                </div>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

// ─── File d'améliorations ────────────────────────────────────────────────────

interface Task {
  id: string
  title: string
  detail: string
  category: string
  priority: string
  status: string
}

const TASK_STATUS: Record<string, string> = { a_faire: 'à faire', en_cours: 'en cours', fait: 'fait', refuse: 'refusé' }

function TasksTab() {
  const json = useJson()
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [detail, setDetail] = useState('')

  const load = useCallback(async () => {
    const d = await json<{ tasks: Task[] }>('/api/dev/tasks')
    if (d) setTasks(d.tasks)
  }, [json])

  useEffect(() => {
    let alive = true
    json<{ tasks: Task[] }>('/api/dev/tasks').then((d) => {
      if (!alive) return
      if (d) setTasks(d.tasks)
    })
    return () => {
      alive = false
    }
  }, [json])

  const add = async () => {
    if (!title.trim()) return
    const d = await json<{ ok: boolean }>('/api/dev/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), detail }),
    })
    if (d) {
      setTitle('')
      setDetail('')
      toast.success('Tâche ajoutée')
      await load()
    }
  }

  const cycle = async (t: Task) => {
    const order = ['a_faire', 'en_cours', 'fait']
    const next = order[(order.indexOf(t.status) + 1) % order.length] ?? 'a_faire'
    await json('/api/dev/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, status: next }),
    })
    await load()
  }

  const remove = async (id: string) => {
    await json(`/api/dev/tasks?id=${id}`, { method: 'DELETE' })
    await load()
  }

  const open = tasks.filter((t) => t.status !== 'fait' && t.status !== 'refuse')

  return (
    <div className="space-y-4 p-4">
      <Card title={open.length ? `Nouvelle amélioration (${open.length} ouverte(s))` : 'Nouvelle amélioration'} icon={ListChecks}>
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre de l’amélioration" />
          <Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} placeholder="Détail (optionnel)" />
          <Button onClick={() => void add()} disabled={!title.trim()} className="bg-cyan-600 hover:bg-cyan-500">
            Ajouter
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        {tasks.map((t) => (
          <article key={t.id} className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3">
            <button
              onClick={() => void cycle(t)}
              className={cn(
                'mt-0.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold transition-colors',
                t.status === 'fait' && 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
                t.status === 'en_cours' && 'border-amber-500/40 bg-amber-500/10 text-amber-300',
                t.status === 'a_faire' && 'border-border text-muted-foreground',
                t.status === 'refuse' && 'border-border text-muted-foreground line-through'
              )}
            >
              {TASK_STATUS[t.status] ?? t.status}
            </button>
            <div className="min-w-0 flex-1">
              <p className={cn('text-sm text-foreground', t.status === 'fait' && 'line-through opacity-60')}>{t.title}</p>
              {t.detail ? <p className="text-[11px] text-muted-foreground">{t.detail}</p> : null}
              <div className="mt-1 flex gap-2">
                <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
                <Badge variant="outline" className={cn('text-[9px]', t.priority === 'haute' && 'border-rose-500/40 text-rose-300')}>
                  {t.priority}
                </Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-300" onClick={() => void remove(t.id)} aria-label="Supprimer">
              <Trash2 className="h-3 w-3" />
            </Button>
          </article>
        ))}
        {!tasks.length ? (
          <p className="rounded-xl border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">
            Aucune tâche. L’agent Dev en ajoute automatiquement après un audit.
          </p>
        ) : null}
      </div>
    </div>
  )
}

// ─── Journal ─────────────────────────────────────────────────────────────────

function JournalTab() {
  const json = useJson()
  const [data, setData] = useState<Overview | null>(null)
  const [sessions, setSessions] = useState<
    { id: string; user: string; userAgent: string; lastSeenAt: string; current: boolean }[]
  >([])

  const load = useCallback(async () => {
    const [ov, se] = await Promise.all([
      json<Overview>('/api/dev/overview'),
      json<{ current: string; sessions: { id: string; user: string; userAgent: string; lastSeenAt: string }[] }>('/api/dev/sessions'),
    ])
    if (ov) setData(ov)
    if (se) setSessions(se.sessions.map((s) => ({ ...s, current: s.id === se.current })))
  }, [json])

  useEffect(() => {
    let alive = true
    Promise.all([
      json<Overview>('/api/dev/overview'),
      json<{ current: string; sessions: { id: string; user: string; userAgent: string; lastSeenAt: string }[] }>(
        '/api/dev/sessions'
      ),
    ]).then(([ov, se]) => {
      if (!alive) return
      if (ov) setData(ov)
      if (se) setSessions(se.sessions.map((x) => ({ ...x, current: x.id === se.current })))
    })
    return () => {
      alive = false
    }
  }, [json])

  const revoke = async (id: string) => {
    const d = await json<{ ok: boolean }>(`/api/dev/sessions?id=${id}`, { method: 'DELETE' })
    if (d) {
      toast.success('Session révoquée')
      await load()
    }
  }

  return (
    <div className="space-y-4 p-4">
      <Card title="Derniers appels d’API" icon={Activity}>
        <div className="space-y-2">
          {(data?.api.lastCalls ?? []).map((c, i) => (
            <div key={i} className="rounded-lg border border-border/60 bg-background/40 p-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[11px] text-foreground">« {c.message} »</p>
                <span className={cn('shrink-0 text-[10px]', c.ok ? 'text-emerald-300' : 'text-rose-300')}>
                  {c.ms} ms
                </span>
              </div>
              <p className="truncate text-[10px] text-muted-foreground">→ {c.reply}</p>
            </div>
          ))}
          {!data?.api.lastCalls.length ? (
            <p className="text-xs text-muted-foreground">Aucun appel enregistré.</p>
          ) : null}
        </div>
      </Card>

      <Card title="Clés API" icon={Gauge}>
        <ul className="space-y-1">
          {(data?.api.keys ?? []).map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-foreground/90">{k.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                <span>{k.totalCalls} appel(s)</span>
                <Badge variant="outline" className={cn('text-[9px]', k.enabled ? 'text-emerald-300' : 'text-muted-foreground')}>
                  {k.enabled ? 'active' : 'désactivée'}
                </Badge>
              </span>
            </li>
          ))}
          {!data?.api.keys.length ? <li className="text-xs text-muted-foreground">Aucune clé créée.</li> : null}
        </ul>
      </Card>

      <Card title="Sessions" icon={UserX}>
        <ul className="space-y-1">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 px-2 py-1.5">
              <div className="min-w-0">
                <p className="truncate text-[11px] text-foreground">
                  {s.user} {s.current ? <span className="text-cyan-300">(courante)</span> : null}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">{s.userAgent || 'appareil inconnu'}</p>
              </div>
              {!s.current ? (
                <Button variant="ghost" size="sm" className="shrink-0 text-xs text-rose-300" onClick={() => void revoke(s.id)}>
                  Révoquer
                </Button>
              ) : null}
            </li>
          ))}
          {!sessions.length ? <li className="text-xs text-muted-foreground">Aucune session.</li> : null}
        </ul>
      </Card>
    </div>
  )
}

// ─── Coquille ────────────────────────────────────────────────────────────────

export function DevDashboard() {
  const { loading } = useSiteSettings()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-600 shadow-lg shadow-cyan-500/25">
          <Terminal className="h-4.5 w-4.5 text-white" />
        </span>
        <div className="leading-tight">
          <h1 className="text-sm font-bold text-foreground">Espace développeur</h1>
          <p className="text-[11px] text-muted-foreground">
            Dashboard, personnalisation du site, accès au code et agent Dev — invisible depuis un compte standard.
          </p>
        </div>
      </div>

      <Tabs defaultValue="vue" className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-border/70 px-2">
          <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-1">
            {[
              { value: 'vue', label: 'Vue d’ensemble', icon: Gauge },
              { value: 'site', label: 'Site', icon: Palette },
              { value: 'agent', label: 'Agent Dev', icon: Terminal },
              { value: 'code', label: 'Code', icon: Code2 },
              { value: 'correctifs', label: 'Correctifs', icon: ListChecks },
              { value: 'taches', label: 'Améliorations', icon: Layers },
              { value: 'journal', label: 'Journal', icon: ScrollText },
            ].map((t) => {
              const Icon = t.icon
              return (
                <TabsTrigger
                  key={t.value}
                  value={t.value}
                  className="gap-1.5 px-3 py-1.5 text-xs data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-200"
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="vue" className="mt-0">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="site" className="mt-0">
            {/* remonté quand les réglages arrivent : le formulaire s'initialise proprement */}
            {loading ? (
              <div className="flex items-center justify-center gap-2 p-10 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Chargement des réglages…
              </div>
            ) : (
              <SiteTab />
            )}
          </TabsContent>
          <TabsContent value="agent" className="mt-0 h-full">
            <div className="h-[calc(100vh-13rem)] min-h-[420px]">
              <DevAgentPanel />
            </div>
          </TabsContent>
          <TabsContent value="code" className="mt-0">
            <div className="h-[calc(100vh-13rem)] min-h-[420px]">
              <CodeTab />
            </div>
          </TabsContent>
          <TabsContent value="correctifs" className="mt-0">
            <PatchesTab />
          </TabsContent>
          <TabsContent value="taches" className="mt-0">
            <TasksTab />
          </TabsContent>
          <TabsContent value="journal" className="mt-0">
            <JournalTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}
