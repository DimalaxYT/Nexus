import { redirect } from 'next/navigation'
import { countUsers, getCurrentUser } from '@/lib/auth'
import { Landing } from '@/components/nexus/Landing'

// ─── NEXUS — Page d'accueil PUBLIQUE (vitrine) ────────────────────────────────
// Aucune fonction de l'app ici : c'est une vitrine. Un visiteur connecté est
// envoyé directement dans son espace (/app). Sinon, il découvre le produit et
// passe par « Ouvrir NEXUS » pour se connecter / créer son compte.
// NB : redirect() lève une erreur de contrôle — ne JAMAIS la placer dans un
// try/catch qui l'avalerait.

export const dynamic = 'force-dynamic'

export default async function Home() {
  // Les deux lectures partent en parallèle (et sont servies depuis le cache
  // d'authentification quand il est chaud) : un visiteur connecté est redirigé
  // sans attendre deux allers-retours successifs vers la base.
  const [hasAccounts, loggedIn] = await Promise.all([
    // Base absente ou vide (premier lancement) : la vitrine s'affiche normalement.
    countUsers()
      .then((n) => n > 0)
      .catch(() => false),
    getCurrentUser()
      .then((u) => Boolean(u))
      .catch(() => false),
  ])
  if (loggedIn) redirect('/app')

  return <Landing hasAccounts={hasAccounts} />
}
