'use client'

import { useState } from 'react'
import {
  Bot,
  Camera,
  ExternalLink,
  Globe,
  Lock,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { BrowsedPage, SourceItem } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

/**
 * Panneau « Navigateur » :
 * — Onglet « Ma navigation » : un navigateur intégré où l'utilisateur peut ouvrir
 *   ses comptes (les sites qui refusent l'affichage intégré s'ouvrent dans un onglet).
 * — Onglet « Ce que voit NEXUS » : les pages réellement lues par l'agent, en
 *   CAPTURES D'ÉCRAN RÉELLES (chromium serveur) — l'utilisateur voit exactement
 *   ce que l'agent voit, pas seulement le texte.
 */
export function BrowserPanel({
  open,
  onOpenChange,
  pages,
  sources,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pages: BrowsedPage[]
  sources: SourceItem[]
}) {
  const [tab, setTab] = useState<'mine' | 'agent'>('mine')
  const [urlInput, setUrlInput] = useState('https://')
  const [frameUrl, setFrameUrl] = useState('')
  const [frameKey, setFrameKey] = useState(0)
  const [reading, setReading] = useState<string | null>(null)
  const [readingTitle, setReadingTitle] = useState('')
  const [readingText, setReadingText] = useState('')
  const [readingShot, setReadingShot] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState<string | null>(null)

  const navigate = (raw: string) => {
    let url = raw.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url
    try {
      new URL(url)
    } catch {
      toast.error('URL invalide')
      return
    }
    setUrlInput(url)
    setFrameUrl(url)
    setFrameKey((k) => k + 1)
  }

  /** Lit une page via le navigateur serveur de NEXUS (capture d'écran + texte). */
  const readWithAgent = async (url: string) => {
    setTab('agent')
    setReading(url)
    setReadingTitle('Chargement…')
    setReadingText('')
    setReadingShot(null)
    try {
      const res = await fetch('/api/tools/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Lecture impossible')
      setReadingTitle(data.title || url)
      setReadingText(data.text || '')
      setReadingShot(data.screenshot ?? null)
    } catch (err) {
      setReadingTitle(url)
      setReadingText('')
      toast.error(err instanceof Error ? err.message : 'Lecture impossible')
    } finally {
      setReading(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border/70 px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Globe className="h-4 w-4 text-sky-400" />
            Navigateur
          </SheetTitle>
          <SheetDescription className="text-xs">
            Surfez avec vos comptes ou voyez EN IMAGE les pages que NEXUS visite.
          </SheetDescription>
        </SheetHeader>

        {/* Onglets */}
        <div className="flex gap-1 border-b border-border/70 px-3 py-2">
          <button
            onClick={() => setTab('mine')}
            aria-selected={tab === 'mine'}
            role="tab"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'mine' ? 'bg-accent text-sky-300' : 'text-muted-foreground hover:bg-accent/60'
            )}
          >
            <User className="h-3.5 w-3.5" />
            Ma navigation
          </button>
          <button
            onClick={() => setTab('agent')}
            aria-selected={tab === 'agent'}
            role="tab"
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
              tab === 'agent' ? 'bg-accent text-violet-300' : 'text-muted-foreground hover:bg-accent/60'
            )}
          >
            <Bot className="h-3.5 w-3.5" />
            Ce que voit NEXUS
          </button>
        </div>

        {tab === 'mine' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-border/70 p-3">
              <Input
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(urlInput)}
                placeholder="https://exemple.com"
                className="h-9 border-border bg-muted/50 text-sm"
                aria-label="Adresse du site"
              />
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9 shrink-0 border-border hover:bg-accent"
                onClick={() => setFrameKey((k) => k + 1)}
                aria-label="Recharger la page"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-9 shrink-0 gap-1.5 border-border text-xs hover:bg-accent"
                onClick={() => frameUrl && window.open(frameUrl, '_blank', 'noopener')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Onglet
              </Button>
            </div>

            {frameUrl ? (
              <iframe
                key={frameKey}
                src={frameUrl}
                title="Navigateur intégré"
                className="min-h-0 flex-1 bg-white"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                <Globe className="h-8 w-8 text-muted-foreground/60" />
                <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                  Entrez une adresse pour naviguer. Vos connexions et identifiants restent
                  dans <strong>votre navigateur</strong> — NEXUS n&apos;y a jamais accès.
                </p>
                <p className="flex max-w-xs items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-left text-[11px] leading-relaxed text-amber-200/90">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Certains sites (Google, YouTube…) refusent l&apos;affichage intégré :
                  utilisez alors le bouton « Onglet » pour les ouvrir normalement.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
            <div className="flex items-start gap-2 border-b border-border/70 bg-violet-500/5 p-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-violet-400" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Captures d&apos;écran réelles prises par le navigateur serveur de NEXUS
                (chromium headless, sans vos cookies ni vos sessions). Cliquez sur une
                image pour l&apos;agrandir, ou sur une source pour que NEXUS la visite.
              </p>
            </div>

            {/* Sources récentes cliquables */}
            {sources.length > 0 && (
              <div className="border-b border-border/70 p-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Sources de la conversation
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {sources.slice(0, 8).map((s) => (
                    <button
                      key={s.url}
                      onClick={() => readWithAgent(s.url)}
                      className="max-w-full truncate rounded-full border border-border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-violet-500/50 hover:text-violet-300"
                    >
                      {s.domain}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Page en cours de lecture (capture + texte) */}
            {(reading || readingText || readingShot) && (
              <div className="border-b border-border/70 p-3">
                <p className="mb-2 truncate text-xs font-semibold text-foreground">{readingTitle}</p>
                {reading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Camera className="h-3.5 w-3.5 animate-pulse text-violet-400" />
                    NEXUS visite la page (capture d&apos;écran en cours)…
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {readingShot && (
                      <button
                        onClick={() => setZoomed(readingShot)}
                        className="group relative overflow-hidden rounded-lg border border-border"
                        title="Cliquer pour agrandir"
                      >
                        <img
                          src={readingShot}
                          alt={`Capture de ${readingTitle}`}
                          className="max-h-64 w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
                        />
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                          Agrandir
                        </span>
                      </button>
                    )}
                    {readingText && (
                      <details>
                        <summary className="cursor-pointer text-[11px] font-semibold text-violet-300">
                          Texte extrait par NEXUS
                        </summary>
                        <pre className="mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-foreground/80" style={{ scrollbarWidth: 'thin' }}>
                          {readingText}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Journal des pages visitées par l'agent — captures d'écran réelles */}
            <div className="flex-1 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Pages visitées par l&apos;agent
              </p>
              {pages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted-foreground/70">
                  Aucune page visitée pour l&apos;instant — demandez à NEXUS de lire une page web.
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {pages.map((p, i) => (
                    <li key={`${p.url}-${i}`} className="overflow-hidden rounded-xl border border-border bg-muted/40">
                      {p.screenshot ? (
                        <button
                          onClick={() => setZoomed(p.screenshot!)}
                          className="group relative block w-full"
                          title="Cliquer pour agrandir"
                        >
                          <img
                            src={p.screenshot}
                            alt={`Capture de ${p.title}`}
                            className="max-h-56 w-full object-cover object-top transition-transform group-hover:scale-[1.02]"
                          />
                          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            Agrandir
                          </span>
                        </button>
                      ) : (
                        <div className="flex h-24 items-center justify-center gap-2 bg-muted/60 text-xs text-muted-foreground/60">
                          <Camera className="h-4 w-4" />
                          Capture indisponible
                        </div>
                      )}
                      <div className="p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-xs font-medium text-foreground">{p.title}</p>
                          <button
                            onClick={() => readWithAgent(p.url)}
                            className="shrink-0 text-[10px] font-semibold text-violet-300 hover:text-violet-200"
                          >
                            Revisiter
                          </button>
                        </div>
                        <p className="truncate text-[10px] text-muted-foreground/70">{p.url}</p>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-[10px] font-semibold text-muted-foreground hover:text-violet-300">
                            Texte vu par NEXUS
                          </summary>
                          <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] leading-snug text-muted-foreground" style={{ scrollbarWidth: 'thin' }}>
                            {p.text}
                          </p>
                        </details>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Visionneuse plein écran */}
        {zoomed && (
          <div
            role="dialog"
            aria-label="Capture d'écran agrandie"
            className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
            onClick={() => setZoomed(null)}
          >
            <img
              src={zoomed}
              alt="Capture d'écran plein écran"
              className="max-h-full max-w-full rounded-lg border border-white/10 object-contain shadow-2xl"
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
