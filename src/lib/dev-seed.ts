// ─── NEXUS — Compte Dev et agent Dev (amorçage automatique) ──────────────────
// Le compte développeur est créé dès que l'instance possède au moins un compte
// (donc juste après la création du propriétaire). Son mot de passe vient de la
// variable d'environnement NEXUS_DEV_PASSWORD, ou de la valeur par défaut
// ci-dessous — affichée UNE fois dans la console du serveur.

import { db } from './db'
import { DEV_LOGIN, hashPassword } from './auth'

/** Mot de passe initial du compte Dev (à changer depuis le dashboard). */
export const DEV_DEFAULT_PASSWORD = process.env.NEXUS_DEV_PASSWORD?.trim() || 'dev2026'

export const DEV_AGENT_SPEC = {
  name: 'Dev',
  emoji: '🛠️',
  role: 'specialiste',
  color: '#22d3ee',
  description:
    'Agent développeur de NEXUS : il lit le code source, diagnostique, et propose des correctifs pour améliorer l’intelligence et les performances du système.',
  prompt: [
    'Tu es Dev, l’ingénieur interne de NEXUS. Tu connais l’architecture du projet sur le bout des doigts.',
    'Tu réponds en français, de façon technique, directe et actionnable : pas de blabla, des faits appuyés sur le code réel que tu as lu.',
    'Quand on te demande d’améliorer l’intelligence, tu identifies précisément le module concerné (banque de connaissances, classifieur, moteur de règles, mémoire) et tu proposes une modification concrète et vérifiable.',
    'Tu cites toujours les fichiers et les lignes : chaque affirmation est traçable.',
    'Tu ne modifies jamais le code sans proposer un correctif explicite et attendre la validation.',
  ].join('\n'),
  specialties: ['architecture', 'diagnostic', 'refactorisation', 'intelligence', 'correctifs'],
} as const

let bootstrapped = false
let bootstrapping: Promise<DevBootstrapResult> | null = null

export interface DevBootstrapResult {
  createdUser: boolean
  createdAgent: boolean
  userId: string | null
  agentId: string | null
  login: string
  password: string | null
}

/** Identifiant du compte Dev (le crée si besoin). */
export async function getDevUserId(): Promise<string | null> {
  try {
    const rows = await db.user.findMany({ where: { role: 'dev' }, take: 1 })
    const found = rows?.[0]
    return found ? String(found.id) : null
  } catch {
    return null
  }
}

/** Agent Dev du compte (le crée si besoin). */
export async function getDevAgentId(userId: string): Promise<string | null> {
  try {
    const rows = await db.agentProfile.findMany({ where: { userId, systemKey: 'dev' }, take: 1 })
    const found = rows?.[0]
    return found ? String(found.id) : null
  } catch {
    return null
  }
}

async function doBootstrap(): Promise<DevBootstrapResult> {
  const result: DevBootstrapResult = {
    createdUser: false,
    createdAgent: false,
    userId: null,
    agentId: null,
    login: DEV_LOGIN,
    password: null,
  }
  try {
    // Tant qu'aucun compte n'existe, on laisse la place au propriétaire :
    // l'écran d'accueil doit pouvoir proposer la création du premier compte.
    const total = await db.user.count()
    if (total === 0) return result

    let devId = await getDevUserId()
    if (!devId) {
      const { hash, salt } = hashPassword(DEV_DEFAULT_PASSWORD)
      const user = await db.user.create({
        data: {
          email: DEV_LOGIN,
          name: 'Dev',
          passwordHash: hash,
          salt,
          isAdmin: false,
          plan: 'dev',
          role: 'dev',
          profile: JSON.stringify({
            displayName: 'Dev',
            tone: 'direct',
            language: 'fr',
            theme: 'dark',
            assistantName: 'NEXUS',
            avatarColor: '#22d3ee',
            bio: 'Compte technique : dashboard, personnalisation du site et agent Dev.',
          }),
        },
      })
      devId = user?.id ? String(user.id) : null
      result.createdUser = Boolean(devId)
      result.password = DEV_DEFAULT_PASSWORD
      if (result.createdUser) {
        // Encadré simple : un `padEnd` sur une ligne contenant une flèche ou un
        // emoji se désaligne, on préfère un format à puces.
        console.log(
          '\n  ┌─ COMPTE DÉVELOPPEUR NEXUS ─────────────────────────────┐\n' +
            `  │  identifiant  : ${DEV_LOGIN}\n` +
            `  │  mot de passe : ${DEV_DEFAULT_PASSWORD}\n` +
            '  │  Changez-le depuis le menu « Mon compte ».\n' +
            '  └────────────────────────────────────────────────────────┘\n'
        )
      }
    }
    if (!devId) return result
    result.userId = devId

    const agentId = await getDevAgentId(devId)
    if (!agentId) {
      const agent = await db.agentProfile.create({
        data: {
          userId: devId,
          name: DEV_AGENT_SPEC.name,
          emoji: DEV_AGENT_SPEC.emoji,
          role: DEV_AGENT_SPEC.role,
          description: DEV_AGENT_SPEC.description,
          prompt: DEV_AGENT_SPEC.prompt,
          specialties: JSON.stringify(DEV_AGENT_SPEC.specialties),
          color: DEV_AGENT_SPEC.color,
          enabled: true,
          writer: false,
          systemKey: 'dev',
        },
      })
      result.createdAgent = Boolean(agent?.id)
      result.agentId = agent?.id ? String(agent.id) : null
    } else {
      result.agentId = agentId
    }
    return result
  } catch (err) {
    console.error('[dev-seed] amorçage impossible :', err instanceof Error ? err.message : err)
    return result
  }
}

/**
 * Amorçage idempotent : ne s'exécute qu'une fois par processus serveur.
 * À appeler depuis les routes d'authentification.
 */
export async function ensureDevBootstrap(): Promise<DevBootstrapResult> {
  if (bootstrapped) {
    const devId = await getDevUserId()
    return {
      createdUser: false,
      createdAgent: false,
      userId: devId,
      agentId: devId ? await getDevAgentId(devId) : null,
      login: DEV_LOGIN,
      password: null,
    }
  }
  if (!bootstrapping) {
    bootstrapping = doBootstrap().then((r) => {
      // Tant qu'aucun compte n'existe, l'amorçage n'a rien pu faire : on ne
      // verrouille PAS le drapeau, sinon le compte Dev ne serait jamais créé
      // (une simple tentative de connexion avant inscription suffirait).
      if (r.userId) bootstrapped = true
      bootstrapping = null
      return r
    })
  }
  return bootstrapping
}
