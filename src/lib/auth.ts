// ─── NEXUS — Authentification 100 % locale ───────────────────────────────────
// Comptes, sessions et profils de personnalisation sont stockés dans la base
// SQLite locale. Aucun service tiers, aucune dépendance externe : le hachage
// utilise `scrypt` (module `crypto` de Node) et les sessions sont des jetons
// aléatoires conservés dans un cookie httpOnly.

import crypto from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'

export const SESSION_COOKIE = 'nexus_session'
const SESSION_DAYS = 30
const SCRYPT_KEYLEN = 64

/** Champs de personnalisation propres à CHAQUE compte. */
export interface UserProfile {
  /** Prénom / nom affiché dans l'interface et utilisé par NEXUS. */
  displayName?: string
  /** Comment l'utilisateur veut que l'assistant s'appelle. */
  assistantName?: string
  /** Ton de voix demandé à NEXUS pour ce compte. */
  tone?: 'neutre' | 'chaleureux' | 'professionnel' | 'direct' | 'pedagogue'
  /** Métier / contexte : aide NEXUS à répondre plus juste. */
  bio?: string
  /** Langue de réponse souhaitée. */
  language?: string
  /** Consignes permanentes injectées dans le prompt système du compte. */
  instructions?: string
  /** Message d'accueil personnalisé du chat. */
  greeting?: string
  /** Couleur de l'avatar (dégradé de l'interface). */
  avatarColor?: string
  /** Thème préféré du compte. */
  theme?: 'dark' | 'light'
  /** Entreprise / marque (utile pour revendre des chatbots). */
  company?: string
  /** Sites ou documents de référence. */
  website?: string
}

export interface PublicUser {
  id: string
  email: string
  name: string
  isAdmin: boolean
  plan: string
  profile: UserProfile
  createdAt: Date | string | number
}

// ── Mots de passe ────────────────────────────────────────────────────────────

/** Hache un mot de passe avec un sel aléatoire (scrypt, paramètres costauds). */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex')
  return { hash, salt }
}

/** Vérifie un mot de passe sans fuite de temps (comparaison à temps constant). */
export function verifyPassword(password: string, salt: string, hash: string): boolean {
  if (!salt || !hash) return false
  try {
    const expected = Buffer.from(hash, 'hex')
    const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN)
    if (expected.length !== actual.length) return false
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())
}

/** Règle de mot de passe : 8 caractères minimum, au moins une lettre et un chiffre. */
export function passwordIssue(password: string): string | null {
  if (password.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.'
  if (!/[a-zA-ZÀ-ÿ]/.test(password)) return 'Le mot de passe doit contenir au moins une lettre.'
  if (!/\d/.test(password)) return 'Le mot de passe doit contenir au moins un chiffre.'
  return null
}

// ── Profil ───────────────────────────────────────────────────────────────────

export function parseProfile(raw: unknown): UserProfile {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as UserProfile) : {}
  } catch {
    return {}
  }
}

 
function toPublicUser(row: any): PublicUser {
  return {
    id: String(row.id),
    email: String(row.email ?? ''),
    name: String(row.name ?? ''),
    isAdmin: Boolean(row.isAdmin),
    plan: String(row.plan ?? 'free'),
    profile: parseProfile(row.profile),
    createdAt: row.createdAt,
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Crée une session persistante et pose le cookie httpOnly. */
export async function createSession(userId: string, userAgent = ''): Promise<string> {
  await purgeExpiredSessions()
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000
  await db.session.create({
    data: { id: token, userId, userAgent: userAgent.slice(0, 300), expiresAt: new Date(expiresAt), lastSeenAt: new Date(now) },
  })
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  return token
}

/** Détruit la session courante (déconnexion). */
export async function destroySession(): Promise<void> {
  try {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE)?.value
    if (token) await db.session.delete({ where: { id: token } }).catch(() => {})
    jar.delete(SESSION_COOKIE)
  } catch {
    /* hors contexte de requête : rien à faire */
  }
}

/** Petit entretien : purge les sessions expirées (appelé à la connexion). */
async function purgeExpiredSessions(): Promise<void> {
  try {
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date(Date.now()).getTime() } } })
  } catch {
    /* nettoyage best-effort */
  }
}

/** Utilisateur courant (depuis le cookie de session), ou null. */
export async function getCurrentUser(): Promise<PublicUser | null> {
  try {
    const jar = await cookies()
    const token = jar.get(SESSION_COOKIE)?.value
    if (!token) return null
    const session = await db.session.findUnique({ where: { id: token } })
    if (!session) return null
    const expiresAt = new Date(session.expiresAt as string | number | Date).getTime()
    if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
      await db.session.delete({ where: { id: token } }).catch(() => {})
      return null
    }
     
    const user = await db.user.findUnique({ where: { id: String((session as any).userId) } })
    if (!user) return null
    // Rafraîchissement discret du « dernier passage » (1 fois par heure au plus)
    const lastSeen = new Date(session.lastSeenAt as string | number | Date).getTime()
    if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60 * 60 * 1000) {
      await db.session.update({ where: { id: token }, data: { lastSeenAt: new Date() } }).catch(() => {})
      await db.user.update({ where: { id: String(user.id) }, data: { lastSeenAt: new Date() } }).catch(() => {})
    }
    return toPublicUser(user)
  } catch {
    return null
  }
}

/**
 * Filtre de cloisonnement : à passer en `where` des requêtes pour qu'un compte
 * ne voie QUE ses données. `null` = mode mono-utilisateur historique (aucun
 * compte créé sur l'instance) → aucune restriction.
 */
export function ownerFilter(userId: string | null | undefined): Record<string, unknown> | undefined {
  if (!userId) return undefined
  return { userId }
}

/** Nombre de comptes existants (pour offrir le rôle admin au premier inscrit). */
export async function countUsers(): Promise<number> {
  try {
    return await db.user.count()
  } catch {
    return 0
  }
}

/**
 * Premier compte créé : il récupère les données déjà présentes (conversations,
 * agents, connaissances…) pour que rien ne soit perdu à l'activation des comptes.
 */
export async function claimLegacyData(userId: string): Promise<void> {
  try {
    const rows = await db.user.findMany({ select: { id: true } })
    if (rows.length > 1) return // pas le premier compte : on ne touche à rien
    const tables = [
      { model: 'conversation' as const, table: 'Conversation' },
      { model: 'knowledge' as const, table: 'Knowledge' },
      { model: 'memory' as const, table: 'Memory' },
      { model: 'task' as const, table: 'Task' },
      { model: 'agentProfile' as const, table: 'AgentProfile' },
      { model: 'agentGroup' as const, table: 'AgentGroup' },
      { model: 'accountConnection' as const, table: 'AccountConnection' },
    ]
    for (const t of tables) {
       
      await (db as any)[t.model].update({
        where: { userId: null },
        data: { userId },
      })
       
      await (db as any)[t.model].update({
        where: { userId: '' },
        data: { userId },
      })
    }
  } catch {
    /* migration best-effort : une base déjà cloisonnée ignore simplement */
  }
}

/** Rendu « sûr » d'un utilisateur (jamais de hash ni de sel côté client). */
export async function getUserById(id: string): Promise<PublicUser | null> {
  try {
    const user = await db.user.findUnique({ where: { id } })
    return user ? toPublicUser(user) : null
  } catch {
    return null
  }
}

/**
 * Garde-fou des routes de données : quand au moins un compte existe sur
 * l'instance, une requête NON AUTHENTIFIÉE est refusée (401). Sans cela, elle
 * recevrait un filtre vide et verrait les données de TOUS les comptes.
 * En mode mono-utilisateur historique (aucun compte créé), tout reste ouvert.
 */
export async function ownerGuard(): Promise<
  | { ok: true; userId: string | null; scope: Record<string, unknown> | undefined }
  | { ok: false; response: Response }
> {
  const user = await getCurrentUser()
  const accounts = await countUsers()
  if (!user && accounts > 0) {
    return { ok: false, response: Response.json({ error: 'Non connecté — reconnectez-vous.' }, { status: 401 }) }
  }
  return { ok: true, userId: user?.id ?? null, scope: ownerFilter(user?.id ?? null) }
}
