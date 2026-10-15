'use client'

// ─── NEXUS — Espace Dev : filtres de conversations, par compte ───────────────
// Trois gestes : AJOUTER une règle (tout / mot-clé / une conversation), EXCLURE de
// l'entraînement du modèle, MASQUER du dashboard, SUPPRIMER définitivement.
// La portée se choisit par compte (ou « tous les comptes »).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EyeOff, Filter, Loader2, Plus, RefreshCw, Trash2, Search, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface Account { id: string; label: string }
interface Rule {
  id: string; scopeUserId: string; kind: 'all' | 'keyword' | 'conversation'; pattern: string
  action: 'exclude' | 'hide'; enabled: boolean; hits: number; description: string
}
interface ConvRow {
  id: string; title: string; account: string; userId: string | null; messages: number
  updatedAt: string | null; excluded: boolean; hidden: boolean; matched: string[]
}
interface FiltersSnapshot {
  accounts: Account[]
  rules: Rule[]
  conversations: ConvRow[]
  totals: { all: number; excluded: number; hidden: number }
}

async function call<T>(method: 'GET' | 'POST', body?: unknown): Promise<T & { error?: string }> {
  const res = await fetch('/api/dev/filters', {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok && !data.error) data.error = `Erreur ${res.status}`
  return data
}

export function DevFiltersPanel() {
  const [snap, setSnap] = useState<FiltersSnapshot | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [scope, setScope] = useState('')
  const [kind, setKind] = useState<'all' | 'keyword'>('keyword')
  const [pattern, setPattern] = useState('')
  const [action, setAction] = useState<'exclude' | 'hide'>('exclude')
  const [preview, setPreview] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')

  const load = useCallback(async () => {
    const data = await call<FiltersSnapshot>('GET')
    if (data.error) toast.error(data.error)
    else setSnap(data)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const payload = () => ({ scopeUserId: scope, kind, pattern, effect: action })

  const doPreview = async () => {
    setBusy('preview')
    const data = await call<{ count: number; scanned: number }>('POST', { action: 'preview', ...payload() })
    setBusy(null)
    if (data.error) toast.error(data.error)
    else setPreview(data.count)
  }

  const addRule = async () => {
    setBusy('add')
    const data = await call<FiltersSnapshot>('POST', { action: 'add', ...payload() })
    setBusy(null)
    if (data.error) return toast.error(data.error)
    setSnap(data)
    setPattern('')
    setPreview(null)
    toast.success('Règle ajoutée')
  }

  const mutate = async (body: Record<string, unknown>, okMsg: string) => {
    const data = await call<FiltersSnapshot>('POST', body)
    if (data.error) return toast.error(data.error)
    setSnap(data)
    if (okMsg) toast.success(okMsg)
  }

  const convAction = async (conv: ConvRow, act: 'exclude' | 'hide') => {
    await mutate({ action: 'add', kind: 'conversation', conversationId: conv.id, scopeUserId: '', effect: act }, act === 'exclude' ? 'Conversation exclue de l’entraînement' : 'Conversation masquée')
  }

  const deleteConv = async (conv: ConvRow) => {
    if (!window.confirm(`Supprimer définitivement « ${conv.title} » ? Cette action est irréversible.`)) return
    await mutate({ action: 'delete-conversation', id: conv.id }, 'Conversation supprimée')
  }

  const visibleConvs = useMemo(() => {
    if (!snap) return []
    const q = search.trim().toLowerCase()
    return snap.conversations.filter((c) => {
      if (accountFilter && c.userId !== accountFilter) return false
      if (!q) return true
      return c.title.toLowerCase().includes(q) || c.account.toLowerCase().includes(q)
    })
  }, [snap, search, accountFilter])

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border/70 bg-card/60 p-4">
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Filter className="h-3.5 w-3.5" /> Nouvelle règle
          </h3>
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void load()}>
            <RefreshCw className="h-3 w-3" /> Actualiser
          </Button>
        </header>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_1.4fr_1.2fr_auto]">
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Compte</span>
            <select value={scope} onChange={(e) => { setScope(e.target.value); setPreview(null) }} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option value="">Tous les comptes</option>
              {snap?.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Règle</span>
            <select value={kind} onChange={(e) => { setKind(e.target.value as 'all' | 'keyword'); setPreview(null) }} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option value="keyword">Contient un mot-clé</option>
              <option value="all">Toutes les conversations</option>
            </select>
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Mot-clé</span>
            <Input value={pattern} disabled={kind === 'all'} onChange={(e) => { setPattern(e.target.value); setPreview(null) }} placeholder={kind === 'all' ? '—' : 'ex. test, brouillon, mot de passe…'} className="h-9 text-xs" />
          </label>
          <label className="space-y-1 text-xs">
            <span className="text-muted-foreground">Effet</span>
            <select value={action} onChange={(e) => setAction(e.target.value as 'exclude' | 'hide')} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
              <option value="exclude">Exclure de l’entraînement</option>
              <option value="hide">Masquer dans le dashboard</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <Button size="sm" variant="outline" className="h-9 gap-1.5" disabled={!!busy} onClick={() => void doPreview()}>
              {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Aperçu
            </Button>
            <Button size="sm" className="h-9 gap-1.5" disabled={!!busy} onClick={() => void addRule()}>
              {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Ajouter
            </Button>
          </div>
        </div>
        {preview !== null ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Cette règle concerne <strong className="text-foreground">{preview}</strong> conversation(s) parmi les plus récentes.
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-border/70 bg-card/60 p-4">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Règles actives ({snap?.rules.length ?? 0})</h3>
          {snap ? (
            <div className="flex gap-2 text-[11px] text-muted-foreground">
              <span>{snap.totals.all} conversation(s)</span>
              <span>· {snap.totals.excluded} exclue(s)</span>
              <span>· {snap.totals.hidden} masquée(s)</span>
            </div>
          ) : null}
        </header>
        {!snap || snap.rules.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune règle. Les conversations de tous les comptes entrent dans l’entraînement.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {snap.rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 text-xs">
                  <p className={cn('truncate', !r.enabled && 'text-muted-foreground line-through')}>{r.description}</p>
                  <p className="text-[10px] text-muted-foreground">{r.hits} déclenchement(s)</p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={r.enabled} onCheckedChange={(v) => void mutate({ action: 'toggle', id: r.id, enabled: v }, '')} />
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-300" onClick={() => void mutate({ action: 'remove', id: r.id }, 'Règle supprimée')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border/70 bg-card/60 p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Conversations récentes</h3>
          <div className="flex flex-wrap gap-2">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 w-44 text-xs" />
            <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
              <option value="">Tous les comptes</option>
              {snap?.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        </header>
        {visibleConvs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune conversation à afficher.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-semibold">Titre</th>
                  <th className="py-2 pr-3 font-semibold">Compte</th>
                  <th className="py-2 pr-3 font-semibold">Messages</th>
                  <th className="py-2 pr-3 font-semibold">Statut</th>
                  <th className="py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibleConvs.map((c) => (
                  <tr key={c.id} className={cn(c.hidden && 'opacity-60')}>
                    <td className="max-w-[260px] truncate py-2 pr-3">{c.title || '(sans titre)'}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.account}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{c.messages}</td>
                    <td className="py-2 pr-3">
                      <div className="flex gap-1">
                        {c.excluded ? <Badge variant="outline" className="text-[10px]">exclue</Badge> : null}
                        {c.hidden ? <Badge variant="outline" className="text-[10px]">masquée</Badge> : null}
                        {!c.excluded && !c.hidden ? <span className="text-[10px] text-muted-foreground">dans l’entraînement</span> : null}
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={c.excluded} onClick={() => void convAction(c, 'exclude')}>
                          <Ban className="h-3 w-3" /> Exclure
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px]" disabled={c.hidden} onClick={() => void convAction(c, 'hide')}>
                          <EyeOff className="h-3 w-3" /> Masquer
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-[11px] text-rose-300" onClick={() => void deleteConv(c)}>
                          <Trash2 className="h-3 w-3" /> Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[10px] text-muted-foreground">
          « Exclure » retire la conversation de l’entraînement du modèle maison. « Masquer » la range dans le dashboard sans la supprimer.
          « Supprimer » efface la conversation de la base (irréversible).
        </p>
      </section>
    </div>
  )
}
