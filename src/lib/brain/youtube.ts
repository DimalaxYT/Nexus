// ─── NEXUS Brain — Lecteur YouTube local ─────────────────────────────────────
// « Regarder une vidéo » en mode texte. Chaîne de repli à 3 stratégies :
//   1. oembed (JSON public, fiable même sur serveur) → titre + chaîne
//   2. page watch → titre FR (overlay) + videoDetails si YouTube ne bloque pas
//   3. transcription (sous-titres timedtext) quand YouTube la sert
// YouTube bloque souvent les IP de datacenter (« Connectez-vous pour confirmer
// que vous n'êtes pas un robot ») : dans ce cas on récupère au minimum le titre
// et la chaîne — la mission continue avec les extraits de recherche en appoint.
// Tout échec → null : l'appelant retombe sur les extraits.

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export interface YouTubeVideo {
  url: string
  videoId: string
  title: string
  author: string
  durationSec: number
  description: string
  transcript: string // sous-titres concaténés (vide si YouTube les bloque)
  source: 'full' | 'partial' | 'metadata' // qualité de ce qu'on a pu récupérer
}

/** Extrait l'ID d'une vidéo depuis une URL YouTube (watch, youtu.be, shorts, embed). */
export function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0]
      return /^[\w-]{11}$/.test(id) ? id : null
    }
    if (!/^(m\.)?(youtube\.com|youtube-nocookie\.com)$/.test(host)) return null
    const v = u.searchParams.get('v')
    if (v && /^[\w-]{11}$/.test(v)) return v
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit): Promise<Response | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.7',
        ...(init?.headers ?? {}),
      },
      redirect: 'follow',
    })
    clearTimeout(timer)
    return res
  } catch {
    return null
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const res = await fetchWithTimeout(url, timeoutMs)
  if (!res || !res.ok) return ''
  return res.text().catch(() => '')
}

/** Extrait l'objet JSON équilibré qui suit `marker` dans le HTML brut. */
function extractBalancedJson(html: string, marker: string): unknown | null {
  const start = html.indexOf(marker)
  if (start < 0) return null
  const open = html.indexOf('{', start + marker.length)
  if (open < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = open; i < html.length; i++) {
    const ch = html[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(open, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function unescapeJson(s: string): string {
  return s
    .replace(/\\u([\dA-Fa-f]{4})/g, (_, c: string) => {
      try {
        return String.fromCodePoint(parseInt(c, 16))
      } catch {
        return ''
      }
    })
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\\//g, '/')
}

interface PlayerResponse {
  videoDetails?: {
    title?: string
    author?: string
    shortDescription?: string
    lengthSeconds?: string
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: { baseUrl?: string; languageCode?: string; kind?: string }[]
    }
  }
}

/** Récupère et aplatit une piste de sous-titres (json3, repli XML). */
async function fetchTranscript(baseUrl: string, timeoutMs: number): Promise<string> {
  const raw = await fetchText(`${baseUrl}&fmt=json3`, timeoutMs)
  if (!raw) return ''
  try {
    const json = JSON.parse(raw) as { events?: { segs?: { utf8?: string }[] }[] }
    const lines: string[] = []
    for (const ev of json.events ?? []) {
      const text = (ev.segs ?? [])
        .map((s) => s.utf8 ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      if (text && text !== '\n') lines.push(text)
    }
    return lines.join(' ').replace(/\s+/g, ' ').trim()
  } catch {
    const texts = [...raw.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map((m) =>
      m[1]
        .replace(/&amp;/g, '&')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
    )
    return texts.join(' ').replace(/\s+/g, ' ').trim()
  }
}

interface PartialVideo {
  title: string
  author: string
  description: string
  durationSec: number
  transcript: string
}

/** Stratégie 1 : oembed — JSON public, fonctionne même quand YouTube bloque. */
async function viaOEmbed(videoId: string, timeoutMs: number): Promise<{ title: string; author: string } | null> {
  const raw = await fetchText(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    timeoutMs
  )
  if (!raw) return null
  try {
    const json = JSON.parse(raw) as { title?: string; author_name?: string }
    if (!json.title) return null
    return { title: json.title.slice(0, 200), author: (json.author_name ?? '').slice(0, 120) }
  } catch {
    return null
  }
}

/** Stratégie 2 : page watch — titre FR via l'overlay (présent même sur la page
 *  bot-check) + videoDetails/captions si YouTube ne bloque pas. */
async function viaWatchPage(videoId: string, timeoutMs: number): Promise<PartialVideo | null> {
  const html = await fetchText(`https://www.youtube.com/watch?v=${videoId}&hl=fr&bpctr=9999999999`, timeoutMs)
  if (!html) return null

  const player = extractBalancedJson(html, 'ytInitialPlayerResponse') as PlayerResponse | null
  const details = player?.videoDetails

  let title = details?.title ?? ''
  if (!title) {
    const overlay = html.match(/"playerOverlayVideoDetailsRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"/)
    if (overlay) title = unescapeJson(overlay[1])
  }
  if (!title) {
    const m = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)
    if (m) title = m[1]
  }
  if (!title) return null

  // Transcription si les sous-titres sont servis (rare depuis un datacenter, gratuit quand ça marche)
  let transcript = ''
  const tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const pick =
    tracks.find((t) => t.languageCode?.startsWith('fr') && t.kind !== 'asr') ??
    tracks.find((t) => t.languageCode?.startsWith('fr')) ??
    tracks.find((t) => t.languageCode?.startsWith('en')) ??
    tracks[0]
  if (pick?.baseUrl) transcript = await fetchTranscript(pick.baseUrl, Math.min(timeoutMs, 8000))

  return {
    title: title.slice(0, 200),
    author: (details?.author ?? '').slice(0, 120),
    description: (details?.shortDescription ?? '').trim().slice(0, 3000),
    durationSec: parseInt(details?.lengthSeconds ?? '0', 10) || 0,
    transcript,
  }
}

/**
 * « Regarde » une vidéo YouTube : titre, chaîne, description et transcription
 * quand YouTube les sert ; sinon repli oembed (titre + chaîne). null si la
 * vidéo est introuvable — l'appelant retombe alors sur les extraits.
 */
export async function readYouTubeVideo(url: string, timeoutMs = 9000): Promise<YouTubeVideo | null> {
  const videoId = extractVideoId(url)
  if (!videoId) return null
  const canonical = `https://www.youtube.com/watch?v=${videoId}`

  const watch = await viaWatchPage(videoId, timeoutMs)
  if (watch && (watch.description || watch.transcript)) {
    return {
      url: canonical,
      videoId,
      title: watch.title,
      author: watch.author,
      durationSec: watch.durationSec,
      description: watch.description,
      transcript: watch.transcript,
      source: watch.transcript ? 'full' : 'partial',
    }
  }

  const oembed = await viaOEmbed(videoId, Math.min(timeoutMs, 6000))
  const title = watch?.title || oembed?.title || ''
  if (!title) return null
  return {
    url: canonical,
    videoId,
    title,
    author: oembed?.author || watch?.author || '',
    durationSec: watch?.durationSec ?? 0,
    description: watch?.description ?? '',
    transcript: watch?.transcript ?? '',
    source: 'metadata',
  }
}

/** Formatage lisible d'une durée en secondes (ex: 215 → « 3 min 55 »). */
export function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s} s`
  if (s === 0) return `${m} min`
  return `${m} min ${String(s).padStart(2, '0')}`
}

// ── Recherche native YouTube ─────────────────────────────────────────────────
// La page results?search_query SERT ytInitialData même depuis un datacenter
// (seule la page watch est « bot-checkée »). On y pêche les vraies vidéos :
// videoId, titre, chaîne, durée, extrait de description — bien meilleur que
// site:youtube.com sur Bing (pollué par les redirects Google News).

export interface YouTubeSearchHit {
  title: string
  url: string
  videoId: string
  channel: string
  duration: string
  snippet: string
}

interface YtRenderer {
  videoId?: string
  title?: { runs?: { text?: string }[]; simpleText?: string }
  ownerText?: { runs?: { text?: string }[] }
  lengthText?: { simpleText?: string }
  descriptionSnippet?: { runs?: { text?: string }[] }
  channelId?: string
  canonicalBaseUrl?: string
}

/** Capture à la fois les vidéos (videoRenderer) et les chaînes (channelRenderer). */
function walkRenderers(node: unknown, out: YtRenderer[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 24 || out.length > 60) return
  const obj = node as Record<string, unknown>
  if (obj.videoRenderer && typeof obj.videoRenderer === 'object') {
    out.push(obj.videoRenderer as YtRenderer)
  }
  if (obj.channelRenderer && typeof obj.channelRenderer === 'object') {
    out.push(obj.channelRenderer as YtRenderer)
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') walkRenderers(v, out, depth + 1)
  }
}

/** Recherche native YouTube (page results, ytInitialData) — vraies vidéos. */
export async function searchYouTubeNative(query: string, max = 8): Promise<YouTubeSearchHit[]> {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=fr&sp=EgIQAQ%253D%253D`,
    8000
  )
  if (!html || !html.includes('ytInitialData')) return []
  const data = extractBalancedJson(html, 'ytInitialData')
  if (!data) return []
  const renderers: YtRenderer[] = []
  walkRenderers(data, renderers)
  const hits: YouTubeSearchHit[] = []
  const seen = new Set<string>()
  for (const v of renderers) {
    if (!v.videoId || seen.has(v.videoId)) continue
    seen.add(v.videoId)
    const title = (v.title?.runs?.map((r) => r.text ?? '').join('') || v.title?.simpleText || '').trim()
    if (!title) continue
    const channel = (v.ownerText?.runs?.map((r) => r.text ?? '').join('') ?? '').trim()
    const duration = (v.lengthText?.simpleText ?? '').trim()
    const desc = (v.descriptionSnippet?.runs?.map((r) => r.text ?? '').join('') ?? '').trim()
    hits.push({
      title: title.slice(0, 200),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      videoId: v.videoId,
      channel: channel.slice(0, 120),
      duration,
      snippet: desc.slice(0, 400),
    })
    if (hits.length >= max) break
  }
  return hits
}

// ── Chaînes YouTube : trouver la chaîne puis SA DERNIÈRE vidéo ───────────────
// « La dernière vidéo de X » exige de connnaître la chaîne de X : on cherche
// d'abord les CHAÎNES (channelRenderer de la page résultats, sans filtre),
// puis on lit l'onglet /videos de la chaîne — dont le 1er videoRenderer est la
// vidéo la plus récente. Beaucoup plus fiable qu'une recherche par pertinence.

export interface YouTubeChannelHit {
  channelId: string
  title: string
  handle: string
  url: string
  subs: string
}

/** Recherche de CHAÎNES YouTube (page résultats, ytInitialData, sans filtre). */
export async function searchYouTubeChannels(query: string, max = 5): Promise<YouTubeChannelHit[]> {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=fr`,
    8000
  )
  if (!html || !html.includes('ytInitialData')) return []
  const data = extractBalancedJson(html, 'ytInitialData')
  if (!data) return []
  const renderers: YtRenderer[] = []
  walkRenderers(data, renderers)
  const hits: YouTubeChannelHit[] = []
  const seen = new Set<string>()
  for (const c of renderers) {
    if (!c.channelId || !c.title || seen.has(c.channelId)) continue
    seen.add(c.channelId)
    const title = (c.title.runs?.map((r) => r.text ?? '').join('') || c.title.simpleText || '').trim()
    if (!title) continue
    // handle : navigationEndpoint du renderer (canonicalBaseUrl = /@handle)
    const nav = (c as unknown as { navigationEndpoint?: { browseEndpoint?: { canonicalBaseUrl?: string } } })
      .navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
    const handle = (nav ?? '').replace(/^\/@/, '')
    hits.push({
      channelId: c.channelId,
      title: title.slice(0, 120),
      handle: handle.slice(0, 80),
      url: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${c.channelId}`,
      subs: '', // subscriberCountText existe sur certains renderers seulement
    })
    if (hits.length >= max) break
  }
  return hits
}

/**
 * LA vidéo la plus récente d'une chaîne (onglet /videos).
 * Deux structures servies selon les époques : le modèle historique
 * (videoRenderer) et le nouveau (lockupViewModel) — on lit les deux.
 */
export async function latestChannelVideo(channelId: string, handle?: string): Promise<YouTubeSearchHit | null> {
  const path = handle ? `@${handle}` : `channel/${channelId}`
  const html = await fetchText(`https://www.youtube.com/${path}/videos?hl=fr`, 9000)
  if (!html || !html.includes('ytInitialData')) return null
  const data = extractBalancedJson(html, 'ytInitialData')
  if (!data) return null

  // Modèle NOUVEAU : lockupViewModel (contentId = videoId, titre dans metadata)
  interface Lockup {
    contentId?: string
    metadata?: {
      lockupMetadataViewModel?: {
        title?: { content?: string }
        metadata?: {
          contentMetadataViewModel?: {
            metadataRows?: { metadataParts?: { text?: { content?: string } }[] }[]
          }
        }
      }
    }
    contentImage?: {
      thumbnailViewModel?: {
        overlays?: { thumbnailBottomOverlayViewModel?: { badges?: { thumbnailBadgeViewModel?: { text?: string } }[] } }[]
      }
    }
  }
  const lockups: Lockup[] = []
  const walkLockups = (node: unknown, d = 0): void => {
    if (!node || typeof node !== 'object' || d > 30 || lockups.length > 12) return
    const obj = node as Record<string, unknown>
    if (obj.lockupViewModel && typeof obj.lockupViewModel === 'object') {
      lockups.push(obj.lockupViewModel as Lockup)
    }
    for (const v of Object.values(obj)) if (v && typeof v === 'object') walkLockups(v, d + 1)
  }
  walkLockups(data)
  for (const l of lockups) {
    const videoId = l.contentId ?? ''
    const title = (l.metadata?.lockupMetadataViewModel?.title?.content ?? '').trim()
    if (!/^[\w-]{11}$/.test(videoId) || !title) continue
    const parts =
      l.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows
        ?.flatMap((r) => r.metadataParts ?? [])
        .map((p) => p.text?.content ?? '')
        .filter(Boolean) ?? []
    const duration =
      l.contentImage?.thumbnailViewModel?.overlays
        ?.flatMap((o) => o.thumbnailBottomOverlayViewModel?.badges ?? [])
        .map((b) => b.thumbnailBadgeViewModel?.text ?? '')
        .find((t) => /^\d+:\d{2}/.test(t)) ?? ''
    return {
      title: title.slice(0, 200),
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
      channel: handle ? `@${handle}` : channelId,
      duration,
      snippet: parts.join(' · ').slice(0, 400),
    }
  }

  // Modèle HISTORIQUE : videoRenderer (onglet /videos ordonné du plus récent)
  const renderers: YtRenderer[] = []
  walkRenderers(data, renderers)
  for (const v of renderers) {
    if (!v.videoId) continue
    const title = (v.title?.runs?.map((r) => r.text ?? '').join('') || v.title?.simpleText || '').trim()
    if (!title) continue
    return {
      title: title.slice(0, 200),
      url: `https://www.youtube.com/watch?v=${v.videoId}`,
      videoId: v.videoId,
      channel: (v.ownerText?.runs?.map((r) => r.text ?? '').join('') ?? '').trim().slice(0, 120),
      duration: (v.lengthText?.simpleText ?? '').trim(),
      snippet: (v.descriptionSnippet?.runs?.map((r) => r.text ?? '').join('') ?? '').trim().slice(0, 400),
    }
  }
  return null
}
