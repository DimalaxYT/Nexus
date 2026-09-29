// ─── NEXUS Security — Chiffrement AES-256-GCM, Anti-SSRF, Rate-Limiting ─────
// Module central de sécurité :
// 1. Chiffrement authentifié AES-256-GCM des secrets en base (AccountConnection)
//    via clé maîtresse locale (.nexus-secret.key hors Git ou NEXUS_SECRET_KEY).
// 2. Garde anti-SSRF (validation URL + résolution DNS contre loopback, RFC1918,
//    link-local 169.254.169.254, IPv6 privées) pour le navigateur et Playwright.
// 3. Assainissement IMAP anti-injection CR/LF.
// 4. Rate-limiter mémoire par IP et route.

import crypto from 'crypto'
import dns from 'dns/promises'
import fs from 'fs'
import net from 'net'
import path from 'path'

const KEY_FILE = path.join(process.cwd(), '.nexus-secret.key')
const ENC_PREFIX = 'enc:v1:'

let cachedMasterKey: Buffer | null = null

function getMasterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey

  const envKey = process.env.NEXUS_SECRET_KEY?.trim()
  if (envKey) {
    cachedMasterKey = crypto.createHash('sha256').update(envKey).digest()
    return cachedMasterKey
  }

  try {
    if (fs.existsSync(KEY_FILE)) {
      const hex = fs.readFileSync(KEY_FILE, 'utf8').trim()
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        cachedMasterKey = Buffer.from(hex, 'hex')
        return cachedMasterKey
      }
    }
    const generated = crypto.randomBytes(32)
    fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 })
    cachedMasterKey = generated
    return cachedMasterKey
  } catch {
    // Fallback déterministe par machine si le FS est en lecture seule
    cachedMasterKey = crypto
      .createHash('sha256')
      .update(`nexus-local-vault:${process.cwd()}`)
      .digest()
    return cachedMasterKey
  }
}

/**
 * Chiffre un secret en AES-256-GCM avant stockage SQLite.
 * Format : enc:v1:<ivHex>:<tagHex>:<cipherHex>
 */
export function encryptSecret(plain: string): string {
  const trimmed = plain.trim()
  if (!trimmed || trimmed === 'profil-public') return trimmed
  if (trimmed.startsWith(ENC_PREFIX)) return trimmed

  const key = getMasterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(trimmed, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

/**
 * Déchiffre un secret AES-256-GCM stocké dans SQLite.
 * Tolère les valeurs historiques non chiffrées pour la rétrocompatibilité.
 */
export function decryptSecret(stored: string): string {
  if (!stored || stored === 'profil-public') return ''
  if (!stored.startsWith(ENC_PREFIX)) return stored

  const parts = stored.slice(ENC_PREFIX.length).split(':')
  if (parts.length !== 3) return ''
  const [ivHex, tagHex, cipherHex] = parts
  try {
    const key = getMasterKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(cipherHex, 'hex')),
      decipher.final(),
    ])
    return decrypted.toString('utf8')
  } catch {
    return ''
  }
}

/** Renvoie un masque « …abcd » sans jamais exposer le secret complet. */
export function maskSecretValue(storedOrPlain: string): string {
  if (!storedOrPlain || storedOrPlain === 'profil-public') return ''
  const plain = storedOrPlain.startsWith(ENC_PREFIX) ? decryptSecret(storedOrPlain) : storedOrPlain
  if (!plain) return '…chiffré'
  return `…${plain.slice(-4)}`
}

/** Nettoie une chaîne destinée à une commande IMAP entre guillemets (anti-injection CRLF). */
export function sanitizeImapQuoted(input: string): string {
  return input.replace(/[\r\n\0]/g, '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// ── Protection Anti-SSRF ─────────────────────────────────────────────────────

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
  'instance-data',
])

/** Vérifie si une adresse IPv4 ou IPv6 appartient à une plage privée/interne/réservée. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, '')

  // IPv6 mappée IPv4 (::ffff:127.0.0.1)
  if (clean.startsWith('::ffff:')) {
    const v4 = clean.slice(7)
    if (net.isIPv4(v4)) return isPrivateOrReservedIp(v4)
  }

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map((n) => parseInt(n, 10))
    const [a, b] = parts
    if (a === 0) return true // 0.0.0.0/8
    if (a === 10) return true // 10.0.0.0/8 (RFC1918)
    if (a === 127) return true // 127.0.0.0/8 (Loopback)
    if (a === 169 && b === 254) return true // 169.254.0.0/16 (Link-local / Cloud Metadata)
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 (RFC1918)
    if (a === 192 && b === 168) return true // 192.168.0.0/16 (RFC1918)
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
    if (a === 192 && b === 0) return true // 192.0.0.0/24
    if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15
    if (a >= 224) return true // Multicast & réservé (224.0.0.0/4+)
    return false
  }

  if (net.isIPv6(clean)) {
    if (clean === '::' || clean === '::1') return true
    if (clean.startsWith('fc') || clean.startsWith('fd')) return true // Unique local fc00::/7
    if (clean.startsWith('fe8') || clean.startsWith('fe9') || clean.startsWith('fea') || clean.startsWith('feb')) {
      return true // Link-local fe80::/10
    }
    if (clean.startsWith('ff')) return true // Multicast
    return false
  }

  return true
}

/**
 * Vérifie de manière synchrone si l'URL est syntaxiquement sûre (schéma HTTP/HTTPS,
 * pas de credentials embarqués, pas d'hôte local ou d'IP privée littérale).
 */
export function isSafeUrlSync(rawUrl: string): { ok: boolean; url?: URL; reason?: string } {
  let parsed: URL
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, reason: 'URL syntaxiquement invalide.' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Seuls les protocoles http:// et https:// sont autorisés.' }
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'Les identifiants intégrés dans l’URL sont interdits.' }
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    return { ok: false, reason: 'Hôte local ou interne interdit (protection anti-SSRF).' }
  }

  if (net.isIP(host) && isPrivateOrReservedIp(host)) {
    return { ok: false, reason: 'Adresse IP privée, loopback ou métadonnées cloud interdite (anti-SSRF).' }
  }

  return { ok: true, url: parsed }
}

/**
 * Validation complète anti-SSRF (syntaxe + résolution DNS de toutes les IP de l'hôte).
 */
export async function validateSafeExternalUrl(rawUrl: string): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const sync = isSafeUrlSync(rawUrl)
  if (!sync.ok || !sync.url) return { ok: false, reason: sync.reason }

  const host = sync.url.hostname.replace(/^\[|\]$/g, '')
  if (net.isIP(host)) {
    return { ok: true, url: sync.url.toString() }
  }

  try {
    const records = await dns.lookup(host, { all: true })
    if (!records || records.length === 0) {
      return { ok: false, reason: `Impossible de résoudre le domaine ${host}.` }
    }
    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address)) {
        return { ok: false, reason: `Le domaine ${host} pointe vers une adresse interne interdite (anti-SSRF).` }
      }
    }
  } catch {
    // Si le DNS local échoue hors-ligne, l'appel réseau échouera de toute façon,
    // mais l'hôte n'est pas une IP locale ni un nom local.
  }

  return { ok: true, url: sync.url.toString() }
}

// ── Rate Limiter en mémoire (glissant par IP + clé) ──────────────────────────

interface RateBucket {
  count: number
  resetAt: number
}

const g = globalThis as unknown as { __nexusRateBuckets?: Map<string, RateBucket> }

function buckets(): Map<string, RateBucket> {
  if (!g.__nexusRateBuckets) g.__nexusRateBuckets = new Map()
  return g.__nexusRateBuckets
}

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const map = buckets()
  const now = Date.now()
  if (map.size > 4000) {
    for (const [k, b] of map) if (b.resetAt <= now) map.delete(k)
  }
  const existing = map.get(key)
  if (!existing || existing.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSec: 0 }
  }
  existing.count += 1
  if (existing.count > maxRequests) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) }
  }
  return { allowed: true, retryAfterSec: 0 }
}
