'use client'

// ─── NEXUS — Apparence du compte ────────────────────────────────────────────
// À la connexion, applique le mode, la palette et l'accent enregistrés dans le
// profil du compte (ils suivent donc l'utilisateur d'un appareil à l'autre).
// Le stockage local reste la source pour la page publique / la connexion.

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/lib/auth-client'
import { saveAppearance, type AccentId, type PaletteId } from '@/lib/appearance'

const MODES = ['light', 'dark', 'system'] as const
type Mode = (typeof MODES)[number]

export function AccountAppearanceSync() {
  const { user } = useAuth()
  const { setTheme } = useTheme()
  const applied = useRef('')

  const appearance = user?.profile?.appearance
  const key = user ? `${user.id}:${appearance?.accent ?? ''}:${appearance?.palette ?? ''}:${appearance?.mode ?? ''}` : ''

  useEffect(() => {
    if (!key || applied.current === key) return
    applied.current = key
    const next: { accent?: AccentId; palette?: PaletteId } = {}
    if (appearance?.accent) next.accent = appearance.accent as AccentId
    if (appearance?.palette) next.palette = appearance.palette as PaletteId
    if (Object.keys(next).length) saveAppearance(next)
    if (appearance?.mode && (MODES as readonly string[]).includes(appearance.mode)) {
      setTheme(appearance.mode as Mode)
    }
  }, [key, appearance, setTheme])

  return null
}
