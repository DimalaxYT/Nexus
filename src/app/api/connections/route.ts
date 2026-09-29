// ─── NEXUS — Connexions de comptes personnels (Gmail, GitHub, Discord) ───────
// L'utilisateur relie ses comptes : le secret (token / mot de passe d'appli)
// est vérifié RÉELLEMENT quand l'API le permet (GitHub, Discord, Gmail via
// IMAP), puis stocké en base LOCALE — il ne quitte jamais ce serveur et
// n'est JAMAIS renvoyé au client (seul un masque « …abcd » est affiché).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { CONNECTION_PROVIDERS, type AccountConnectionInfo, type ConnectionProvider } from '@/lib/nexus-types'

export const runtime = 'nodejs'

const PROVIDER_IDS = CONNECTION_PROVIDERS.map((p) => p.id)

function maskSecret(secret: string): string {
  if (!secret) return ''
  return `…${secret.slice(-4)}`
}

function toInfo(row: {
  id: string
  provider: string
  handle: string
  status: string
  note: string
  secret: string
  createdAt: Date
}): AccountConnectionInfo {
  return {
    id: row.id,
    provider: (PROVIDER_IDS.includes(row.provider as ConnectionProvider) ? row.provider : 'github') as ConnectionProvider,
    handle: row.handle,
    status: row.status === 'connected' ? 'connected' : 'error',
    note: row.note,
    secretMask: maskSecret(row.secret),
    createdAt: row.createdAt.getTime(),
  }
}

// ── Vérifications RÉELLES par fournisseur ──────────────────────────────────

/** GitHub : GET /user avec le token → login réel du compte. */
async function verifyGithub(token: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NEXUS-App',
      },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) return { ok: false, note: 'Token refusé par GitHub (401) — vérifie le token ou ses expirations.' }
    if (res.status === 403) return { ok: false, note: 'Accès refusé par GitHub (403) — le token manque peut-être de permissions.' }
    if (!res.ok) return { ok: false, note: `GitHub a répondu ${res.status}.` }
    const data = (await res.json()) as { login?: string }
    return { ok: true, handle: data.login ?? 'compte-github', note: 'Token validé par l’API GitHub' }
  } catch (err) {
    return { ok: false, note: `Réseau indisponible pour joindre GitHub : ${err instanceof Error ? err.message : 'erreur'}` }
  }
}

/** Discord : GET /users/@me avec le token de bot → nom réel du bot. */
async function verifyDiscord(token: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 401) return { ok: false, note: 'Token refusé par Discord (401) — régénère le token du bot.' }
    if (!res.ok) return { ok: false, note: `Discord a répondu ${res.status}.` }
    const data = (await res.json()) as { username?: string }
    return { ok: true, handle: data.username ? `${data.username}` : 'bot-discord', note: 'Token de bot validé par l’API Discord' }
  } catch (err) {
    return { ok: false, note: `Réseau indisponible pour joindre Discord : ${err instanceof Error ? err.message : 'erreur'}` }
  }
}

/**
 * TikTok : le profil public est vérifié RÉELLEMENT (GET https://www.tiktok.com/@handle)
 * — aucun secret requis : on confirme que le pseudo existe avant de relier.
 */
async function verifyTikTok(handle: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  const clean = handle.replace(/^@/, '').trim()
  if (!/^[\w.]{2,30}$/.test(clean)) return { ok: false, note: 'Pseudo TikTok invalide (2-30 caractères : lettres, chiffres, point, underscore).' }
  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(clean)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(12_000),
    })
    if (res.status === 404) return { ok: false, note: `Le profil @${clean} n'existe pas (404) — vérifie le pseudo exact.` }
    if (res.ok) {
      // Détection de la redirection régionale silencieuse (géo-blocage réel :
      // serveur en HK → tiktok.com/hk/about renvoie 200 mais SANS le profil).
      // Le pseudo est quand même enregistré : la lecture retentera à chaque usage.
      const finalPath = (() => {
        try {
          return new URL(res.url).pathname
        } catch {
          return ''
        }
      })()
      if (/\/about\/?$/.test(finalPath) || !finalPath.includes('@')) {
        return { ok: true, handle: clean, note: `Pseudo @${clean} enregistré — TikTok limite la lecture depuis la région de ce serveur (redirection régionale) ; la lecture retentera automatiquement.` }
      }
      return { ok: true, handle: clean, note: `Profil @${clean} vérifié en direct sur TikTok` }
    }
    return { ok: false, note: `TikTok a répondu ${res.status} — le site bloque parfois les vérifications automatiques ; réessaie dans un instant.` }
  } catch (err) {
    return { ok: false, note: `Réseau indisponible pour joindre TikTok : ${err instanceof Error ? err.message : 'erreur'}` }
  }
}

/**
 * Gmail : connexion IMAP réelle (imap.gmail.com:993) avec le mot de passe
 * d'application. Réponse « A1 OK » = identifiants valides.
 */
async function verifyGmail(email: string, appPassword: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, note: 'Adresse Gmail invalide.' }
  const tls = await import('node:tls')
  return new Promise((resolve) => {
    let settled = false
    const done = (result: { ok: boolean; handle?: string; note?: string }) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* déjà fermé */
      }
      resolve(result)
    }
    let socket: import('node:tls').TLSSocket
    try {
      socket = tls.connect(
        { host: 'imap.gmail.com', port: 993, servername: 'imap.gmail.com' },
        () => {
          // On attend la bannière * OK, puis on envoie le LOGIN
          socket.write(`A1 LOGIN "${email.replace(/"/g, '')}" "${appPassword.replace(/"/g, '')}"\r\n`)
          socket.write('A2 LOGOUT\r\n')
        }
      )
    } catch (err) {
      return resolve({ ok: false, note: `Connexion IMAP impossible : ${err instanceof Error ? err.message : 'erreur'}.` })
    }
    socket.setTimeout(12_000)
    let banner = ''
    socket.on('data', (chunk: Buffer) => {
      banner += chunk.toString('utf8')
      if (banner.includes('A1 OK')) {
        done({ ok: true, handle: email, note: 'Connexion IMAP Gmail validée (mot de passe d’application accepté)' })
      } else if (banner.includes('A1 NO') || banner.includes('A1 BAD') || banner.includes('AUTHENTICATIONFAILED')) {
        done({ ok: false, note: 'Gmail a refusé les identifiants — vérifie l’adresse et le mot de passe d’application (16 caractères).' })
      }
    })
    socket.on('timeout', () => done({ ok: false, note: 'Délai dépassé en joignant imap.gmail.com (réseau ou pare-feu).' }))
    socket.on('error', (err: Error) => done({ ok: false, note: `Connexion IMAP impossible depuis ce serveur : ${err.message}.` }))
  })
}

// ── Routes ────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const rows = await db.accountConnection.findMany({ orderBy: { updatedAt: 'desc' } })
    return Response.json({ connections: rows.map(toInfo) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible', connections: [] },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const provider = String(body?.provider ?? '') as ConnectionProvider
  if (!PROVIDER_IDS.includes(provider)) {
    return Response.json({ error: 'Fournisseur inconnu (gmail, github, discord ou tiktok)' }, { status: 400 })
  }
  const secret = String(body?.secret ?? '').trim()
  const handleInput = String(body?.handle ?? '').trim().slice(0, 120)

  // TikTok : pas de secret (profil public) mais le pseudo est OBLIGATOIRE
  if (provider === 'tiktok') {
    if (!handleInput) {
      return Response.json({ error: 'Ton @pseudo TikTok est requis (ex : @tonpseudo).' }, { status: 400 })
    }
  } else if (!secret || secret.length < 8) {
    return Response.json({ error: 'Le secret (token / mot de passe d’application) est requis (8 caractères minimum).' }, { status: 400 })
  }

  // Vérification réelle selon le fournisseur
  const verdict =
    provider === 'github'
      ? await verifyGithub(secret)
      : provider === 'discord'
        ? await verifyDiscord(secret)
        : provider === 'tiktok'
          ? await verifyTikTok(handleInput)
          : await verifyGmail(handleInput, secret)

  const handle = verdict.handle ?? handleInput ?? ''
  const status = verdict.ok ? 'connected' : 'error'
  const note = verdict.note ?? ''

  try {
    // Une seule connexion par fournisseur (on remplace l'existante)
    const existing = await db.accountConnection.findFirst({ where: { provider } })
    const data = { provider, handle, secret: secret || 'profil-public', status, note }
    const row = existing
      ? await db.accountConnection.update({ where: { id: existing.id }, data })
      : await db.accountConnection.create({ data })
    return Response.json({ connection: toInfo(row), ok: verdict.ok })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Enregistrement impossible' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  try {
    if (id === 'all') {
      await db.accountConnection.deleteMany({})
      return Response.json({ ok: true })
    }
    if (!id) return Response.json({ error: 'id requis' }, { status: 400 })
    await db.accountConnection.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Suppression impossible' },
      { status: 500 }
    )
  }
}
