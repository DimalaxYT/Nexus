'use client'

import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import {
  Bot,
  Boxes,
  Brain,
  Clapperboard,
  Code2,
  Home,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Menu,
  Moon,
  Sun,
  Terminal,
  User as UserIcon,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNexusStore } from '@/lib/store'
import { AuthProvider, useAuth } from '@/lib/auth-client'
import { SiteSettingsProvider, useSiteSettings } from '@/lib/site-settings-client'
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
import { Hub } from '@/components/nexus/Hub'
import { AgentChat } from '@/components/nexus/AgentChat'
import { ConnectionsPanel } from '@/components/nexus/ConnectionsPanel'
import { ImageStudio } from '@/components/nexus/studios/ImageStudio'
import { VideoStudio } from '@/components/nexus/studios/VideoStudio'
import { CodeStudio } from '@/components/nexus/studios/CodeStudio'
import { AuthGate } from '@/components/nexus/AuthGate'
import { AccountPanel } from '@/components/nexus/AccountPanel'
import { BlueprintsPanel } from '@/components/nexus/BlueprintsPanel'
import { ApiKeysPanel } from '@/components/nexus/ApiKeysPanel'
import { DevDashboard } from '@/components/nexus/DevDashboard'

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
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}

/** Entrée réservée au compte Dev : dashboard, site, code et agent Dev. */
const DEV_NAV_ITEM: { id: ViewId; label: string; icon: typeof Home; hint: string } = {
  id: 'dev',
  label: 'Espace Dev',
  icon: Terminal,
  hint: 'Dashboard & code',
}

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof Home; hint: string }[] = [
  { id: 'hub', label: 'Accueil', icon: Home, hint: 'Centre de contrôle' },
  { id: 'agent', label: 'Agent IA', icon: Bot, hint: 'Agent autonome' },
  { id: 'cerveaux', label: 'Cerveau Jarvis', icon: Brain, hint: 'Le cerveau central en direct' },
  { id: 'blueprints', label: 'Blueprints', icon: Workflow, hint: 'Schémas d\u2019agents' },
  { id: 'cles', label: 'Clés API', icon: KeyRound, hint: 'Chatbots à vendre' },
  { id: 'studio3d', label: 'Studio 3D', icon: Boxes, hint: 'Création et IA 3D' },
  { id: 'image', label: 'Images', icon: ImageIcon, hint: 'Retouche et création' },
  { id: 'video', label: 'Vidéo', icon: Clapperboard, hint: 'Montage express' },
  { id: 'code', label: 'Code', icon: Code2, hint: 'Éditeur live + IA' },
  { id: 'connexions', label: 'Connexions', icon: Link2, hint: 'Gmail, GitHub, Discord' },
  { id: 'compte', label: 'Mon compte', icon: UserIcon, hint: 'Profil et sécurité' },
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

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView } = useNexusStore()
  const { user } = useAuth()
  const isDev = user?.role === 'dev'

  const items = isDev
    ? [...NAV_ITEMS.slice(0, 1), DEV_NAV_ITEM, ...NAV_ITEMS.slice(1)]
    : NAV_ITEMS

  return (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Navigation principale">
      {items.map((item) => {
        const Icon = item.icon
        const active = view === item.id
        return (
          <button
            key={item.id}
            onClick={() => {
              setView(item.id)
              onNavigate?.()
            }}
            aria-current={active ? 'page' : undefined}
            style={active ? { background: 'var(--dev-accent-soft)', color: 'var(--dev-accent)' } : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
              !active && 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Icon className={cn('h-4.5 w-4.5 shrink-0', active ? '' : 'text-muted-foreground group-hover:text-foreground/80')} />
            <span className="flex-1">{item.label}</span>
            <span className="hidden text-[10px] text-muted-foreground/70 group-hover:block lg:block">{item.hint}</span>
          </button>
        )
      })}
    </nav>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Basculer le thème clair ou sombre"
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}

/** Menu du compte connecté (profil, déconnexion). */
function AccountMenu() {
  const { user, logout } = useAuth()
  const setView = useNexusStore((s) => s.setView)
  if (!user) return null

  const profile = user.profile ?? {}
  const label = profile.displayName || user.name || user.email.split('@')[0]
  const color = profile.avatarColor ?? '#a78bfa'
  const initial = label.trim().charAt(0).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-muted/30 p-2 text-left transition-colors hover:bg-muted/60"
          aria-label="Menu du compte"
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}aa)` }}
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
        <DropdownMenuItem onClick={() => void logout()} className="gap-2 text-rose-300">
          <X className="h-4 w-4" /> Se déconnecter
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function NexusApp() {
  const { view, sidebarOpen, setSidebarOpen } = useNexusStore()
  const { user, loading, accountsExist } = useAuth()
  const { settings } = useSiteSettings()
  const footer = settings.footerText || 'IA 100 % locale — aucune donnée ne quitte cette machine.'

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
          <p className="text-xs text-muted-foreground">Ouverture de votre espace…</p>
        </div>
      </div>
    )
  }

  // Dès qu'un compte existe, l'accès à l'application demande une connexion :
  // c'est ce qui garantit un historique, des agents et des clés API par compte.
  if (accountsExist && !user) return <AuthGate />

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-card/70 md:flex">
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
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure mobile */}
        <header className="flex items-center justify-between border-b border-border/70 bg-card/70 px-4 py-2.5 md:hidden">
          <button onClick={() => setSidebarOpen(true)} aria-label="Ouvrir le menu" className="rounded-lg p-2 text-foreground/80 hover:bg-accent">
            <Menu className="h-5 w-5" />
          </button>
          <Logo />
          <div className="w-10" />
        </header>

        <main className="min-h-0 flex-1">
          {view === 'hub' && <Hub />}
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
