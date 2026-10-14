import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { Landing } from '@/components/nexus/Landing'

// ─── NEXUS — Page d'accueil PUBLIQUE (vitrine) ────────────────────────────────
// Aucune fonction de l'app ici : c'est une vitrine. Un visiteur connecté est
// envoyé directement dans son espace (/app). Sinon, il découvre le produit et
// passe par « Ouvrir NEXUS » pour se connecter / créer son compte.
// NB : redirect() lève une erreur de contrôle — ne JAMAIS la placer dans un
// try/catch qui l'avalerait.

export const dynamic = 'force-dynamic'

export default async function Home() {
  let hasAccounts = false
  try {
    hasAccounts = (await db.user.count()) > 0
  } catch {
    // Base absente ou vide (premier lancement) : la vitrine s'affiche normalement.
  }

  let loggedIn = false
  try {
    loggedIn = Boolean(await getCurrentUser())
  } catch {
    loggedIn = false
  }
  if (loggedIn) redirect('/app')

  return <Landing hasAccounts={hasAccounts} />
}
