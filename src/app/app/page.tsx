import { AppShell } from '@/components/nexus/AppShell'

// ─── NEXUS — L'application (/app) ─────────────────────────────────────────────
// Route protégée par AuthGate : tant que l'utilisateur n'est pas connecté (dès
// qu'un compte existe sur l'instance), aucune fonction n'est accessible. La
// vitrine publique vit sur `/`.
export default function AppPage() {
  return <AppShell />
}
