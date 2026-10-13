// ─── NEXUS — Réglages du site (accès base de données) ────────────────────────
// Stockés dans la table `SiteSetting`, modifiables uniquement depuis le compte
// Dev. Le reste de l'application les lit pour renommer l'instance, changer les
// couleurs et ajuster les textes — sans redéploiement.

import { db } from './db'
import { DEFAULT_SITE_SETTINGS, sanitizeCss, type SiteSettings } from './site-types'

const HEX = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/
const SETTINGS_KEY = 'site'

/** Bornes de sécurité sur chaque texte. */
const LIMITS: Partial<Record<keyof SiteSettings, number>> = {
  appName: 40,
  tagline: 60,
  logoEmoji: 8,
  loginTitle: 80,
  loginSubtitle: 200,
  welcomeTitle: 80,
  welcomeSubtitle: 200,
  footerText: 240,
  customCss: 20_000,
}

function str(v: unknown, fallback: string, max: number): string {
  if (typeof v !== 'string') return fallback
  return v.slice(0, max)
}

/** Fusionne une saisie partielle avec les réglages par défaut (et la valide). */
export function normalizeSettings(input: unknown): SiteSettings {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const accent = typeof raw.accent === 'string' && HEX.test(raw.accent.trim()) ? raw.accent.trim() : DEFAULT_SITE_SETTINGS.accent
  const accent2 = typeof raw.accent2 === 'string' && HEX.test(raw.accent2.trim()) ? raw.accent2.trim() : DEFAULT_SITE_SETTINGS.accent2
  const hidden = Array.isArray(raw.hiddenTiles)
    ? raw.hiddenTiles.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 40)).slice(0, 40)
    : []

  return {
    appName: str(raw.appName, DEFAULT_SITE_SETTINGS.appName, LIMITS.appName!).trim() || DEFAULT_SITE_SETTINGS.appName,
    tagline: str(raw.tagline, DEFAULT_SITE_SETTINGS.tagline, LIMITS.tagline!),
    logoEmoji: str(raw.logoEmoji, DEFAULT_SITE_SETTINGS.logoEmoji, LIMITS.logoEmoji!),
    accent,
    accent2,
    loginTitle: str(raw.loginTitle, DEFAULT_SITE_SETTINGS.loginTitle, LIMITS.loginTitle!),
    loginSubtitle: str(raw.loginSubtitle, DEFAULT_SITE_SETTINGS.loginSubtitle, LIMITS.loginSubtitle!),
    welcomeTitle: str(raw.welcomeTitle, DEFAULT_SITE_SETTINGS.welcomeTitle, LIMITS.welcomeTitle!),
    welcomeSubtitle: str(raw.welcomeSubtitle, DEFAULT_SITE_SETTINGS.welcomeSubtitle, LIMITS.welcomeSubtitle!),
    footerText: str(raw.footerText, DEFAULT_SITE_SETTINGS.footerText, LIMITS.footerText!),
    customCss: sanitizeCss(str(raw.customCss, '', LIMITS.customCss!)),
    hiddenTiles: hidden,
  }
}

// Cache très court : les réglages sont lus à chaque ouverture de page, sans
// jamais dépasser 2 secondes de fraîcheur après une modification.
let cache: { at: number; value: SiteSettings } | null = null

export async function getSiteSettings(): Promise<SiteSettings> {
  if (cache && Date.now() - cache.at < 2000) return cache.value
  try {
    const row = await db.siteSetting.findUnique({ where: { key: SETTINGS_KEY } })
    const value = row ? normalizeSettings(safeJson(String((row as { value?: unknown }).value ?? ''))) : DEFAULT_SITE_SETTINGS
    cache = { at: Date.now(), value }
    return value
  } catch {
    return DEFAULT_SITE_SETTINGS
  }
}

function safeJson(raw: string): unknown {
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Enregistre les réglages (réservé au compte Dev). */
export async function saveSiteSettings(input: unknown, userId: string): Promise<SiteSettings> {
  const next = normalizeSettings(input)
  const payload = JSON.stringify(next)
  try {
    const existing = await db.siteSetting.findUnique({ where: { key: SETTINGS_KEY } })
    if (existing) {
      await db.siteSetting.update({ where: { key: SETTINGS_KEY }, data: { value: payload, updatedBy: userId } })
    } else {
      await db.siteSetting.create({ data: { key: SETTINGS_KEY, value: payload, updatedBy: userId } })
    }
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Enregistrement impossible')
  }
  cache = { at: Date.now(), value: next }
  return next
}

/** Remet les réglages d'origine. */
export async function resetSiteSettings(userId: string): Promise<SiteSettings> {
  return saveSiteSettings(DEFAULT_SITE_SETTINGS, userId)
}
