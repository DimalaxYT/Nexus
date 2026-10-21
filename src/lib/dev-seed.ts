// ─── NEXUS — Compte Dev et agent Dev (amorçage automatique) ──────────────────
// Le compte développeur est créé dès que l'instance possède au moins un compte
// (donc juste après la création du propriétaire). Son mot de passe vient de la
// variable d'environnement NEXUS_DEV_PASSWORD, ou de la valeur par défaut
// ci-dessous — affichée UNE fois dans la console du serveur.

import { db } from './db'
import { DEV_LOGIN, hashPassword, verifyPassword } from './auth'

/** Mot de passe public du compte Dev (documenté dans le README). */
const PUBLIC_DEV_PASSWORD = 'dev2026'

/** Mot de passe initial du compte Dev (à changer depuis le dashboard). */
export const DEV_DEFAULT_PASSWORD = process.env.NEXUS_DEV_PASSWORD?.trim() || PUBLIC_DEV_PASSWORD

/** Empreinte du dernier hachage vérifié (évite un calcul scrypt à chaque démarrage). */
const DEV_PASSWORD_CHECK_KEY = 'nexus.dev.passwordCheck'

/**
 * Le compte Dev peut exister AVANT le premier démarrage : base livrée avec le
 * dépôt, ou importée dans Turso. Il porte alors le mot de passe public par
 * défaut, et NEXUS_DEV_PASSWORD (qui ne servait qu'à la création) restait sans
 * effet. On le remplace donc ici — mais seulement s'il est encore celui par
 * défaut : un mot de passe changé depuis « Mon compte » n'est jamais touché.
 * Les sessions du compte sont révoquées au passage.
 */
async function applyEnvDevPassword(devId: string): Promise<void> {
  const wanted = process.env.NEXUS_DEV_PASSWORD?.trim()
  if (!wanted || wanted === PUBLIC_DEV_PASSWORD) return
  const user = await db.user.findUnique({ where: { id: devId } })
  const storedHash = String(user?.passwordHash ?? '')
  const storedSalt = String(user?.salt ?? '')
  if (!storedHash || !storedSalt) return
  const mark = await db.siteSetting.findUnique({ where: { key: DEV_PASSWORD_CHECK_KEY } })
  if (mark?.value === `${devId}:${storedHash.slice(0, 24)}`) return
  let finalHash = storedHash
  if (verifyPassword(PUBLIC_DEV_PASSWORD, storedSalt, storedHash)) {
    const { hash, salt } = hashPassword(wanted)
    await db.user.update({ where: { id: devId }, data: { passwordHash: hash, salt } })
    await db.session.deleteMany({ where: { userId: devId } })
    finalHash = hash
    console.log('[dev-seed] compte Dev : mot de passe par défaut remplacé par NEXUS_DEV_PASSWORD')
  }
  const value = `${devId}:${finalHash.slice(0, 24)}`
  await db.siteSetting.upsert({
    where: { key: DEV_PASSWORD_CHECK_KEY },
    create: { value, updatedBy: 'dev-seed' },
    update: { value, updatedBy: 'dev-seed' },
  })
}

export const DEV_AGENT_SPEC = {
  name: 'Dev',
  emoji: '🛠️',
  role: 'specialiste',
  color: '#ffffff',
  description:
    'Agent développeur de NEXUS : il lit le code source, diagnostique, fabrique et applique des correctifs pour améliorer le système.',
  prompt: [
    'Tu es Dev, l’ingénieur interne de NEXUS. Tu connais l’architecture du projet sur le bout des doigts.',
    'Tu réponds en français, de façon technique, directe et actionnable : pas de blabla, des faits appuyés sur le code réel que tu as lu.',
    'Quand on te demande d’améliorer l’intelligence, tu identifies précisément le module concerné (banque de connaissances, classifieur, moteur de règles, mémoire) et tu proposes une modification concrète et vérifiable.',
    'Tu cites toujours les fichiers et les lignes : chaque affirmation est traçable.',
    'Tu ne modifies jamais le code sans proposer un correctif explicite et attendre la validation — sauf si l’utilisateur demande explicitement de l’appliquer (« applique »).',
    'Une demande de réparation (« corrige… », « améliore… ») ne s’arrête pas au diagnostic : tu résous la cible (fichier, symbole ou module), tu cherches les défauts réels et corrigeables, et tu fabriques les correctifs correspondants. Si rien de sûr n’est trouvé, tu le dis et tu demandes l’ancre exacte — jamais de faux correctif.',
    'Une demande peut contenir plusieurs instructions : tu les traites toutes, et tu produis un correctif par fichier (les modifications d’un même fichier sont fusionnées).',
  ].join('\n'),
  specialties: ['architecture', 'diagnostic', 'refactorisation', 'intelligence', 'correctifs'],
} as const

let bootstrapped = false
let bootstrapping: Promise<DevBootstrapResult> | null = null
let lastResult: DevBootstrapResult | null = null

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
            avatarColor: '#ffffff',
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
    if (!result.createdUser) {
      await applyEnvDevPassword(devId).catch((err: unknown) => {
        console.error('[dev-seed] NEXUS_DEV_PASSWORD non appliqué :', err instanceof Error ? err.message : err)
      })
    }

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
  // Déjà amorcé : on renvoie le résultat mémorisé, sans requête. Cet appel est
  // fait par /api/auth/me à CHAQUE ouverture de l'application : il coûtait deux
  // lectures en base pour un résultat qu'aucun appelant n'utilise.
  if (bootstrapped && lastResult) return { ...lastResult, createdUser: false, createdAgent: false, password: null }
  if (!bootstrapping) {
    bootstrapping = doBootstrap().then((r) => {
      // Tant qu'aucun compte n'existe, l'amorçage n'a rien pu faire : on ne
      // verrouille PAS le drapeau, sinon le compte Dev ne serait jamais créé
      // (une simple tentative de connexion avant inscription suffirait).
      if (r.userId) {
        bootstrapped = true
        lastResult = r
      }
      bootstrapping = null
      return r
    })
  }
  return bootstrapping
}
