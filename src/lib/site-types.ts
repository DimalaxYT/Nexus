// ─── NEXUS — Réglages du site : types et valeurs par défaut ─────────────────
// Module volontairement SANS dépendance Node : il est importé par des
// composants client. L'accès à la base vit dans `site-settings.ts`.


export interface SiteSettings {
  /** Nom affiché partout (onglet du navigateur, logo, page de connexion). */
  appName: string
  /** Sous-titre sous le logo. */
  tagline: string
  /** Emoji du logo (à la place du robot). */
  logoEmoji: string
  /** Couleur principale (#hex). */
  accent: string
  /** Couleur secondaire des dégradés (#hex). */
  accent2: string
  /** Titre de l'écran de connexion. */
  loginTitle: string
  loginSubtitle: string
  /** Titre du bloc d'accueil du Hub. */
  welcomeTitle: string
  welcomeSubtitle: string
  /** Pied de page de la sidebar. */
  footerText: string
  /** CSS libre injecté dans la page (pour aller plus loin que les réglages). */
  customCss: string
  /** Tuiles de l'accueil masquées (identifiants de vue). */
  hiddenTiles: string[]
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  appName: 'NEXUS',
  tagline: 'Agent IA',
  logoEmoji: '',
  accent: '#4f46e5',
  accent2: '#0ea5e9',
  loginTitle: 'Espace privé',
  loginSubtitle: 'Connectez-vous pour retrouver votre historique, vos agents et vos clés API.',
  welcomeTitle: 'Bonjour',
  welcomeSubtitle: 'Que veux-tu construire aujourd’hui ?',
  footerText: 'IA 100 % locale — cerveau embarqué, aucune API externe.',
  customCss: '',
  hiddenTiles: [],
}

/**
 * Nettoie du CSS libre : on retire les vecteurs classiques d'injection
 * (fermeture de balise style, scripts, imports distants). Le reste est du CSS.
 */
export function sanitizeCss(raw: string): string {
  let css = String(raw ?? '')
  css = css.replace(/<\/\s*style/gi, '')
  css = css.replace(/<\s*\/?\s*script/gi, '')
  css = css.replace(/@import\s+url\(\s*['"]?https?:/gi, '/* import distant bloqué */ @import ')
  css = css.replace(/expression\s*\(/gi, '')
  css = css.replace(/javascript\s*:/gi, '')
  return css
}
