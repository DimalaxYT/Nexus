'use client'

// ─── NEXUS — Apparence : mode, palette et couleur d'accent ──────────────────
// Source unique de vérité pour les préférences visuelles. Les valeurs sont
// écrites sur <html> via data-palette / data-accent (voir globals.css) et
// mémorisées dans localStorage. `useSyncExternalStore` garde tous les
// composants (compte, barre latérale, page de connexion) synchronisés sans
// effet de bord au montage.

import { useSyncExternalStore } from 'react'

export const ACCENTS = [
  { id: 'ardoise', label: 'Ardoise', hint: 'bleu-gris sobre', swatch: '#5b6577' },
  { id: 'indigo', label: 'Indigo', hint: 'bleu profond', swatch: '#4f46e5' },
  { id: 'emeraude', label: 'Émeraude', hint: 'vert doux', swatch: '#059669' },
  { id: 'ambre', label: 'Ambre', hint: 'ocre chaleureux', swatch: '#b45309' },
  { id: 'terracotta', label: 'Terracotta', hint: 'terre cuite', swatch: '#c2410c' },
  { id: 'rose', label: 'Rose', hint: 'framboise', swatch: '#db2777' },
  { id: 'cyan', label: 'Cyan', hint: 'bleu lagon', swatch: '#0891b2' },
  { id: 'violet', label: 'Violet', hint: 'prune', swatch: '#7c3aed' },
] as const

export type AccentId = (typeof ACCENTS)[number]['id']

export const PALETTES = [
  { id: 'neutre', label: 'Neutre', hint: 'gris doux, sans teinte', light: '#f7f7f8', dark: '#1b1c1f' },
  { id: 'chaud', label: 'Chaud', hint: 'papier sable', light: '#faf8f3', dark: '#1e1c18' },
  { id: 'froid', label: 'Froid', hint: 'bleu-gris', light: '#f4f7fb', dark: '#161b22' },
] as const

export type PaletteId = (typeof PALETTES)[number]['id']

export const DEFAULT_ACCENT: AccentId = 'ardoise'
export const DEFAULT_PALETTE: PaletteId = 'neutre'

export const ACCENT_KEY = 'nexus-accent'
export const PALETTE_KEY = 'nexus-palette'
const EVENT = 'nexus-appearance'

export interface Appearance {
  accent: AccentId
  palette: PaletteId
}

function isAccent(value: string | null): value is AccentId {
  return ACCENTS.some((a) => a.id === value)
}

function isPalette(value: string | null): value is PaletteId {
  return PALETTES.some((p) => p.id === value)
}

/** Lit les préférences mémorisées ; retombe sur les valeurs par défaut. */
export function readAppearance(): Appearance {
  if (typeof window === 'undefined') return { accent: DEFAULT_ACCENT, palette: DEFAULT_PALETTE }
  try {
    const accent = window.localStorage.getItem(ACCENT_KEY)
    const palette = window.localStorage.getItem(PALETTE_KEY)
    return {
      accent: isAccent(accent) ? accent : DEFAULT_ACCENT,
      palette: isPalette(palette) ? palette : DEFAULT_PALETTE,
    }
  } catch {
    return { accent: DEFAULT_ACCENT, palette: DEFAULT_PALETTE }
  }
}

function applyToDocument({ accent, palette }: Appearance) {
  const root = document.documentElement
  root.setAttribute('data-accent', accent)
  root.setAttribute('data-palette', palette)
  root.style.colorScheme = root.classList.contains('dark') ? 'dark' : 'light'
}

/** Écrit, applique et diffuse un changement d'apparence. */
export function saveAppearance(next: Partial<Appearance>): Appearance {
  const merged: Appearance = { ...readAppearance(), ...next }
  if (typeof document !== 'undefined') {
    applyToDocument(merged)
    try {
      window.localStorage.setItem(ACCENT_KEY, merged.accent)
      window.localStorage.setItem(PALETTE_KEY, merged.palette)
    } catch {
      /* stockage indisponible : l'apparence reste appliquée pour la session */
    }
    window.dispatchEvent(new Event(EVENT))
  }
  return merged
}

export function resetAppearance(): Appearance {
  return saveAppearance({ accent: DEFAULT_ACCENT, palette: DEFAULT_PALETTE })
}

function snapshot(): string {
  const state = readAppearance()
  return `${state.accent}:${state.palette}`
}

function serverSnapshot(): string {
  return `${DEFAULT_ACCENT}:${DEFAULT_PALETTE}`
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/** Préférences réactives + actions de mise à jour. */
export function useAppearance() {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const [accentId, paletteId] = raw.split(':') as [AccentId, PaletteId]
  const accent = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0]
  const palette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]
  return {
    accent,
    palette,
    setAccent: (id: AccentId) => saveAppearance({ accent: id }),
    setPalette: (id: PaletteId) => saveAppearance({ palette: id }),
    reset: resetAppearance,
  }
}

/**
 * Couleur de texte lisible sur un fond hexadécimal (avatars, pastilles).
 * Approximation WCAG : luminance relative, seuil 0,55.
 */
export function readableInk(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return '#ffffff'
  const value = parseInt(match[1], 16)
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance > 0.45 ? '#14161a' : '#ffffff'
}
