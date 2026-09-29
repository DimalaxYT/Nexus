'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  Inbox,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { useNexusStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { parseKnowledgeRow, type KnowledgeItem, type MemoryItem } from '@/lib/nexus-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return "à l'instant"
  if (min < 60) return `il y a ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

// ─── Panneau historique des conversations ────────────────────────────────────

export function HistoryPanel({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const {
    conversations,
    activeConversationId,
    setActiveConversation,
    createConversation,
    updateConversation,
    deleteConversation,
  } = useNexusStore()

  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    )
  }, [conversations, query])

  const startRename = (id: string, current: string) => {
    setEditingId(id)
    setEditValue(current)
  }

  const commitRename = () => {
    if (editingId) {
      const title = editValue.trim().slice(0, 80) || 'Sans titre'
      updateConversation(editingId, (c) => ({ ...c, title }))
    }
    setEditingId(null)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="flex w-full flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b border-border px-4 pb-3 pt-4">
          <SheetTitle className="text-base">Historique</SheetTitle>
          <SheetDescription className="text-xs">
            Vos conversations sont sauvegardées automatiquement.
          </SheetDescription>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher…"
              aria-label="Rechercher dans les conversations"
              className="h-9 border-border bg-muted/60 pl-8 text-sm"
            />
          </div>
          <Button
            size="icon"
            className="h-9 w-9 shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
            onClick={() => {
              createConversation()
              onOpenChange(false)
            }}
            aria-label="Nouvelle conversation"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {query ? 'Aucun résultat pour cette recherche.' : 'Aucune conversation pour le moment.'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((c) => {
                const active = c.id === activeConversationId
                return (
                  <li key={c.id}>
                    <div
                      className={cn(
                        'group flex items-center gap-1 rounded-lg px-2.5 py-2 transition-colors',
                        active ? 'bg-violet-500/15' : 'hover:bg-accent/60'
                      )}
                    >
                      {editingId === c.id ? (
                        <>
                          <Input
                            autoFocus
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                            className="h-7 border-border bg-background text-sm"
                            aria-label="Nouveau titre"
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-emerald-400 hover:text-emerald-300"
                            onClick={commitRename}
                            aria-label="Valider le renommage"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <button
                            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                            onClick={() => {
                              setActiveConversation(c.id)
                              onOpenChange(false)
                            }}
                          >
                            <MessageSquare
                              className={cn(
                                'h-4 w-4 shrink-0',
                                active ? 'text-violet-400' : 'text-muted-foreground/60'
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">
                                {c.title}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                {formatRelative(c.updatedAt)} · {c.messages.length} message
                                {c.messages.length > 1 ? 's' : ''}
                              </span>
                            </span>
                          </button>
                          <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => startRename(c.id, c.title)}
                              aria-label="Renommer la conversation"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                              onClick={() => {
                                deleteConversation(c.id)
                                toast.success('Conversation supprimée')
                              }}
                              aria-label="Supprimer la conversation"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Panneau mémoire longue terme ────────────────────────────────────────────

const KIND_META: Record<MemoryItem['kind'], { label: string; className: string }> = {
  fact: { label: 'Fait', className: 'bg-sky-500/15 text-sky-300' },
  preference: { label: 'Préférence', className: 'bg-violet-500/15 text-violet-300' },
  project: { label: 'Projet', className: 'bg-amber-500/15 text-amber-300' },
  person: { label: 'Personne', className: 'bg-rose-500/15 text-rose-300' },
  other: { label: 'Autre', className: 'bg-zinc-500/15 text-zinc-300' },
}

export function MemoryPanel({
  open,
  onOpenChange,
  memories,
  onRefresh,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  memories: MemoryItem[]
  onRefresh: () => void
}) {
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const addMemory = async () => {
    const content = draft.trim()
    if (!content || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, kind: 'fact', source: 'manual' }),
      })
      const data = (await res.json()) as { duplicate?: boolean }
      if (data.duplicate) {
        toast.info('Cette information est déjà en mémoire')
      } else {
        toast.success('Mémoire ajoutée')
        setDraft('')
      }
      onRefresh()
    } catch {
      toast.error("Impossible d'ajouter la mémoire")
    } finally {
      setAdding(false)
    }
  }

  const removeMemory = async (id: string) => {
    try {
      await fetch(`/api/memory?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      onRefresh()
      toast.success('Mémoire supprimée')
    } catch {
      toast.error('Suppression impossible')
    }
  }

  const clearAll = async () => {
    try {
      await fetch('/api/memory?all=1', { method: 'DELETE' })
      onRefresh()
      toast.success('Mémoire effacée')
    } catch {
      toast.error('Effacement impossible')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4.5 w-4.5 text-violet-400" />
            Mémoire de NEXUS
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-300">
              {memories.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            NEXUS retient automatiquement vos informations importantes entre les
            conversations. Vous pouvez aussi les gérer ici.
          </DialogDescription>
        </DialogHeader>

        {/* Ajout manuel */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addMemory()
            }}
            placeholder="Ex : Je m'appelle Thomas, je travaille sur une fusée…"
            aria-label="Nouvelle information à mémoriser"
            className="h-9 border-border bg-muted/60 text-sm"
          />
          <Button
            size="sm"
            className="h-9 shrink-0 bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
            disabled={!draft.trim() || adding}
            onClick={addMemory}
          >
            <Plus className="h-4 w-4" />
            Ajouter
          </Button>
        </div>

        {/* Liste */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {memories.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Brain className="h-9 w-9 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                La mémoire est vide. Discutez avec NEXUS — il retiendra
                automatiquement les informations importantes.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {memories.map((m) => {
                const meta = KIND_META[m.kind] ?? KIND_META.other
                return (
                  <li
                    key={m.id}
                    className="group flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5"
                  >
                    <span
                      className={cn(
                        'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        meta.className
                      )}
                    >
                      {meta.label}
                    </span>
                    <p className="min-w-0 flex-1 text-sm leading-snug text-foreground/90">
                      {m.content}
                    </p>
                    <button
                      onClick={() => removeMemory(m.id)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-all hover:text-rose-400 group-hover:opacity-100"
                      aria-label="Supprimer cette mémoire"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {memories.length > 0 && (
          <div className="border-t border-border px-5 py-3">
            <Button
              variant="outline"
              size="sm"
              className="h-8 border-border text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              onClick={clearAll}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Tout effacer
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ─── Panneau base de connaissances hiérarchique ──────────────────────────────

interface KNode {
  name: string
  path: string
  children: KNode[]
  items: KnowledgeItem[]
}

function buildKnowledgeTree(items: KnowledgeItem[]): KNode {
  const root: KNode = { name: '', path: '', children: [], items: [] }
  for (const item of items) {
    const parts = item.category.split('/').map((p) => p.trim()).filter(Boolean)
    let node = root
    let path = ''
    for (const part of parts) {
      path = path ? `${path}/${part}` : part
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path, children: [], items: [] }
        node.children.push(child)
      }
      node = child
    }
    node.items.push(item)
  }
  const sortNode = (n: KNode) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name))
    n.items.sort((a, b) => b.updatedAt - a.updatedAt)
    n.children.forEach(sortNode)
  }
  sortNode(root)
  return root
}

interface EditorState {
  id: string | null
  title: string
  category: string
  tags: string
  links: string
  content: string
}

const EMPTY_EDITOR: EditorState = { id: null, title: '', category: 'Général', tags: '', links: '', content: '' }

export function KnowledgePanel({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onChanged: () => void
}) {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<EditorState | null>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/knowledge')
      const data = (await res.json()) as { items?: KnowledgeItem[] }
      setItems(Array.isArray(data.items) ? data.items : [])
    } catch {
      /* liste inaccessible : on garde l'actuelle */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) refresh()
  }, [open, refresh])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (k) =>
        k.title.toLowerCase().includes(q) ||
        k.content.toLowerCase().includes(q) ||
        k.category.toLowerCase().includes(q) ||
        k.tags.some((t) => t.toLowerCase().includes(q))
    )
  }, [items, query])

  const tree = useMemo(() => buildKnowledgeTree(filtered), [filtered])

  // Déplie par défaut les dossiers de premier niveau
  useEffect(() => {
    if (open && expanded.size === 0) {
      setExpanded((prev) => {
        if (prev.size > 0) return prev
        const next = new Set<string>()
        for (const item of items) {
          const top = item.category.split('/')[0]?.trim()
          if (top) next.add(top)
        }
        return next
      })
    }
  }, [open, items, expanded.size])

  const toggleFolder = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const openNote = (item: KnowledgeItem) => {
    setEditing({
      id: item.id,
      title: item.title,
      category: item.category,
      tags: item.tags.join(', '),
      links: item.links.join(', '),
      content: item.content,
    })
  }

  const save = async () => {
    if (!editing || saving) return
    const title = editing.title.trim()
    const content = editing.content.trim()
    if (!title || !content) {
      toast.error('Le titre et le contenu sont requis')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editing.id,
          title,
          content,
          category: editing.category.trim() || 'Général',
          tags: editing.tags.split(',').map((t) => t.trim()).filter(Boolean),
          links: editing.links.split(',').map((t) => t.trim()).filter(Boolean),
          source: 'manual',
        }),
      })
      if (!res.ok) throw new Error()
      toast.success(editing.id ? 'Note mise à jour' : 'Note ajoutée à la base de connaissances')
      setEditing(null)
      await refresh()
      onChanged()
    } catch {
      toast.error("Enregistrement impossible")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try {
      await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (editing?.id === id) setEditing(null)
      toast.success('Note supprimée')
      await refresh()
      onChanged()
    } catch {
      toast.error('Suppression impossible')
    }
  }

  const renderNode = (node: KNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isOpen = expanded.has(node.path)
    return (
      <li key={node.path || 'root'}>
        {node.path && (
          <button
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium text-foreground/90 hover:bg-accent/60"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            onClick={() => toggleFolder(node.path)}
          >
            {hasChildren ? (
              isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              )
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-400/80" />
            <span className="min-w-0 flex-1 truncate">{node.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground/70">
              {countItems(node)}
            </span>
          </button>
        )}
        {isOpen && (
          <ul className="flex flex-col">
            {node.children.map((child) => renderNode(child, node.path ? depth + 1 : depth))}
            {node.items.map((item) => (
              <li key={item.id}>
                <div
                  className={cn(
                    'group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60',
                    editing?.id === item.id && 'bg-emerald-500/10'
                  )}
                  style={{ paddingLeft: `${8 + (node.path ? depth + 1 : depth) * 14}px` }}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => openNote(item)}
                  >
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-emerald-400/80" />
                    <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/85">
                      {item.title}
                    </span>
                    {item.source === 'agent' && (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 text-[9px] font-semibold uppercase text-emerald-300">
                        IA
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => remove(item.id)}
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground/40 opacity-0 transition-all hover:text-rose-400 group-hover:opacity-100"
                    aria-label={`Supprimer la note ${item.title}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setEditing(null) }}>
      <DialogContent className="flex max-h-[88dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4.5 w-4.5 text-emerald-400" />
            Base de connaissances
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
              {items.length}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            Vos notes organisées en dossiers hiérarchiques, reliées entre elles. NEXUS
            l’enrichit automatiquement quand vous dites « retiens ça ».
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {editing ? (
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-1.5 border-border text-xs"
              onClick={() => setEditing(null)}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Retour
            </Button>
          ) : (
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher un concept, un tag…"
                aria-label="Rechercher dans la base de connaissances"
                className="h-9 border-border bg-muted/60 pl-8 text-sm"
              />
            </div>
          )}
          {!editing && (
            <Button
              size="sm"
              className="h-9 shrink-0 bg-gradient-to-br from-emerald-500 to-teal-500 text-white hover:opacity-90"
              onClick={() => setEditing({ ...EMPTY_EDITOR })}
            >
              <Plus className="h-4 w-4" />
              Note
            </Button>
          )}
        </div>

        {editing ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-title">
                    Titre
                  </label>
                  <Input
                    id="kb-title"
                    value={editing.title}
                    onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                    placeholder="Ex : Bases de Python"
                    className="h-9 border-border bg-muted/60 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-category">
                    Catégorie (chemin hiérarchique)
                  </label>
                  <Input
                    id="kb-category"
                    value={editing.category}
                    onChange={(e) => setEditing({ ...editing, category: e.target.value })}
                    placeholder="Ex : Programmation/Python"
                    className="h-9 border-border bg-muted/60 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-tags">
                    Étiquettes (séparées par des virgules)
                  </label>
                  <Input
                    id="kb-tags"
                    value={editing.tags}
                    onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                    placeholder="Ex : python, code, tutoriel"
                    className="h-9 border-border bg-muted/60 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-links">
                    Notes liées (titres séparés par des virgules)
                  </label>
                  <Input
                    id="kb-links"
                    value={editing.links}
                    onChange={(e) => setEditing({ ...editing, links: e.target.value })}
                    placeholder="Ex : Bases de Python, Asyncio"
                    className="h-9 border-border bg-muted/60 text-sm"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="kb-content">
                  Contenu
                </label>
                <textarea
                  id="kb-content"
                  value={editing.content}
                  onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                  rows={10}
                  placeholder="Ce que vous voulez retenir et organiser…"
                  className="w-full resize-y rounded-lg border border-border bg-muted/60 p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50"
                />
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                {editing.id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 border-border text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => remove(editing.id as string)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Supprimer
                  </Button>
                ) : (
                  <span />
                )}
                <Button
                  size="sm"
                  className="h-9 gap-1.5 bg-gradient-to-br from-emerald-500 to-teal-500 text-white hover:opacity-90"
                  disabled={saving || !editing.title.trim() || !editing.content.trim()}
                  onClick={save}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Enregistrer
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Chargement…
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
                <Inbox className="h-9 w-9 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {query
                    ? 'Aucune note ne correspond à cette recherche.'
                    : 'Base de connaissances vide. Dites « retiens ça… » à NEXUS ou créez une note manuellement.'}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col">{tree.children.map((child) => renderNode(child, 0))}</ul>
            )}
          </div>
        )}

        {/* Notes liées de la note en cours d'édition (rappel visuel) */}
        {editing && editing.links.trim() && (
          <div className="border-t border-border px-5 py-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Link2 className="h-3 w-3" />
              Concepts liés
            </p>
            <div className="flex flex-wrap gap-1.5">
              {editing.links
                .split(',')
                .map((l) => l.trim())
                .filter(Boolean)
                .map((link) => {
                  const target = items.find((k) => k.title.toLowerCase() === link.toLowerCase())
                  return (
                    <button
                      key={link}
                      disabled={!target}
                      className={cn(
                        'rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] text-foreground/80',
                        target && 'hover:border-emerald-500/50 hover:text-emerald-300'
                      )}
                      onClick={() => target && openNote(target)}
                    >
                      {link}
                    </button>
                  )
                })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function countItems(node: KNode): number {
  return node.items.length + node.children.reduce((acc, c) => acc + countItems(c), 0)
}
