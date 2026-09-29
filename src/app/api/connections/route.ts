// ─── NEXUS — Connexions de comptes (Chiffrement AES-256-GCM) ─────────────────
// L'utilisateur relie ses comptes personnels (Gmail, GitHub, Discord, TikTok) :
// le secret est vérifié RÉELLEMENT auprès du service, puis chiffré en
// AES-256-GCM avant d'être stocké en base SQLite locale.
// Il n'est JAMAIS renvoyé au client (seul un masque « …abcd » est affiché).

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { CONNECTION_PROVIDERS, type AccountConnectionInfo, type ConnectionProvider } from '@/lib/nexus-types'
import { checkRateLimit, encryptSecret, maskSecretValue, sanitizeImapQuoted } from '@/lib/security'

export const runtime = 'nodejs'

const PROVIDER_IDS = CONNECTION_PROVIDERS.map((p) => p.id)

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
    secretMask: maskSecretValue(row.secret),
    createdAt: row.createdAt.getTime(),
  }
}

// ── Vérifications RÉELLES par fournisseur ──────────────────────────────────

async function verifyGithub(secret: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${secret.trim()}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'NEXUS-Agent/2.0',
      },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, note: `GitHub a refusé le token (HTTP ${res.status})` }
    const data = (await res.json()) as { login?: string; name?: string; public_repos?: number }
    return {
      ok: true,
      handle: data.login ? `@${data.login}` : 'GitHub',
      note: `${data.name || data.login || 'Compte'} · ${data.public_repos ?? 0} repos publics (chiffré AES-256-GCM)`,
    }
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message.slice(0, 120) : 'Erreur réseau GitHub' }
  }
}

async function verifyDiscord(secret: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${secret.trim()}` },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return { ok: false, note: `Discord a refusé le token de bot (HTTP ${res.status})` }
    const data = (await res.json()) as { username?: string; discriminator?: string }
    return {
      ok: true,
      handle: data.username ? `@${data.username}` : 'Bot Discord',
      note: `Bot Discord « ${data.username ?? 'connecté'} » vérifié (chiffré AES-256-GCM)`,
    }
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message.slice(0, 120) : 'Erreur réseau Discord' }
  }
}

async function verifyTikTok(handle: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  const clean = handle.trim().replace(/^@+/, '')
  if (!clean || !/^[\w.-]{2,40}$/.test(clean)) {
    return { ok: false, note: 'Pseudo TikTok invalide (ex : @tonpseudo).' }
  }
  return {
    ok: true,
    handle: `@${clean}`,
    note: `Profil public @${clean} enregistré — tes agents pourront suivre ses vidéos.`,
  }
}

async function verifyGmail(email: string, appPassword: string): Promise<{ ok: boolean; handle?: string; note?: string }> {
  const cleanEmail = sanitizeImapQuoted(email.trim())
  const cleanPass = sanitizeImapQuoted(appPassword.replace(/\s+/g, ''))
  if (!cleanEmail.includes('@')) {
    return { ok: false, note: 'Adresse Gmail invalide.' }
  }
  if (cleanPass.length < 8) {
    return { ok: false, note: 'Mot de passe d’application Gmail requis (16 caractères).' }
  }
  try {
    const tls = await import('tls')
    return await new Promise<{ ok: boolean; handle?: string; note?: string }>((resolve) => {
      let settled = false
      const done = (r: { ok: boolean; handle?: string; note?: string }) => {
        if (settled) return
        settled = true
        try {
          socket.destroy()
        } catch {}
        resolve(r)
      }
      const socket = tls.connect(
        { host: 'imap.gmail.com', port: 993, servername: 'imap.gmail.com', timeout: 8000 },
        () => {
          // Attente de la bannière IMAP puis envoi de LOGIN assaini (anti-injection CRLF)
        }
      )
      let sentLogin = false
      let buf = ''
      socket.on('data', (chunk) => {
        buf += chunk.toString('utf8')
        if (!sentLogin && buf.includes('* OK')) {
          sentLogin = true
          socket.write(`A1 LOGIN "${cleanEmail}" "${cleanPass}"\r\n`)
        } else if (sentLogin) {
          if (buf.includes('A1 OK')) {
            socket.write('A2 LOGOUT\r\n')
            done({
              ok: true,
              handle: cleanEmail,
              note: `Boîte Gmail ${cleanEmail} vérifiée en IMAP TLS (secret chiffré AES-256-GCM)`,
            })
          } else if (buf.includes('A1 NO') || buf.includes('A1 BAD')) {
            done({
              ok: false,
              note: 'Gmail a refusé la connexion IMAP (utilise un Mot de passe d’application Google à 16 lettres).',
            })
          }
        }
      })
      socket.on('timeout', () => done({ ok: false, note: 'Délai IMAP Gmail dépassé (8s).' }))
      socket.on('error', (e) => done({ ok: false, note: `Erreur IMAP : ${e.message.slice(0, 90)}` }))
    })
  } catch (err) {
    return { ok: false, note: err instanceof Error ? err.message.slice(0, 120) : 'Erreur IMAP' }
  }
}

// ── Routes HTTP ──────────────────────────────────────────────────────────────

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
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
  const rl = checkRateLimit(`connections:${ip}`, 20, 60_000)
  if (!rl.allowed) {
    return Response.json(
      { error: `Trop de tentatives. Réessaie dans ${rl.retryAfterSec}s.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  const body = await req.json().catch(() => null)
  const provider = String(body?.provider ?? '') as ConnectionProvider
  if (!PROVIDER_IDS.includes(provider)) {
    return Response.json({ error: 'Fournisseur inconnu (gmail, github, discord ou tiktok)' }, { status: 400 })
  }
  const secret = String(body?.secret ?? '').trim()
  const handleInput = String(body?.handle ?? '').trim().slice(0, 120)

  if (provider === 'tiktok') {
    if (!handleInput) {
      return Response.json({ error: 'Ton @pseudo TikTok est requis (ex : @tonpseudo).' }, { status: 400 })
    }
  } else if (!secret || secret.length < 8) {
    return Response.json({ error: 'Le secret (token / mot de passe d’application) est requis (8 caractères minimum).' }, { status: 400 })
  }

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
  const encryptedSecret = provider === 'tiktok' ? 'profil-public' : encryptSecret(secret)

  try {
    const existing = await db.accountConnection.findFirst({ where: { provider } })
    const data = { provider, handle, secret: encryptedSecret, status, note }
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
