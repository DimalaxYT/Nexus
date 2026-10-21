// ─── NEXUS — Le navigateur de l'agent Dev ────────────────────────────────────
// Un navigateur rien qu'à lui, distinct de celui de l'utilisateur : il visite,
// extrait le texte lisible et range chaque page dans sa bibliothèque. Toutes
// les pages sont relues plus tard par l'entraîneur pour fabriquer du savoir.
// Lecture 100 % locale (fetch + extraction maisons) : aucun service tiers.

import { db } from './db'
import { readWebpage, webSearch, type SearchResult } from './brain/search'
import { validateSafeExternalUrl } from './security'

export interface DevPageRecord {
  id: string
  url: string
  title: string
  domain: string
  text: string
  bytes: number
  runId: string
  origin: 'agent' | 'manuel'
  hits: number
  fetchedAt: Date | string | number | null
}

export interface BrowseOutcome {
  ok: boolean
  page?: DevPageRecord
  /** Vrai si la page venait déjà de la bibliothèque (pas de requête réseau). */
  cached?: boolean
  error?: string
}

const CACHE_MS = 6 * 60 * 60 * 1000 // une page reste fraîche 6 h

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function shapePage(row: any): DevPageRecord {
  return {
    id: String(row?.id ?? ''),
    url: String(row?.url ?? ''),
    title: String(row?.title ?? ''),
    domain: String(row?.domain ?? ''),
    text: String(row?.text ?? ''),
    bytes: Number(row?.bytes ?? 0),
    runId: String(row?.runId ?? ''),
    origin: (String(row?.origin ?? 'agent') === 'manuel' ? 'manuel' : 'agent') as DevPageRecord['origin'],
    hits: Number(row?.hits ?? 0),
    fetchedAt: row?.fetchedAt ?? null,
  }
}

/**
 * Visite une URL avec le navigateur de l'agent Dev.
 * - valide l'URL (anti-SSRF : pas d'adresse privée, pas de schéma exotique)
 * - réutilise la page si elle a moins de 6 h (économise le réseau)
 * - range le texte extrait dans `DevPage`
 */
export async function browsePage(
  url: string,
  opts: { userId: string; runId?: string; origin?: 'agent' | 'manuel'; maxLen?: number; force?: boolean } = { userId: '' }
): Promise<BrowseOutcome> {
  const raw = String(url ?? '').trim().slice(0, 2000)
  if (!raw) return { ok: false, error: 'URL vide.' }

  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  const safe = await validateSafeExternalUrl(withScheme)
  if (!safe.ok || !safe.url) {
    return { ok: false, error: safe.reason || 'URL refusée par la sécurité.' }
  }
  const target = safe.url

  // Cache : une page déjà visitée récemment est servie sans requête réseau.
  if (!opts.force) {
    const existing = await db.devPage.findMany({ where: { userId: opts.userId, url: target }, take: 1 })
    const found = existing?.[0]
    if (found) {
      const at = new Date(found.fetchedAt as string | number | Date).getTime()
      if (Number.isFinite(at) && Date.now() - at < CACHE_MS) {
        await db.devPage
          .update({ where: { id: String(found.id) }, data: { hits: Number(found.hits ?? 0) + 1 } })
          .catch(() => {})
        return { ok: true, cached: true, page: shapePage({ ...found, hits: Number(found.hits ?? 0) + 1 }) }
      }
    }
  }

  let page: { url: string; title: string; text: string } | null = null
  try {
    page = await readWebpage(target, opts.maxLen ?? 12_000)
  } catch (err) {
    page = null
    void err
  }

  if (!page || !page.text.trim()) {
    return {
      ok: false,
      error: 'Page illisible : le site a refusé la connexion, ou le réseau est indisponible.',
    }
  }

  const text = page.text.slice(0, 20_000)
  const record = await db.devPage.create({
    data: {
      userId: opts.userId,
      url: target,
      title: page.title.slice(0, 300) || target,
      domain: domainOf(target),
      text,
      bytes: Buffer.byteLength(text),
      runId: opts.runId ?? '',
      origin: opts.origin ?? 'agent',
      hits: 0,
    },
  })

  return { ok: true, cached: false, page: shapePage(record) }
}

/** Recherche web via les moteurs locaux du cerveau (null si hors-ligne). */
export async function searchWeb(query: string, max = 6): Promise<SearchResult[] | null> {
  try {
    const results = await webSearch(query, max)
    return results && results.length ? results : null
  } catch {
    return null
  }
}

/** Bibliothèque de l'agent : les dernières pages qu'il a lues. */
/** Colonnes de la liste « légère » : tout sauf le texte extrait (souvent des dizaines de Ko par page). */
const PAGE_LIST_COLUMNS = { id: true, url: true, title: true, domain: true, bytes: true, runId: true, origin: true, hits: true, fetchedAt: true }

export async function listPages(userId: string, take = 40, opts: { withText?: boolean } = {}): Promise<DevPageRecord[]> {
  try {
    const rows = await db.devPage.findMany({
      where: { userId },
      orderBy: { fetchedAt: 'desc' },
      take,
      ...(opts.withText === false ? { select: PAGE_LIST_COLUMNS } : {}),
    })
    return (rows ?? []).map(shapePage)
  } catch {
    return []
  }
}

/** statistiques de la bibliothèque */
export async function pagesStats(userId: string): Promise<{ pages: number; domains: number; bytes: number }> {
  try {
    // Seules les colonnes utiles au décompte (avant : 500 pages complètes, texte compris)
    const rows = await db.devPage.findMany({ where: { userId }, take: 500, select: { domain: true, bytes: true } })
    const list = rows ?? []
    const domains = new Set(list.map((r) => String(r.domain ?? '')).filter(Boolean))
    return {
      pages: list.length,
      domains: domains.size,
      bytes: list.reduce((acc, r) => acc + Number(r.bytes ?? 0), 0),
    }
  } catch {
    return { pages: 0, domains: 0, bytes: 0 }
  }
}

export async function deletePage(id: string): Promise<void> {
  await db.devPage.delete({ where: { id } }).catch(() => {})
}

export async function clearPages(userId: string): Promise<number> {
  const res = await db.devPage.deleteMany({ where: { userId } }).catch(() => ({ count: 0 }))
  return Number(res?.count ?? 0)
}
