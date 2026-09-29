'use client'

// ─── NEXUS — Vue Cerveaux : JARVIS (cerveau central) ↔ salle multi-cerveaux ──
// Petit sélecteur au-dessus de la scène 3D. Jarvis est la vue par défaut :
// un cerveau central unique relié aux agents ; « Éclaté » montre un cerveau
// par agent (vue historique de la Round 13).

import { useState } from 'react'
import { Brain, Network } from 'lucide-react'
import { JarvisCanvas } from './JarvisBrain'
import { BrainCanvas } from './Brain3D'
import { cn } from '@/lib/utils'

export function BrainView({ compact = false }: { compact?: boolean }) {
  const [mode, setMode] = useState<'jarvis' | 'multi'>('jarvis')
  return (
    <div className="relative flex h-full w-full flex-col">
      <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-white/15 bg-black/60 p-0.5 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setMode('jarvis')}
            aria-pressed={mode === 'jarvis'}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
              mode === 'jarvis' ? 'bg-cyan-500/25 text-cyan-200' : 'text-white/55 hover:text-white/85'
            )}
          >
            <Brain className="h-3 w-3" /> Jarvis
          </button>
          <button
            type="button"
            onClick={() => setMode('multi')}
            aria-pressed={mode === 'multi'}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
              mode === 'multi' ? 'bg-violet-500/30 text-violet-200' : 'text-white/55 hover:text-white/85'
            )}
          >
            <Network className="h-3 w-3" /> Éclaté
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">{mode === 'jarvis' ? <JarvisCanvas className={compact ? 'pt-8' : undefined} /> : <BrainCanvas className={compact ? 'pt-8' : undefined} />}</div>
    </div>
  )
}

/** Vue page complète (AppShell) : en-tête + bascule Jarvis / multi-cerveaux. */
export function BrainRoomPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border/70 bg-card/50 px-4 py-3 md:px-6">
        <div>
          <h1 className="text-lg font-bold text-foreground">🧠 Cerveau Jarvis</h1>
          <p className="text-xs text-muted-foreground">
            UN cerveau central unique et animé relié à chaque agent par des liens d&apos;énergie — les impulsions
            voyagent en direct pendant les délibérations. Vue « Éclaté » : un cerveau 3D par agent.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <BrainView />
      </div>
    </div>
  )
}
