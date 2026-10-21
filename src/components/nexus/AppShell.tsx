'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  ChevronDown,
  Clapperboard,
  Code2,
  Home,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Link2,
  LogOut,
  Menu,
  Terminal,
  User as UserIcon,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNexusStore } from '@/lib/store'
import { AuthProvider, useAuth } from '@/lib/auth-client'
import { SiteSettingsProvider, useSiteSettings } from '@/lib/site-settings-client'
import { ThemeCycleButton } from '@/components/nexus/theme-cycle'
import { AccountAppearanceSync } from '@/components/nexus/appearance-sync'
import { readableInk } from '@/lib/appearance'
import type { ViewId } from '@/lib/nexus-types'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AgentChat } from '@/components/nexus/AgentChat'
import { lazyComponent, whenIdle } from '@/components/nexus/lazy-component'

// ── Vues chargées à la demande ───────────────────────────────────────────────
// Seule la discussion (vue d'arrivée) fait partie du premier téléchargement.
// Avant, TOUTES les vues étaient importées statiquement : studios, espace Dev,
// réglages, accueil animé… soit ~3,3 Mo de JavaScript à télécharger, analyser
// et exécuter avant de pouvoir écrire le premier message. Chaque vue est
// désormais un morceau séparé, chargé à l'ouverture — et préchargé en tâche de
// fond pour les réglages (voir NexusApp), qui s'ouvrent alors instantanément.
const viewLoading = <StudioLoading label="Chargement…" />
const studioLoading = <StudioLoading label="Chargement du studio…" />

const Hub = lazyComponent(() => import('@/components/nexus/Hub').then((m) => m.Hub), viewLoading)
const ConnectionsPanel = lazyComponent(() => import('@/components/nexus/ConnectionsPanel').then((m) => m.ConnectionsPanel), viewLoading)
const AccountPanel = lazyComponent(() => import('@/components/nexus/AccountPanel').then((m) => m.AccountPanel), viewLoading)
const BlueprintsPanel = lazyComponent(() => import('@/components/nexus/BlueprintsPanel').then((m) => m.BlueprintsPanel), viewLoading)
const ApiKeysPanel = lazyComponent(() => import('@/components/nexus/ApiKeysPanel').then((m) => m.ApiKeysPanel), viewLoading)
const DevDashboard = lazyComponent(
  () => import('@/components/nexus/DevDashboard').then((m) => m.DevDashboard),
  <StudioLoading label="Ouverture de l’espace Dev…" />
)
const ImageStudio = lazyComponent(() => import('@/components/nexus/studios/ImageStudio').then((m) => m.ImageStudio), studioLoading)
const VideoStudio = lazyComponent(() => import('@/components/nexus/studios/VideoStudio').then((m) => m.VideoStudio), studioLoading)
const CodeStudio = lazyComponent(() => import('@/components/nexus/studios/CodeStudio').then((m) => m.CodeStudio), studioLoading)
const AuthGate = lazyComponent(
  () => import('@/components/nexus/AuthGate').then((m) => m.AuthGate),
  <div className="flex h-dvh items-center justify-center bg-background">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  </div>
)

const Studio3D = dynamic(
  () => import('@/components/nexus/studios/Studio3D').then((m) => m.Studio3D),
  { ssr: false, loading: () => <StudioLoading label="Chargement du moteur 3D…" /> }
)

const BrainRoomPage = dynamic(
  () => import('@/components/nexus/BrainView').then((m) => m.BrainRoomPage),
  { ssr: false, loading: () => <StudioLoading label="Éveil du cerveau Jarvis…" /> }
)

function StudioLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

type NavItem = { id: ViewId; label: string; icon: typeof Home; hint: string }

/** Entrée réservée au compte Dev : dashboard, site, code et agent Dev. */
const DEV_NAV_ITEM: NavItem = {
  id: 'dev',
  label: 'Espace Dev',
  icon: Terminal,
  hint: 'Dashboard & code',
}

// Le site sert d'abord à UNE chose : parler avec NEXUS. La navigation met donc
// la discussion en tête, avec le strict utile autour (comptes connectés, qui
// donnent à l'IA ses capacités réelles, et le compte). Tout le reste — ateliers
// de création, blueprints, clés API, dashboard — reste accessible mais replié
// dans un groupe secondaire : rien n'est supprimé, rien ne gêne la conversation.
const NAV_PRIMARY: NavItem[] = [
  { id: 'agent', label: 'Discussion', icon: Bot, hint: 'Parler à NEXUS' },
  { id: 'connexions', label: 'Connexions', icon: Link2, hint: 'Gmail, GitHub, TikTok' },
  { id: 'compte', label: 'Mon compte', icon: UserIcon, hint: 'Profil et sécurité' },
]

const NAV_MORE: NavItem[] = [
  { id: 'hub', label: 'Accueil', icon: Home, hint: 'Centre de contrôle' },
  { id: 'cerveaux', label: 'Cerveau Jarvis', icon: Brain, hint: 'Le cerveau en direct' },
  { id: 'studios', label: 'Studios', icon: Layers, hint: '3D · Image · Vidéo · Code' },
  { id: 'blueprints', label: 'Blueprints', icon: Workflow, hint: 'Schémas d\u2019agents' },
  { id: 'cles', label: 'Clés API', icon: KeyRound, hint: 'Chatbots à vendre' },
]

function Logo() {
  const { settings } = useSiteSettings()
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="flex h-9 w-9 items-center justify-center rounded-xl text-lg shadow-lg"
        style={{
          background: `linear-gradient(135deg, ${settings.accent}, ${settings.accent2})`,
          boxShadow: `0 10px 25px -8px ${settings.accent}66`,
        }}
      >
        {settings.logoEmoji ? <span aria-hidden>{settings.logoEmoji}</span> : <Bot className="h-5 w-5 text-white" />}
      </div>
      <div className="leading-tight">
        <p className="text-sm font-extrabold tracking-widest text-foreground">{settings.appName}</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{settings.tagline}</p>
      </div>
    </div>
  )
}

function NavButton({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { view, setView } = useNexusStore()
  const Icon = item.icon
  const active = view === item.id
  return (
    <button
      onClick={() => {
        setView(item.id)
        onNavigate?.()
      }}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-all',
        active
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-primary" aria-hidden />
      )}
      <Icon className={cn('h-4.5 w-4.5 shrink-0', active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground/80')} />
      <span className="flex-1">{item.label}</span>
      <span className={cn('hidden font-mono text-[9px] uppercase tracking-wider lg:block', active ? 'text-primary/70' : 'text-muted-foreground/50 group-hover:text-muted-foreground')}>{item.hint}</span>
    </button>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { view } = useNexusStore()
  const { user } = useAuth()
  const isDev = user?.role === 'dev'
  const more = isDev ? [...NAV_MORE, DEV_NAV_ITEM] : NAV_MORE
  const inMore = more.some((item) => item.id === view)
  // Le groupe secondaire est ouvert quand on s'y trouve déjà (lien direct,
  // retour depuis un atelier), sinon replié : la discussion domine. L'état local
  // ne sert qu'à mémoriser un clic — il est initialisé à `null` (« automatique »)
  // et ne déclenche donc aucun effet de bord au montage.
  const [moreOverride, setMoreOverride] = useState<boolean | null>(null)
  const moreOpen = moreOverride ?? inMore

  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3" aria-label="Navigation principale">
      {NAV_PRIMARY.map((item) => (
        <NavButton key={item.id} item={item} onNavigate={onNavigate} />
      ))}

      <div className="mt-3 border-t border-border/60 pt-2">
        <button
          onClick={() => setMoreOverride(!moreOpen)}
          aria-expanded={moreOpen}
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', moreOpen && 'rotate-180')} />
          <span className="flex-1">Ateliers &amp; outils</span>
          <span className="font-mono text-[9px] normal-case tracking-normal text-muted-foreground/50">{more.length}</span>
        </button>
        {moreOpen && (
          <div className="mt-1 flex flex-col gap-1">
            {more.map((item) => (
              <NavButton key={item.id} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

function ThemeToggle() {
  return <ThemeCycleButton />
}

/** Menu du compte connecté (profil, déconnexion). */
function AccountMenu() {
  const { user, logout } = useAuth()
  const setView = useNexusStore((s) => s.setView)
  if (!user) return null

  const profile = user.profile ?? {}
  const label = profile.displayName || user.name || user.email.split('@')[0]
  const color = profile.avatarColor ?? '#64748b'
  const initial = label.trim().charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-2 text-left transition-colors hover:bg-muted/60"
          aria-label="Menu du compte"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)`, color: readableInk(color) }}
          >
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-foreground">{label}</span>
            <span className="block truncate text-[10px] text-muted-foreground">{user.email}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
          Connecté en tant que
          <br />
          <span className="font-semibold text-foreground">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setView('compte')} className="gap-2">
          <UserIcon className="h-4 w-4" /> Mon compte
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setView('cles')} className="gap-2">
          <KeyRound className="h-4 w-4" /> Mes clés API
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setView('blueprints')} className="gap-2">
          <Workflow className="h-4 w-4" /> Mes blueprints
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="gap-2">
          <a href="/">
            <Home className="h-4 w-4" /> Voir la vitrine publique
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void logout()} className="gap-2 text-rose-600 dark:text-rose-400">
          <LogOut className="h-4 w-4" /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Regroupe les ateliers de création : l'IA s'en sert, l'humain choisit. */
function StudiosHub() {
  const setView = useNexusStore((s) => s.setView)
  const items = [
    { id: 'studio3d' as ViewId, icon: Boxes, title: 'Studio 3D', desc: 'Éditeur temps réel, PBR, animation, export GLB/OBJ — et scènes générées par l’IA.' },
    { id: 'image' as ViewId, icon: ImageIcon, title: 'Studio Image', desc: 'Retouche photo locale, filtres, pinceau, texte et art génératif procédural.' },
    { id: 'video' as ViewId, icon: Clapperboard, title: 'Studio Vidéo', desc: 'Montage navigateur : coupes, filtres cinéma, vitesse, export webm.' },
    { id: 'code' as ViewId, icon: Code2, title: 'Studio Code', desc: '20 langages, aperçu instantané, console, versions et propositions des agents.' },
  ]
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-5 py-10 md:px-8">
        <header className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight">Studios</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Quatre ateliers de création — vos agents y travaillent aussi, sur simple demande dans le chat.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => setView(item.id)}
                className="group glass edge-glow rounded-2xl p-6 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/25"
              >
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="font-display text-lg font-semibold">{item.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  Ouvrir <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function NexusApp() {
  const { view, sidebarOpen, setSidebarOpen } = useNexusStore()
  const { user, loading, accountsExist } = useAuth()
  const { settings } = useSiteSettings()
  const footer = settings.footerText || 'IA 100 % locale — cerveau embarqué, aucune API externe.'

  // Préchargement des réglages (compte, clés, blueprints, connexions, accueil)
  // une fois l'application affichée et au repos : les ouvrir est instantané,
  // sans alourdir l'arrivée dans le chat.
  const userId = user?.id ?? null
  const isDev = user?.role === 'dev'
  useEffect(() => {
    if (loading || !userId) return
    return whenIdle(
      () => {
        const views = [AccountPanel, ApiKeysPanel, BlueprintsPanel, ConnectionsPanel, Hub, ...(isDev ? [DevDashboard] : [])]
        for (const view of views) view.preload().catch(() => {})
      },
      3000,
      8000
    )
  }, [loading, userId, isDev])

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-xs text-muted-foreground">Ouverture de votre espace…</p>
        </div>
      </div>
    )
  }

  // Dès qu'un compte existe, l'accès à l'application demande une connexion :
  // c'est ce qui garantit un historique, des agents et des clés API par compte.
  if (accountsExist && !user) return <AuthGate />

  return (
    <div className="relative flex h-dvh overflow-hidden bg-background text-foreground">
      <AccountAppearanceSync />
      {/* Décor aurore discret derrière toute l'app */}
      <div className="pointer-events-none absolute inset-0 bg-aurora opacity-60" aria-hidden />
      {/* Sidebar desktop */}
      <aside className="relative hidden w-60 shrink-0 flex-col border-r border-border/60 bg-card/50 backdrop-blur-xl md:flex">
        <div className="flex items-center justify-between p-4">
          <Logo />
          <ThemeToggle />
        </div>
        <NavList />
        <div className="space-y-2 border-t border-border/70 p-3">
          <AccountMenu />
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">{footer}</p>
        </div>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between p-4">
              <Logo />
              <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSidebarOpen(false)} aria-label="Fermer le menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <NavList onNavigate={() => setSidebarOpen(false)} />
            <div className="border-t border-border/70 p-3">
              <AccountMenu />
            </div>
          </aside>
        </div>
      )}

      {/* Zone principale */}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure mobile */}
        <header className="flex items-center justify-between border-b border-border/60 bg-card/50 px-4 py-2.5 backdrop-blur-xl md:hidden">
          <button onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu" className="rounded-lg p-2 text-foreground/80 hover:bg-accent">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <ThemeToggle />
        </header>

        <main className="min-h-0 flex-1">
          {view === 'hub' && <Hub />}
          {view === 'studios' && <StudiosHub />}
          {view === 'agent' && <AgentChat />}
          {view === 'cerveaux' && <BrainRoomPage />}
          {view === 'blueprints' && <BlueprintsPanel />}
          {view === 'cles' && <ApiKeysPanel />}
          {view === 'compte' && <AccountPanel key={user?.id ?? 'anonyme'} />}
          {view === 'studio3d' && <Studio3D />}
          {view === 'image' && <ImageStudio />}
          {view === 'video' && <VideoStudio />}
          {view === 'code' && <CodeStudio />}
          {view === 'connexions' && <ConnectionsPanel />}
          {view === 'dev' && user?.role === 'dev' && <DevDashboard />}
        </main>
      </div>
    </div>
  )
}

export function AppShell() {
  return (
    <SiteSettingsProvider>
      <AuthProvider>
        <NexusApp />
      </AuthProvider>
    </SiteSettingsProvider>
  )
}
