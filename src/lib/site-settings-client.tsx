'use client'

// ─── NEXUS — Réglages du site côté client ────────────────────────────────────
// Charge les réglages publics, injecte les variables CSS et le CSS libre, et
// expose `save()` pour le dashboard Dev.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DEFAULT_SITE_SETTINGS, type SiteSettings } from '@/lib/site-types'

interface SiteContextValue {
  settings: SiteSettings
  loading: boolean
  refresh: () => Promise<void>
  /** Enregistre une modification (réservé au compte Dev). */
  save: (patch: Partial<SiteSettings>) => Promise<boolean>
  reset: () => Promise<boolean>
}

const SiteContext = createContext<SiteContextValue | null>(null)

export function SiteSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/site-settings', { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as { settings?: SiteSettings }
        if (data.settings) setSettings({ ...DEFAULT_SITE_SETTINGS, ...data.settings })
      }
    } catch {
      /* on garde les réglages par défaut */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/api/site-settings', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { settings?: SiteSettings } | null) => {
        if (!alive) return
        if (data?.settings) setSettings({ ...DEFAULT_SITE_SETTINGS, ...data.settings })
        setLoading(false)
      })
      .catch(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const save = useCallback(async (patch: Partial<SiteSettings>) => {
    try {
      const res = await fetch('/api/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = (await res.json().catch(() => ({}))) as { settings?: SiteSettings; error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'Enregistrement impossible')
        return false
      }
      if (data.settings) setSettings({ ...DEFAULT_SITE_SETTINGS, ...data.settings })
      toast.success('Site mis à jour')
      return true
    } catch {
      toast.error('Réseau indisponible')
      return false
    }
  }, [])

  const reset = useCallback(async () => {
    try {
      const res = await fetch('/api/site-settings', { method: 'DELETE' })
      const data = (await res.json().catch(() => ({}))) as { settings?: SiteSettings; error?: string }
      if (!res.ok) {
        toast.error(data.error ?? 'Réinitialisation impossible')
        return false
      }
      if (data.settings) setSettings({ ...DEFAULT_SITE_SETTINGS, ...data.settings })
      toast.success('Réglages d’origine restaurés')
      return true
    } catch {
      toast.error('Réseau indisponible')
      return false
    }
  }, [])

  // Titre de l'onglet
  useEffect(() => {
    document.title = settings.appName
  }, [settings.appName])

  const value = useMemo<SiteContextValue>(
    () => ({ settings, loading, refresh, save, reset }),
    [settings, loading, refresh, save, reset]
  )

  return (
    <SiteContext.Provider value={value}>
      <style>{`
:root {
  --dev-accent: ${settings.accent};
  --dev-accent-2: ${settings.accent2};
  --dev-accent-soft: ${settings.accent}26;
  --dev-accent-ring: ${settings.accent};
}
${settings.customCss}
`}</style>
      {children}
    </SiteContext.Provider>
  )
}

export function useSiteSettings(): SiteContextValue {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSiteSettings doit être utilisé dans <SiteSettingsProvider>')
  return ctx
}
