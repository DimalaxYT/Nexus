// ─── NEXUS Brain — Recherche & lecture web 100 % locale ──────────────────────
// Toutes les sources sont interrogées EN PARALLÈLE (≈ 1-2 s au total) :
// Google News RSS ∥ Bing HTML ∥ Reddit RSS ∥ StackExchange ∥ HN Algolia.
// SANS API à quota, sans moteur lente/bloqué (DuckDuckGo retiré : +12 s pour
// rien dans cet environnement). Tout échec réseau → repli gracieux (null).

const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

import { stems } from './text'
import { validateSafeExternalUrl } from '@/lib/security'

export interface SearchResult {
  title: string
  url: string
  domain: string
  snippet: string
}

/** fetch avec timeout (AbortController) — cœur de toutes les opérations réseau. */
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

/** Convertit du HTML en texte lisible (extraction from scratch). */
export function htmlToText(html: string, maxLen: number): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article|header|footer|blockquote)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(parseInt(code, 10))
      } catch {
        return ' '
      }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, maxLen)
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => {
      try {
        return String.fromCodePoint(parseInt(code, 10))
      } catch {
        return ' '
      }
    })
}

/** Strip les balises d'un fragment (extraits). */
function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim()
}

function domainOf(url: string, fallback: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return fallback
  }
}

/**
 * Recherche web locale : TOUTES les sources en parallèle (1-2 s au total).
 * `site` optionnel (ex: "youtube.com") restreint la recherche au domaine.
 * Un filtre de pertinence écarte les résultats hors-sujet.
 * ROBUSTESSE : chaque moteur retry une fois (les 429/murs anti-bot sont
 * souvent transitoires) — un échec global d'un tour ne se reproduit pas
 * deux fois d'affilée (cause historique de « réseau indisponible »).
 */
export async function webSearch(query: string, max = 8, site?: string): Promise<SearchResult[] | null> {
  // Origine de chaque résultat (pour le repli anti-pollution : voir plus bas)
  const bingUrls = new Set<string>()
  const run = async (): Promise<SearchResult[]> => {
    // Google News RSS ignore l'opérateur site: (il renvoie des actualités
    // génériques, polluées de redirects news.google.com) → on ne l'utilise que
    // pour les recherches sans site. Bing seul comprend site:.
    const siteQ = site ? `site:${site} ${query}` : query

    const tasks: Promise<SearchResult[] | null>[] = [
      bingSearch(siteQ, max).then((rs) => {
        for (const r of rs ?? []) bingUrls.add(r.url)
        return rs
      }),
    ]
    if (!site) tasks.push(googleNewsRss(query, max))
    if (!site || /reddit/i.test(site)) tasks.push(redditRss(query, max))
    if (!site || /stack(exchange|overflow)/i.test(site)) tasks.push(stackExchange(query, max))
    if (!site || /ycombinator|hacker/i.test(site)) tasks.push(hnAlgolia(query, max))
    if (!site) tasks.push(wikipediaSearch(query, max))
    const settled = await Promise.all(tasks)
    return settled.flatMap((r) => r ?? [])
  }

  // Tour 1 + tour 2 si rien (délai court : les 429 redescendent vite)
  let gathered = await run()
  if (gathered.length === 0) {
    await sleep(1100)
    gathered = await run()
  }
  gathered = gathered
    // Les redirects Google News (news.google.com/rss/articles) ne mènent à
    // aucune page lisible : on les écarte systématiquement.
    .filter((r) => !/news\.google\.com\/rss/i.test(r.url))

  if (gathered.length === 0) return null // réseau totalement indisponible

  // Déduplication + CLASSEMENT par pertinence (radicaux significatifs,
  // stopwords exclus). On garde les résultats avec ≥ 1 radical partagé et on
  // trie par score : le bruit (0 correspondance) est écarté, le reste remonte
  // du plus pertinent au moins pertinent.
  const qStemSet = new Set(stems(query).filter((w) => w.length > 2))
  const seen = new Set<string>()
  const scored: { r: SearchResult; hits: number }[] = []
  for (const r of gathered) {
    const key = `${r.domain}|${r.title.toLowerCase().slice(0, 40)}`
    if (seen.has(key)) continue
    seen.add(key)
    const hayStems = new Set(stems(`${r.title} ${r.snippet}`))
    let hits = 0
    for (const w of qStemSet) if (hayStems.has(w)) hits++
    if (qStemSet.size === 0 || hits >= 1) scored.push({ r, hits })
  }
  scored.sort((a, b) => b.hits - a.hits)
  const final = scored.map((s) => s.r)
  if (final.length > 0) return final.slice(0, max)
  // Aucune correspondance de radicaux : Bing depuis un datacenter sert parfois
  // des résultats « cloakés » sans rapport (pages Amazon, forums aléatoires).
  // On préfère alors les sources STRUCTURÉES (Reddit, StackExchange, HN,
  // Wikipédia) dont les titres sont fiables ; si elles sont vides aussi,
  // on retourne null — les appelants retentent avec des requêtes simplifiées
  // plutôt que d'afficher de la pollution.
  const structured = gathered.filter((r) => !bingUrls.has(r.url))
  return structured.length > 0 ? structured.slice(0, max) : null
}

/** Google News RSS : parse <item> (titre, lien, source, date) — ~600 ms. */
async function googleNewsRss(query: string, max: number): Promise<SearchResult[] | null> {
  const res = await fetchWithTimeout(
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=fr&gl=FR&ceid=FR:fr`,
    6000
  )
  if (!res || !res.ok) return null
  const xml = await res.text().catch(() => '')
  if (!xml.includes('<item>')) return null
  const items = xml.split('<item>').slice(1, max + 1)
  const results: SearchResult[] = []
  for (const item of items) {
    const title = decodeEntities(stripTags((item.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? '')).replace(/\s+/g, ' ').trim()
    const link = ((item.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? '').trim()
    const source = decodeEntities(stripTags((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) ?? [])[1] ?? ''))
    const pubDate = ((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? '').trim()
    if (!title || !link) continue
    results.push({
      title,
      url: link,
      domain: source || 'Google Actualités',
      snippet: pubDate ? `Publication : ${pubDate}` : '',
    })
  }
  return results
}

/**
 * Bing HTML : le redirecteur /ck/a ne expose plus la vraie URL — on utilise
 * le <cite> (URL affichée par Bing) comme lien réel. ~200 ms quand il répond.
 * FIX ROBINET ANTI-BOT : sans cookie de langue ni mkt, Bing sert de plus en
 * plus souvent une page SANS résultats organiques (200 OK, 0 b_algo) — c'est
 * ce qui causait les « réseau indisponible » des missions. On envoie donc
 * Cookie SRCHHPGUSR + mkt=fr-FR + count explicite, et on retente une fois
 * après un court délai si la page vide arrive (mur transitoire).
 */
async function bingSearch(query: string, max: number): Promise<SearchResult[] | null> {
  const attempt = async (): Promise<SearchResult[] | null> => {
    const res = await fetchWithTimeout(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.max(max, 10)}&mkt=fr-FR&setlang=fr`,
      6000,
      { headers: { Cookie: 'SRCHHPGUSR=SRCHLANG=fr; SRCHUSR=DOB=20200101' } }
    )
    if (!res || !res.ok) return null
    const html = await res.text().catch(() => '')
    if (!html.includes('b_algo')) return null
    return parseBingHtml(html, max)
  }
  const first = await attempt()
  if (first && first.length > 0) return first
  await sleep(700)
  return attempt()
}

function parseBingHtml(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []
  const blocks = html.split('<li class="b_algo"').slice(1)
  for (const block of blocks) {
    if (results.length >= max) break
    const linkMatch = block.match(/<h2[^>]*><a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!linkMatch) continue
    const title = decodeEntities(stripTags(linkMatch[2])).trim()
    if (!title) continue
    // Vraie URL : cite (affichée) sinon href direct (hors redirecteur)
    let url = ''
    const citeMatch = block.match(/<cite[^>]*>([\s\S]*?)<\/cite>/)
    if (citeMatch) {
      const cite = decodeEntities(stripTags(citeMatch[1])).replace(/^https?:\/\//, '').replace(/\s+/g, '')
      if (/^[\w.-]+\.[a-z]{2,}/i.test(cite)) url = `https://${cite}`
    }
    const rawHref = decodeEntities(linkMatch[1])
    if (!url && /^https?:\/\//.test(rawHref) && !/bing\.com\/ck/.test(rawHref)) url = rawHref
    if (!url) continue
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = pMatch ? decodeEntities(stripTags(pMatch[1])).slice(0, 400) : ''
    results.push({ title, url, domain: domainOf(url, 'web'), snippet })
  }
  return results
}

/** Wikipedia (API MediaWiki FR) : encyclopédie fiable, utile en repli quand
 *  les moteurs commerciaux font la tête. Retry intégré : le 429 est passager. */
async function wikipediaSearch(query: string, max: number): Promise<SearchResult[] | null> {
  const clean = query.replace(/site:\S+\s*/i, '').slice(0, 140)
  const attempt = async (): Promise<SearchResult[] | null> => {
    const res = await fetchWithTimeout(
      `https://fr.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(clean)}&format=json&srlimit=${max}&origin=*`,
      6000
    )
    if (!res || !res.ok) return null
    const json = (await res.json().catch(() => null)) as { query?: { search?: { title?: string; snippet?: string }[] } } | null
    const items = json?.query?.search
    if (!items || items.length === 0) return null
    return items
      .filter((it) => it.title)
      .map((it) => ({
        title: `${it.title} — Wikipédia`,
        url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(it.title!.replace(/\s+/g, '_'))}`,
        domain: 'fr.wikipedia.org',
        snippet: (it.snippet ?? '').replace(/<[^>]+>/g, '').slice(0, 300),
      }))
  }
  const first = await attempt()
  if (first) return first
  await sleep(900)
  return attempt()
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Reddit RSS : discussions communautaires avec le CONTENU des posts inclus
 * (or du tutoriel / retour d'expérience précieux). ~800 ms.
 */
async function redditRss(query: string, max: number): Promise<SearchResult[] | null> {
  const res = await fetchWithTimeout(
    `https://www.reddit.com/search.rss?q=${encodeURIComponent(query)}&limit=${Math.max(max, 6)}&sort=relevance`,
    6000
  )
  if (!res || !res.ok) return null
  const xml = await res.text().catch(() => '')
  if (!xml.includes('<entry>')) return null
  const entries = xml.split('<entry>').slice(1, max + 1)
  const results: SearchResult[] = []
  for (const entry of entries) {
    const title = decodeEntities(stripTags((entry.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? '')).trim()
    const link = ((entry.match(/<link[^>]*href="([^"]+)"/) ?? [])[1] ?? '').replace(/&amp;/g, '&')
    if (!title || !link) continue
    // Contenu du post (HTML échappé deux fois dans l'Atom) → texte
    const rawContent = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/) ?? [])[1] ?? ''
    const text = decodeEntities(decodeEntities(rawContent))
    const body = htmlToText(text, 700).replace(/\s+/g, ' ').trim()
    const subreddit = ((entry.match(/<category[^>]*label="([^"]*)"/) ?? [])[1] ?? 'reddit').replace(/^r\//i, '')
    results.push({
      title,
      url: link,
      domain: `reddit.com/r/${subreddit}`,
      snippet: body.slice(0, 400),
    })
  }
  return results
}

/** StackExchange API : Q&A de programmation (JSON, réel, sans clé). */
async function stackExchange(query: string, max: number): Promise<SearchResult[] | null> {
  const clean = query.replace(/^site:\S+\s*/i, '').slice(0, 140)
  const res = await fetchWithTimeout(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&pagesize=${max}&q=${encodeURIComponent(clean)}&site=stackoverflow`,
    6000
  )
  if (!res || !res.ok) return null
  const json = (await res.json().catch(() => null)) as { items?: { title?: string; link?: string; score?: number; tags?: string[]; is_answered?: boolean }[] } | null
  if (!json?.items || json.items.length === 0) return null
  const results: SearchResult[] = []
  for (const item of json.items) {
    if (!item.title || !item.link) continue
    const title = decodeEntities(stripTags(item.title)).trim()
    results.push({
      title,
      url: item.link,
      domain: 'stackoverflow.com',
      snippet: `${item.is_answered ? 'Question résolue' : 'Question ouverte'}${typeof item.score === 'number' ? ` · score ${item.score}` : ''}${item.tags?.length ? ` · tags : ${item.tags.slice(0, 4).join(', ')}` : ''}`,
    })
  }
  return results
}

/** Hacker News (Algolia) : actualités et discussions tech. */
async function hnAlgolia(query: string, max: number): Promise<SearchResult[] | null> {
  const clean = query.replace(/^site:\S+\s*/i, '').slice(0, 140)
  const res = await fetchWithTimeout(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(clean)}&hitsPerPage=${max}`,
    6000
  )
  if (!res || !res.ok) return null
  const json = (await res.json().catch(() => null)) as { hits?: { title?: string; url?: string; objectID?: string; points?: number; story_text?: string }[] } | null
  if (!json?.hits || json.hits.length === 0) return null
  const results: SearchResult[] = []
  for (const hit of json.hits) {
    const title = decodeEntities(stripTags(hit.title ?? '')).trim()
    if (!title) continue
    const url = hit.url || (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : '')
    if (!url) continue
    const snippet = htmlToText(hit.story_text ?? '', 300).replace(/\s+/g, ' ').trim()
    results.push({
      title,
      url,
      domain: domainOf(url, 'news.ycombinator.com'),
      snippet: snippet || (typeof hit.points === 'number' ? `Discussion HN · ${hit.points} points` : 'Discussion HN'),
    })
  }
  return results
}

export interface ReadPageResult {
  url: string
  title: string
  text: string
}

/** Domaines à contenu lourd JS/vidéo : lecture de page inutile, on garde les extraits. */
export function isMediaDomain(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|reddit\.com)$/i.test(host)
  } catch {
    return false
  }
}

/** Lit une page web directement (fetch + extraction locale du texte, protégé anti-SSRF). */
export async function readWebpage(url: string, maxLen = 9000): Promise<ReadPageResult | null> {
  if (!/^https?:\/\/.+/i.test(url)) return null
  if (isMediaDomain(url)) return null // pages JS/vidéo : le fetch nu ne donne rien de lisible
  const safe = await validateSafeExternalUrl(url)
  if (!safe.ok || !safe.url) return null
  const res = await fetchWithTimeout(safe.url, 7000)
  if (!res || !res.ok) return null
  // Vérifie aussi l'URL finale après redirection éventuelle
  if (res.url) {
    const finalSafe = await validateSafeExternalUrl(res.url)
    if (!finalSafe.ok) return null
  }
  const html = await res.text().catch(() => '')
  if (!html) return null
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).slice(0, 200) : url
  const text = htmlToText(html, maxLen)
  if (!text) return null
  return { url, title, text }
}

/** Résume localement une liste de résultats (extraction de phrases clés). */
export function summarizeResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return ''
  const qTokens = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
  )
  // Phrase des snippets la plus pertinente (max tokens partagés)
  let bestSentence = ''
  let bestScore = 0
  for (const r of results) {
    const sentences = r.snippet.split(/(?<=[.!?])\s+/)
    for (const s of sentences) {
      const words = s.toLowerCase().split(/\s+/)
      let score = 0
      for (const w of words) if (qTokens.has(w.replace(/[^\p{L}\p{N}]/gu, ''))) score++
      score /= Math.sqrt(words.length + 1)
      if (score > bestScore && s.length > 30) {
        bestScore = score
        bestSentence = s
      }
    }
  }
  const domains = [...new Set(results.slice(0, 5).map((r) => r.domain))]
  const lines = [
    `J'ai consulté **${results.length} sources web** (${domains.slice(0, 3).join(', ')}${results.length > 3 ? '…' : ''}).`,
    bestSentence ? `Ce qui ressort principalement : ${bestSentence}` : '',
    `Les titres les plus pertinents pour « ${query} » :`,
    results
      .slice(0, 4)
      .map((r, i) => `${i + 1}. **${r.title}** — *${r.domain}*${r.snippet ? ` : ${r.snippet.slice(0, 180)}` : ''}`)
      .join('\n'),
  ]
  return lines.filter(Boolean).join('\n\n')
}

/** Identifiant de requête (pour le RNG de variation des réponses). */
export function queryHash(query: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < query.length; i++) {
    h ^= query.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
