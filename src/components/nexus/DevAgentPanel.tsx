'use client'

// ─── NEXUS — Agent Dev ───────────────────────────────────────────────────────
// Le seul agent qui a accès au code. Il lit les vrais fichiers, diagnostique,
// et dépose des correctifs à valider dans l'onglet Correctifs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Bot,
  Check,
  Cpu,
  FileCode2,
  Lightbulb,
  Loader2,
  Moon,
  Play,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/nexus/Markdown'

interface ChatPatch {
  id?: string
  title: string
  filePath: string
  rationale?: string
}

interface AppliedPatch {
  id: string
  title: string
  filePath: string
  ok: boolean
  backup?: string
  created?: boolean
  error?: string
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  thoughts?: string[]
  files?: { path: string; note?: string }[]
  patch?: ChatPatch
  patches?: ChatPatch[]
  applied?: AppliedPatch[]
  tasks?: { id?: string; title: string }[]
  intent?: string
}

const SUGGESTIONS = [
  { icon: Search, label: 'Fais un audit complet du projet', text: 'fais un audit complet du projet' },
  { icon: Sparkles, label: 'Améliore l’intelligence', text: 'comment améliorer l’intelligence de NEXUS ?' },
  { icon: Terminal, label: 'Où est gérée l’authentification ?', text: 'où est gérée l’authentification ?' },
  { icon: Cpu, label: 'Optimise les performances', text: 'optimise les performances du projet' },
  { icon: Wrench, label: 'Répare les imports inutilisés du projet', text: 'corrige les imports inutilisés dans src/' },
  { icon: Moon, label: 'Répare le thème clair/sombre', text: 'corrige le thème, il est bloqué en clair et on ne peut pas passer en mode sombre' },
  { icon: Wrench, label: 'Que sais-tu faire sur le code ?', text: 'que peux-tu faire ?' },
]

export function DevAgentPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      content:
        '**Dev, l’ingénieur interne de NEXUS.** Je lis le code réel du projet et je le modifie sur ta demande.\n\n' +
        'Écris une modification précise : « remplace "ancien" par "nouveau" dans src/lib/fichier.ts », ' +
        '« renomme `oldName` en `newName` », « ajoute "…" après "…" », ou « nettoie les console.log dans tout le projet ».\n\n' +
        'Tu peux aussi demander une **réparation** sans connaître l’ancre : « corrige les imports inutilisés dans src/lib/devfs.ts », ' +
        '« améliore `safePath` », « sécurise les liens target=\"_blank\" ». J’inspecte la cible et je corrige les défauts réels que j’y trouve.\n\n' +
        'Une demande peut contenir **plusieurs instructions** (« … puis … et … ») : je produis un correctif par fichier.\n\n' +
        'Je peux produire **plusieurs correctifs** (un par fichier), les appliquer d’un bloc, ou les écrire directement si tu ajoutes **« et applique »**.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [applying, setApplying] = useState<string | null>(null)
  const [appliedIds, setAppliedIds] = useState<Set<string>>(() => new Set())
  const scroller = useRef<HTMLDivElement | null>(null)

  // Les correctifs déjà appliqués (depuis l'onglet Correctifs, une autre
  // session ou un tour précédent) ne doivent pas proposer « Appliquer ».
  useEffect(() => {
    let alive = true
    fetch('/api/dev/patches?light=1', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { patches?: { id: string; status: string }[] } | null) => {
        if (!alive || !data?.patches) return
        const applied = data.patches.filter((p) => p.status === 'applique').map((p) => p.id)
        if (applied.length) setAppliedIds(new Set(applied))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const scrollDown = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scroller.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || busy) return
      setInput('')
      const history = messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))
      setMessages((prev) => [...prev, { role: 'user', content }])
      setBusy(true)
      scrollDown()
      try {
        const res = await fetch('/api/dev/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: content, history }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          reply?: string
          thoughts?: string[]
          files?: { path: string; note?: string }[]
          patch?: ChatPatch
          patches?: ChatPatch[]
          applied?: AppliedPatch[]
          tasks?: { id?: string; title: string }[]
          intent?: string
        }
        if (!res.ok || !data.ok) {
          if (res.status === 401) window.dispatchEvent(new Event('nexus:unauthorized'))
          toast.error(data.error ?? 'Analyse impossible')
          setMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `**Incident** — ${data.error ?? 'analyse impossible'}` },
          ])
          return
        }
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply ?? '',
            thoughts: data.thoughts ?? [],
            files: data.files ?? [],
            patch: data.patch,
            patches: data.patches ?? (data.patch ? [data.patch] : []),
            applied: data.applied ?? [],
            tasks: data.tasks ?? [],
            intent: data.intent,
          },
        ])
        if (data.applied?.length) {
          const ok = data.applied.filter((r) => r.ok).length
          const failed = data.applied.length - ok
          if (ok) toast.success(`${ok} correctif(s) appliqué(s) et sauvegardé(s)`)
          if (failed) toast.error(`${failed} correctif(s) n’ont pas pu être appliqués`)
          for (const r of data.applied) if (r.ok) setAppliedIds((prev) => new Set(prev).add(r.id))
        } else if (data.patches?.length) {
          toast.success(
            data.patches.length > 1
              ? `${data.patches.length} correctifs prêts — applique-les ici ou dans l’onglet Correctifs`
              : 'Correctif prêt — applique-le ici ou dans l’onglet Correctifs'
          )
        }
      } catch {
        toast.error('Réseau indisponible')
      } finally {
        setBusy(false)
        scrollDown()
      }
    },
    [busy, messages, scrollDown]
  )

  const applyPatches = useCallback(
    async (patches: ChatPatch[]) => {
      const ids = patches.map((p) => p.id).filter((id): id is string => Boolean(id))
      if (!ids.length) {
        toast.error('Ces correctifs n’ont pas d’identifiant : ils n’ont pas été enregistrés.')
        return
      }
      const key = ids.join(',')
      setApplying(key)
      try {
        const res = await fetch('/api/dev/patches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply', ids }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          applied?: number
          failed?: number
          results?: AppliedPatch[]
          backup?: string
        }
        if (!res.ok || data.error) {
          toast.error(data.error ?? 'Application impossible')
          return
        }
        const results = data.results ?? []
        const ok = results.filter((r) => r.ok)
        const failed = results.filter((r) => !r.ok)
        if (ok.length) {
          setAppliedIds((prev) => {
            const next = new Set(prev)
            for (const r of ok) next.add(r.id)
            return next
          })
          toast.success(`${ok.length} correctif(s) appliqué(s) — sauvegarde effectuée`)
        }
        for (const r of failed) toast.error(`${r.title || r.filePath} : ${r.error ?? 'échec'}`)
        if (!results.length && data.ok) {
          const only = patches[0]?.id
          if (only) setAppliedIds((prev) => new Set(prev).add(only))
          toast.success(`Correctif appliqué${data.backup ? ' — sauvegarde effectuée' : ''}`)
        }
      } catch {
        toast.error('Réseau indisponible')
      } finally {
        setApplying(null)
      }
    },
    []
  )

  const stats = useMemo(() => {
    const patches = messages.reduce((n, m) => n + (m.patches?.length ?? (m.patch ? 1 : 0)), 0)
    const files = new Set(messages.flatMap((m) => (m.files ?? []).map((f) => f.path))).size
    return { patches, files }
  }, [messages])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* En-tête */}
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/85 text-primary-foreground shadow-lg shadow-primary/25">
            <Terminal className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-foreground">Agent Dev</p>
            <p className="text-[11px] text-muted-foreground">
              Accès au code · {stats.files} fichier(s) consulté(s) · {stats.patches} correctif(s)
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex gap-3', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            {m.role === 'assistant' && (
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
                <Bot className="h-4 w-4" />
              </span>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                m.role === 'user'
                  ? 'bg-primary/15 text-foreground'
                  : 'border border-border/70 bg-card/70 text-foreground'
              )}
            >
              {m.role === 'assistant' && m.thoughts && m.thoughts.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {m.thoughts.map((t, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] text-foreground/80"
                    >
                      <Lightbulb className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="prose max-w-none prose-sm dark:prose-invert prose-pre:rounded-lg prose-pre:bg-muted/60 prose-headings:mb-2 prose-headings:mt-3 first:prose-headings:mt-0">
                <Markdown content={m.content} />
              </div>

              {m.files && m.files.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
                  {m.files.slice(0, 8).map((f, j) => (
                    <span
                      key={j}
                      title={f.note}
                      className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      <FileCode2 className="h-2.5 w-2.5" />
                      {f.path}
                      {f.note ? <span className="text-muted-foreground/80">· {f.note}</span> : null}
                    </span>
                  ))}
                </div>
              )}

              {(() => {
                const patches = m.patches ?? (m.patch ? [m.patch] : [])
                if (!patches.length) return null
                const pending = patches.filter((p) => !p.id || !appliedIds.has(p.id))
                const key = pending.map((p) => p.id).filter(Boolean).join(',')
                return (
                  <div className="mt-3 space-y-2.5 rounded-lg border border-primary/30 bg-primary/10 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">
                        {patches.length > 1 ? `${patches.length} correctifs` : 'Correctif'} à valider
                      </p>
                      {pending.length > 1 ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-primary/40 text-[11px]"
                          onClick={() => void applyPatches(pending)}
                          disabled={applying === key}
                        >
                          {applying === key ? (
                            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                          ) : (
                            <Play className="mr-1.5 h-3 w-3" />
                          )}
                          Tout appliquer
                        </Button>
                      ) : null}
                    </div>
                    {patches.map((p, j) => {
                      const done = Boolean(p.id && appliedIds.has(p.id))
                      return (
                        <div
                          key={p.id ?? `${p.filePath}-${j}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-background/30 px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12px] font-medium text-foreground">{p.title}</p>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">{p.filePath}</p>
                          </div>
                          {done ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                              <Check className="h-3 w-3" /> appliqué
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              className="h-7 bg-primary text-[11px] hover:bg-primary/90"
                              onClick={() => void applyPatches([p])}
                              disabled={applying === (p.id ?? key)}
                            >
                              {applying === (p.id ?? key) ? (
                                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                              ) : (
                                <Play className="mr-1.5 h-3 w-3" />
                              )}
                              Appliquer
                            </Button>
                          )}
                        </div>
                      )
                    })}
                    <p className="text-[10px] text-muted-foreground">
                      Sauvegarde automatique avant écriture · diff complet dans l’onglet{' '}
                      <span className="text-foreground/80">Correctifs</span>.
                    </p>
                  </div>
                )
              })()}

              {m.applied && m.applied.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Résultat de l’application
                  </p>
                  {m.applied.map((r, j) => (
                    <p key={`${r.id}-${j}`} className="text-[11px] text-foreground/80">
                      {r.ok ? (
                        <span className="text-emerald-700 dark:text-emerald-300">✓</span>
                      ) : (
                        <span className="text-rose-600 dark:text-rose-300">✕</span>
                      )}{' '}
                      {r.title || r.filePath}
                      {r.ok && r.backup ? (
                        <span className="text-muted-foreground">
                          {' '}· sauvegarde <span className="font-mono text-[10px]">{r.backup}</span>
                        </span>
                      ) : null}
                      {!r.ok && r.error ? <span className="text-rose-600 dark:text-rose-300"> · {r.error}</span> : null}
                    </p>
                  ))}
                </div>
              )}

              {m.tasks && m.tasks.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/50 pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ajouté à la file d’améliorations
                  </p>
                  {m.tasks.map((t, j) => (
                    <p key={j} className="text-[11px] text-foreground/80">
                      • {t.title}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Lecture du code et analyse…
          </div>
        )}
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {SUGGESTIONS.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.label}
                onClick={() => void send(s.text)}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Icon className="h-3 w-3" />
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Saisie */}
      <div className="border-t border-border/70 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            placeholder={'« remplace "ancien" par "nouveau" dans src/lib/x.ts », « renomme old en new », « applique tout »…'}
            className="min-h-[52px] max-h-40 flex-1 resize-none"
            disabled={busy}
          />
          <Button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            size="icon"
            className="h-[52px] w-[52px] shrink-0 bg-primary hover:bg-primary/90"
            aria-label="Envoyer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
