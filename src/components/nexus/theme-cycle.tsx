'use client'

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MODES = ['light', 'dark', 'system'] as const
type Mode = (typeof MODES)[number]

const LABEL: Record<Mode, { current: string; next: string }> = {
  light: { current: 'thème clair', next: 'sombre' },
  dark: { current: 'thème sombre', next: 'système' },
  system: { current: 'thème système', next: 'clair' },
}

/**
 * Bouton unique qui fait défiler clair → sombre → système.
 * `theme` (et non `resolvedTheme`) est utilisé pour distinguer le mode
 * « système » d'un choix explicite ; le garde de montage évite qu'un clic
 * avant hydratation ne réapplique le thème déjà actif.
 */
export function ThemeCycleButton({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const current: Mode = mounted ? (MODES.find((m) => m === theme) ?? 'system') : 'system'
  const next: Mode = current === 'light' ? 'dark' : current === 'dark' ? 'system' : 'light'
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor

  return (
    <Button
      variant="ghost"
      size="icon"
      className={`h-9 w-9 text-muted-foreground hover:text-foreground ${className ?? ''}`}
      onClick={() => setTheme(next)}
      aria-label={`${LABEL[current].current} — passer au thème ${LABEL[current].next}`}
      title={`${LABEL[current].current} — cliquer pour passer au thème ${LABEL[current].next}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  )
}
