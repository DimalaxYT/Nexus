// ─── NEXUS — Outils de comptes connectés (mail / GitHub / TikTok) ────────────
// Les agents peuvent UTILISER les comptes reliés par l'utilisateur dans le
// panneau Connexions :
//   • Gmail      → lecture RÉELLE des derniers mails (IMAP imap.gmail.com:993,
//                  mot de passe d'application, via imapflow)
//   • GitHub     → profil, repos récents, notifications (API REST officielle)
//   • TikTok     → profil public + dernières vidéos (page profil parsée)
// Tout tourne localement : les secrets ne quittent JAMAIS ce serveur et ne
// sont jamais renvoyés au client. Chaque fonction renvoie un résultat
// structuré + un bloc « faits » injectable dans le prompt d'un LLM.

import { db } from '@/lib/db'
import type { ConnectionProvider } from './nexus-types'

export interface ConnectedAccount {
  handle: string
  secret: string
}

/** Lit la connexion ACTIVE d'un fournisseur (null si absente/échec). */
export async function getConnectedAccount(provider: ConnectionProvider): Promise<ConnectedAccount | null> {
  try {
    const row = await db.accountConnection.findFirst({ where: { provider, status: 'connected' } })
    if (!row || !row.secret) return null
    return { handle: row.handle, secret: row.secret }
  } catch {
    return null
  }
}

// ── Gmail : lecture IMAP réelle ──────────────────────────────────────────────

export interface EmailItem {
  from: string
  fromAddress: string
  subject: string
  date: string // ISO
  seen: boolean
  snippet: string
}

export interface EmailResult {
  ok: boolean
  emails: EmailItem[]
  note?: string
  /** Chronos internes (diagnostic) — optionnels. */
  steps?: string[]
}

/** Trouve le chemin de la première partie « texte » d'une structure MIME. */
function findTextPart(node: unknown, path = ''): string | null {
  if (!node || typeof node !== 'object') return null
  const n = node as { part?: string; type?: string; childNodes?: unknown[] }
  const currentPath = n.part || path
  if (typeof n.type === 'string') {
    if (n.type === 'text/plain') return currentPath || null
    if (n.type === 'text/html') {
      // On garde le HTML en secours mais on continue de chercher du plain
      const deeper = (n.childNodes ?? []).map((c, i) => findTextPart(c, `${currentPath ? `${currentPath}.` : ''}${i + 1}`)).find(Boolean)
      return deeper || currentPath || null
    }
  }
  for (const [i, c] of (n.childNodes ?? []).entries()) {
    const found = findTextPart(c, `${currentPath ? `${currentPath}.` : ''}${i + 1}`)
    if (found) return found
  }
  return null
}

async function streamToText(stream: AsyncIterable<Buffer> | undefined, limit = 600): Promise<string> {
  if (!stream) return ''
  let text = ''
  try {
    for await (const chunk of stream) {
      text += chunk.toString('utf8')
      if (text.length >= limit) break
    }
  } catch {
    /* lecture partielle */
  }
  // HTML → texte brut sommaire
  text = text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text.slice(0, limit)
}

/**
 * Lit les derniers mails de la boîte Gmail connectée (IMAP RÉEL).
 * Retourne les `max` messages les plus récents de la boîte de réception.
 */
export async function fetchRecentEmails(max = 6, steps?: string[]): Promise<EmailResult> {
  const t0 = Date.now()
  const mark = (m: string) => {
    const line = `[+${Date.now() - t0} ms] ${m}`
    steps?.push(line)
    return line
  }
  const account = await getConnectedAccount('gmail')
  mark(`compte lu: ${account?.handle ?? 'AUCUN'}`)
  if (!account) {
    return { ok: false, emails: [], note: 'Aucun compte Gmail connecté — demande au créateur de relier son compte dans le panneau Connexions.' }
  }
  if (!account.handle.includes('@')) {
    return { ok: false, emails: [], note: 'Le compte Gmail enregistré n\'a pas une adresse valide.' }
  }

  const { ImapFlow } = await import('imapflow')
  mark('imapflow importé')
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: account.handle, pass: account.secret },
    logger: false,
    emitLogs: false,
  })

  const run = async (): Promise<EmailResult> => {
    try {
      await client.connect()
      mark('connect OK')
    } catch (err) {
      mark(`connect ERREUR: ${err instanceof Error ? err.message : 'erreur'}`)
      return { ok: false, emails: [], note: `Connexion IMAP impossible (${err instanceof Error ? err.message : 'erreur'}) — vérifie le mot de passe d'application et le réseau du serveur.` }
    }
    const emails: EmailItem[] = []
    let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | null = null
    try {
      lock = await client.getMailboxLock('INBOX')
      mark('INBOX ouvert')
      // Le verrou expose le chemin ; le compteur est sur client.mailbox
      const total = (client.mailbox as { exists?: number } | undefined)?.exists ?? 0
      if (total === 0) return { ok: true, emails: [], note: 'Boîte de réception vide.' }
      const start = Math.max(1, total - max + 1)
      const range = start === total ? String(total) : `${start}:${total}`

      // PHASE 1 : en-têtes (enveloppe, drapeaux, structure MIME) — on ne peut
      // PAS télécharger les corps PENDANT l'itération fetch : le protocole IMAP
      // est au milieu d'un FETCH et la commande DOWNLOAD se bloque (deadlock
      // réel : connect OK, INBOX OK, puis silence jusqu'au timeout). On collecte
      // d'abord TOUT, puis on télécharge les extraits après coup (PHASE 2).
      interface RawMsg {
        uid: number
        envelope: { subject?: string; date?: string | Date; from?: { name?: string; address?: string }[] } | undefined
        flags: Set<string>
        internalDate: Date | null
        bodyStructure: unknown
      }
      const raws: RawMsg[] = []
      for await (const msg of client.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true, bodyStructure: true })) {
        raws.push({
          uid: msg.uid,
          envelope: msg.envelope,
          flags: (msg.flags as unknown as Set<string>) ?? new Set<string>(),
          internalDate: msg.internalDate ? new Date(msg.internalDate) : null,
          bodyStructure: msg.bodyStructure,
        })
      }
      mark(`phase 1 : ${raws.length} en-têtes reçus`)

      // PHASE 2 : extraits de texte (après la fin du FETCH — plus de deadlock)
      for (const m of raws) {
        const fromEntry = m.envelope?.from?.[0]
        const from = fromEntry?.name || fromEntry?.address || 'Expéditeur inconnu'
        const fromAddress = fromEntry?.address ?? ''
        let snippet = ''
        try {
          const part = findTextPart(m.bodyStructure)
          if (part) {
            const dl = await client.download(m.uid, part, { uid: true })
            snippet = await streamToText(dl.content)
          }
        } catch {
          /* pas d'extrait : le sujet et l'expéditeur suffisent */
        }
        emails.push({
          from: from.slice(0, 80),
          fromAddress: fromAddress.slice(0, 100),
          subject: (m.envelope?.subject || '(sans objet)').slice(0, 160),
          date: new Date(m.internalDate ?? m.envelope?.date ?? Date.now()).toISOString(),
          seen: m.flags instanceof Set ? m.flags.has('\\Seen') : false,
          snippet,
        })
      }
      mark(`phase 2 : extraits lus`)
      emails.reverse() // du plus récent au plus ancien
      mark(`${emails.length} mails lus`)
      return { ok: true, emails, steps }
    } catch (err) {
      return { ok: false, emails, note: `Lecture IMAP interrompue : ${err instanceof Error ? err.message : 'erreur'}` }
    } finally {
      try {
        lock?.release()
      } catch {
        /* déjà relâché */
      }
      try {
        client.close()
      } catch {
        /* déjà fermé */
      }
    }
  }

  // Garde-fou : ne jamais faire attendre le chat plus de 25 s
  return Promise.race([
    run(),
    new Promise<EmailResult>((resolve) =>
      setTimeout(() => {
        try {
          client.close()
        } catch {
          /* fermé */
        }
        resolve({ ok: false, emails: [], note: 'Délai dépassé en joignant imap.gmail.com (réseau du serveur).' })
      }, 25_000)
    ),
  ])
}

// ── GitHub : API REST officielle ─────────────────────────────────────────────

export interface GithubRepo {
  name: string
  fullName: string
  url: string
  language: string
  stars: number
  pushedAt: string
  private: boolean
  description: string
}

export interface GithubNotification {
  repo: string
  title: string
  reason: string
  at: string
  unread: boolean
}

export interface GithubResult {
  ok: boolean
  login: string
  publicRepos: number
  followers: number
  repos: GithubRepo[]
  notifications: GithubNotification[]
  note?: string
}

export async function fetchGithubActivity(): Promise<GithubResult> {
  const account = await getConnectedAccount('github')
  const empty: GithubResult = { ok: false, login: '', publicRepos: 0, followers: 0, repos: [], notifications: [] }
  if (!account) return { ...empty, note: 'Aucun compte GitHub connecté — relie-le dans le panneau Connexions (Personal Access Token).' }
  const headers = {
    Authorization: `Bearer ${account.secret}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'NEXUS-App',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  try {
    const [userRes, reposRes, notifRes] = await Promise.all([
      fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(12_000) }),
      fetch('https://api.github.com/user/repos?sort=pushed&per_page=6&affiliation=owner,collaborator,organization_member', { headers, signal: AbortSignal.timeout(12_000) }),
      fetch('https://api.github.com/notifications?per_page=8', { headers, signal: AbortSignal.timeout(12_000) }),
    ])
    if (userRes.status === 401) return { ...empty, note: 'Token GitHub refusé (401) — il a peut-être expiré, reconnecte le compte.' }
    if (!userRes.ok) return { ...empty, note: `GitHub a répondu ${userRes.status}.` }
    const user = (await userRes.json()) as { login?: string; public_repos?: number; followers?: number }
    const repos: GithubRepo[] = reposRes.ok
      ? ((await reposRes.json()) as unknown[]).slice(0, 6).map((r) => {
          const repo = r as { name?: string; full_name?: string; html_url?: string; language?: string; stargazers_count?: number; pushed_at?: string; private?: boolean; description?: string }
          return {
            name: repo.name ?? '?',
            fullName: repo.full_name ?? repo.name ?? '?',
            url: repo.html_url ?? '',
            language: repo.language ?? '',
            stars: repo.stargazers_count ?? 0,
            pushedAt: repo.pushed_at ?? '',
            private: Boolean(repo.private),
            description: (repo.description ?? '').slice(0, 140),
          }
        })
      : []
    const notifications: GithubNotification[] = notifRes.ok
      ? ((await notifRes.json()) as unknown[]).slice(0, 8).map((n) => {
          const notif = n as { repository?: { full_name?: string }; subject?: { title?: string }; reason?: string; updated_at?: string; unread?: boolean }
          return {
            repo: notif.repository?.full_name ?? '?',
            title: notif.subject?.title ?? '?',
            reason: notif.reason ?? '',
            at: notif.updated_at ?? '',
            unread: Boolean(notif.unread),
          }
        })
      : []
    return {
      ok: true,
      login: user.login ?? account.handle ?? 'compte-github',
      publicRepos: user.public_repos ?? 0,
      followers: user.followers ?? 0,
      repos,
      notifications,
    }
  } catch (err) {
    return { ...empty, note: `Réseau indisponible pour joindre GitHub : ${err instanceof Error ? err.message : 'erreur'}` }
  }
}

// ── TikTok : profil public parsé (aucun mot de passe requis) ─────────────────

export interface TiktokVideo {
  desc: string
  url: string
  plays: number
  likes: number
  createdAt: string
}

export interface TiktokResult {
  ok: boolean
  handle: string
  nickname: string
  followers: number
  likes: number
  videoCount: number
  videos: TiktokVideo[]
  note?: string
}

const TIKTOK_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** Formatage compact des gros nombres (1,2 M etc.). */
function compact(n: number): number {
  return Number.isFinite(n) ? n : 0
}

export async function fetchTikTokProfile(handleInput?: string): Promise<TiktokResult> {
  const account = await getConnectedAccount('tiktok')
  const handle = (handleInput || account?.handle || '').replace(/^@/, '').trim()
  const empty: TiktokResult = { ok: false, handle, nickname: '', followers: 0, likes: 0, videoCount: 0, videos: [] }
  if (!handle) return { ...empty, note: 'Aucun compte TikTok relié — donne ton @pseudo dans le panneau Connexions.' }

  const parseUniversal = (html: string): TiktokResult | null => {
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
    if (!m) return null
    try {
      const data = JSON.parse(m[1]) as Record<string, unknown>
      const scope = (data.__DEFAULT_SCOPE__ ?? {}) as Record<string, unknown>
      const detail = (scope['webapp.user-detail'] ?? {}) as Record<string, unknown>
      const userInfo = (detail.userInfo ?? {}) as Record<string, unknown>
      const user = (userInfo.user ?? {}) as { nickname?: string; uniqueId?: string }
      const stats = (userInfo.stats ?? {}) as { followerCount?: number; heartCount?: number; videoCount?: number }
      const itemList = (detail.itemList ?? []) as unknown[]
      const videos: TiktokVideo[] = itemList.slice(0, 6).map((v, i) => {
        const item = v as { desc?: string; id?: string; createTime?: number; stats?: { playCount?: number; diggCount?: number } }
        return {
          desc: (item.desc ?? '').slice(0, 140),
          url: item.id ? `https://www.tiktok.com/@${handle}/video/${item.id}` : '',
          plays: compact(item.stats?.playCount ?? 0),
          likes: compact(item.stats?.diggCount ?? 0),
          createdAt: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
        }
      })
      if (!user.uniqueId && videos.length === 0) return null
      return {
        ok: true,
        handle: user.uniqueId || handle,
        nickname: user.nickname ?? '',
        followers: compact(stats.followerCount ?? 0),
        likes: compact(stats.heartCount ?? 0),
        videoCount: compact(stats.videoCount ?? 0),
        videos,
      }
    } catch {
      return null
    }
  }

  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: { 'User-Agent': TIKTOK_UA, 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(14_000),
    })
    if (res.status === 404) return { ...empty, note: `Le profil @${handle} n'existe pas (404) — vérifie le pseudo exact.` }
    if (res.ok) {
      // TikTok redirige parfois SILENCIEUSEMENT vers une page régionale
      // (/xx/about) quand la lecture est bloquée (géo-blocage du serveur,
      // réel : serveur géolocalisé HK → tiktok.com/hk/about) — dans ce cas la
      // page reçue ne contient AUCUNE donnée de profil.
      const finalPath = (() => {
        try {
          return new URL(res.url).pathname
        } catch {
          return ''
        }
      })()
      if (/\/about\/?$/.test(finalPath) || !finalPath.includes('@')) {
        return { ...empty, note: `TikTok redirige vers une page régionale (${finalPath || 'inconnue'}) — la lecture du profil est bloquée depuis la région de ce serveur. Le pseudo reste enregistré : la lecture retentera automatiquement (elle fonctionne depuis une autre région).` }
      }
      const html = await res.text()
      const parsed = parseUniversal(html)
      if (parsed) return parsed

      // Repli : balises meta (titre/description contiennent abonnés et j'aime)
      const ogDesc = html.match(/<meta[^>]+property="og:description"\s+content="([^"]*)"/)?.[1] ?? ''
      const ogTitle = html.match(/<meta[^>]+property="og:title"\s+content="([^"]*)"/)?.[1] ?? ''
      if (ogDesc || ogTitle) {
        return { ok: true, handle, nickname: ogTitle.replace(/\s*on TikTok\s*$/i, ''), followers: 0, likes: 0, videoCount: 0, videos: [], note: `Infos limitées (TikTok a réduit la page) : ${ogDesc.slice(0, 180)}` }
      }
      return { ...empty, note: 'Page TikTok reçue mais sans données exploitables (TikTok change souvent sa structure) — réessaie plus tard.' }
    }
    return { ...empty, note: `TikTok a répondu ${res.status} — le site bloque parfois les lectures automatiques ; réessaie plus tard.` }
  } catch (err) {
    return { ...empty, note: `Réseau indisponible pour joindre TikTok : ${err instanceof Error ? err.message : 'erreur'}` }
  }
}

// ── Blocs de faits pour injection LLM ────────────────────────────────────────

const fr = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function emailFactsBlock(result: EmailResult): string {
  if (!result.ok) return `BOÎTE MAIL INDISPONIBLE : ${result.note ?? 'cause inconnue'}`
  if (result.emails.length === 0) return 'BOÎTE MAIL : aucun mail dans la boîte de réception.'
  const lines = result.emails.map((e, i) => {
    const d = fr.format(new Date(e.date))
    return `${i + 1}. « ${e.subject} » — de ${e.from}${e.fromAddress ? ` <${e.fromAddress}>` : ''} · ${d}${e.seen ? '' : ' · NON LU'}${e.snippet ? `\n   extrait : ${e.snippet.slice(0, 180)}` : ''}`
  })
  return `DERNIERS MAILS (${result.emails.length}) — données réelles lues en IMAP :\n${lines.join('\n')}`
}

export function githubFactsBlock(result: GithubResult): string {
  if (!result.ok) return `GITHUB INDISPONIBLE : ${result.note ?? 'cause inconnue'}`
  const parts: string[] = []
  parts.push(`Compte : ${result.login} · ${result.publicRepos} repos publics · ${result.followers} abonnés`)
  if (result.repos.length > 0) {
    parts.push(
      `REPOS ACTIFS (dernier push) :\n${result.repos
        .map((r) => `- ${r.fullName}${r.private ? ' (privé)' : ''}${r.language ? ` [${r.language}]` : ''} · ⭐${r.stars} · poussé le ${r.pushedAt ? fr.format(new Date(r.pushedAt)) : '?'}${r.description ? ` — ${r.description}` : ''}`)
        .join('\n')}`
    )
  }
  if (result.notifications.length > 0) {
    parts.push(
      `NOTIFICATIONS (${result.notifications.length}) :\n${result.notifications
        .map((n) => `- ${n.repo} : « ${n.title} » (${n.reason}${n.unread ? ', non lue' : ''})`)
        .join('\n')}`
    )
  } else {
    parts.push('Notifications : aucune en attente.')
  }
  return `DONNÉES GITHUB RÉELLES (API officielle) :\n${parts.join('\n')}`
}

export function tiktokFactsBlock(result: TiktokResult): string {
  if (!result.ok) return `TIKTOK INDISPONIBLE : ${result.note ?? 'cause inconnue'}`
  const parts: string[] = []
  parts.push(`Profil @${result.handle}${result.nickname ? ` (${result.nickname})` : ''} · ${result.followers} abonnés · ${result.likes} j'aime · ${result.videoCount} vidéos`)
  if (result.note) parts.push(`(${result.note})`)
  if (result.videos.length > 0) {
    parts.push(
      `DERNIÈRES VIDÉOS :\n${result.videos
        .map((v, i) => `${i + 1}. « ${v.desc || '(sans description)'} » · ${v.plays} vues · ${v.likes} j'aime${v.createdAt ? ` · ${fr.format(new Date(v.createdAt))}` : ''}${v.url ? `\n   ${v.url}` : ''}`)
        .join('\n')}`
    )
  }
  return `DONNÉES TIKTOK RÉELLES (profil public) :\n${parts.join('\n')}`
}
