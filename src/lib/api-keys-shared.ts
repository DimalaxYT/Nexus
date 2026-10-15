// ─── NEXUS — Parties partagées des clés API (sûres côté client) ───────────────
// IMPORTANT : ce module est importé par du code navigateur ('use client'),
// notamment src/components/nexus/ApiKeysPanel.tsx. Il ne doit DONC JAMAIS
// importer de module réservé au serveur (pas de `db`, pas de `crypto`, pas de
// `fs`, pas de `path`, pas de `security`, …). Tout ce qui est côté serveur vit
// dans `@/lib/api-keys`. Gardez ce fichier strictement côté navigateur.
//
// `rules.ts` ne contient aucun import serveur : l'importer en `import type`
// est sans risque (supprimé au build, aucun code exécutable embarqué).

import type { ReplyRule } from '@/lib/rules'

export const KEY_PREFIX = 'nx_'

export interface ApiKeyConfig {
  /** Règles « déclencheur → réponse exacte », évaluées dans l'ordre. */
  rules: ReplyRule[]
  /** Prompt système propre à cette clé (le « métier » du chatbot vendu). */
  systemPrompt: string
  /** Message renvoyé quand le visiteur ouvre la conversation. */
  welcomeMessage: string
  /** Réponse quand rien n'a été trouvé (ou que le cerveau n'a rien produit). */
  fallbackMessage: string
  /** Origines autorisées (CORS). Vide = toutes. */
  allowedOrigins: string[]
  /** Appels maximum par minute (0 = illimité). */
  rateLimitPerMin: number
  /** Utiliser l'agent lié (sa personnalité / son blueprint) avant le cerveau. */
  useAgent?: boolean
  /** Ne répondre QUE les règles : jamais le cerveau local. */
  strictRulesOnly?: boolean
  /** Renvoyer le détail du parcours (diagnostic) dans la réponse JSON. */
  debug?: boolean
  /** Déclaration d'usage personnel et non commercial (horodatée, posée par le serveur). */
  personalUseAcceptedAt?: string
  /** Fin de validité de la clé (ISO). Au-delà, la clé est refusée jusqu'au renouvellement. */
  expiresAt?: string
}

/** Politique d'usage : clés strictement personnelles et non commerciales. */
export const PERSONAL_KEY_POLICY = {
  /** Nombre maximum de clés actives par compte. */
  maxKeysPerAccount: 5,
  /** Durées de validité proposées (jours). */
  lifetimesDays: [30, 90, 365] as const,
  defaultLifetimeDays: 90,
  /** Plafond d'appels par minute, quel que soit le réglage saisi. */
  maxRateLimitPerMin: 120,
}

export interface ApiKeyInfo {
  id: string
  name: string
  /** Préfixe affichable (jamassecret). */
  prefix: string
  last4: string
  agentId: string
  blueprintId: string
  config: ApiKeyConfig
  enabled: boolean
  totalCalls: number
  createdAt: Date | number
  lastUsedAt: Date | number | null
  updatedAt: Date | number
}
