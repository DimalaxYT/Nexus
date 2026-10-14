'use client'

// ─── NEXUS — Agent Dev ───────────────────────────────────────────────────────
// Le seul agent qui a accès au code. Il lit les vrais fichiers, diagnostique,
// et dépose des correctifs à valider dans l'onglet Correctifs.

import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Bot,
  Cpu,
  FileCode2,
  Lightbulb,
  Loader2,
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

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  thoughts?: string[]
  files?: { path: string; note?: string }[]
  patch?: { id?: string; title: string; filePath: string }
  tasks?: { id?: string; title: string }[]
  intent?: string
}

const SUGGESTIONS = [
  { icon: Search, label: 'Fais un audit complet du projet', text: 'fais un audit complet du projet' },
  { icon: Sparkles, label: 'Améliore l’intelligence', text: 'comment améliorer l’intelligence de NEXUS ?' },
  { icon: Terminal, label: 'Où est gérée l’authentification ?', text: 'où est gérée l’authentification ?' },
  { icon: Cpu, label: 'Optimise les performances', text: 'optimise les performances du projet' },
  { icon: Wrench, label: 'Explique le fonctionnement du cerveau', text: 'explique-moi comment fonctionne le cerveau' },
]

export function DevAgentPanel() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: 'assistant',
      content:
        '**Dev, l’ingénieur interne de NEXUS.** Je lis le code réel du projet, je diagnostique et je te propose des correctifs à valider.\n\n' +
        'Je suis le seul agent à avoir accès aux sources — et uniquement depuis ce compte. Dis-moi ce que tu veux améliorer.',
    },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement | null>(null)

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
          patch?: { id?: string; title: string; filePath: string }
          tasks?: { id?: string; title: string }[]
          intent?: string
        }
        if (!res.ok || !data.ok) {
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
            tasks: data.tasks ?? [],
            intent: data.intent,
          },
        ])
        if (data.patch) toast.success('Correctif prêt — onglet Correctifs')
      } catch {
        toast.error('Réseau indisponible')
      } finally {
        setBusy(false)
        scrollDown()
      }
    },
    [busy, messages, scrollDown]
  )

  const stats = useMemo(() => {
    const patches = messages.filter((m) => m.patch).length
    const files = new Set(messages.flatMap((m) => (m.files ?? []).map((f) => f.path))).size
    return { patches, files }
  }, [messages])

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* En-tête */}
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-500 to-neutral-600 text-white shadow-lg shadow-neutral-500/25">
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
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-neutral-500 to-neutral-600 text-white">
                <Bot className="h-4 w-4" />
              </span>
            )}
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-3 text-sm',
                m.role === 'user'
                  ? 'bg-neutral-500/15 text-foreground'
                  : 'border border-border/70 bg-card/70 text-foreground'
              )}
            >
              {m.role === 'assistant' && m.thoughts && m.thoughts.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {m.thoughts.map((t, j) => (
                    <span
                      key={j}
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-500/30 bg-neutral-500/10 px-2 py-0.5 text-[10px] text-neutral-300"
                    >
                      <Lightbulb className="h-2.5 w-2.5" />
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div className="prose prose-invert max-w-none prose-sm prose-pre:rounded-lg prose-pre:bg-black/40 prose-headings:mb-2 prose-headings:mt-3 first:prose-headings:mt-0">
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
                      {f.note ? <span className="text-neutral-400/80">· {f.note}</span> : null}
                    </span>
                  ))}
                </div>
              )}

              {m.patch && (
                <div className="mt-3 rounded-lg border border-neutral-500/30 bg-neutral-500/10 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-300">
                    Correctif à valider
                  </p>
                  <p className="mt-1 text-sm font-medium text-foreground">{m.patch.title}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{m.patch.filePath}</p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Ouvre l’onglet <span className="text-neutral-300">Correctifs</span> pour le relire et l’appliquer.
                  </p>
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
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-neutral-500/40 hover:text-foreground"
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
            placeholder="« apprends à NEXUS que… », « où est géré… », « optimise… »"
            className="min-h-[52px] max-h-40 flex-1 resize-none"
            disabled={busy}
          />
          <Button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            size="icon"
            className="h-[52px] w-[52px] shrink-0 bg-neutral-500 hover:bg-neutral-500"
            aria-label="Envoyer"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
