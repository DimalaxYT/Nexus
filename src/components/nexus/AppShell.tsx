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
  Link2,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNexusStore } from '@/lib/store'
import type { ViewId } from '@/lib/nexus-types'
import { Button } from '@/components/ui/button'
import { Hub } from '@/components/nexus/Hub'
import { AgentChat } from '@/components/nexus/AgentChat'
import { ConnectionsPanel } from '@/components/nexus/ConnectionsPanel'
import { ImageStudio } from '@/components/nexus/studios/ImageStudio'
import { VideoStudio } from '@/components/nexus/studios/VideoStudio'
import { CodeStudio } from '@/components/nexus/studios/CodeStudio'

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

const NAV_ITEMS: { id: ViewId; label: string; icon: typeof Home; hint: string }[] = [
  { id: 'hub', label: 'Accueil', icon: Home, hint: 'Centre de contrôle' },
  { id: 'agent', label: 'Agent IA', icon: Bot, hint: 'Agent autonome' },
  { id: 'cerveaux', label: 'Cerveau Jarvis', icon: Brain, hint: 'Le cerveau central en direct' },
  { id: 'studio3d', label: 'Studio 3D', icon: Boxes, hint: 'Création et IA 3D' },
  { id: 'image', label: 'Images', icon: ImageIcon, hint: 'Retouche et création' },
  { id: 'video', label: 'Vidéo', icon: Clapperboard, hint: 'Montage express' },
  { id: 'code', label: 'Code', icon: Code2, hint: 'Éditeur live + IA' },
  { id: 'connexions', label: 'Connexions', icon: Link2, hint: 'Gmail, GitHub, Discord' },
]

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 shadow-lg shadow-violet-500/25">
        <Bot className="h-5 w-5 text-white" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-extrabold tracking-widest text-foreground">NEXUS</p>
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Agent IA</p>
      </div>
    </div>
  )
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { view, setView } = useNexusStore()
  return (
    <nav className="flex flex-1 flex-col gap-1 p-3" aria-label="Navigation principale">
      {NAV_ITEMS.map((item) => {
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
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all',
              active
                ? 'bg-violet-500/15 text-violet-300 shadow-[inset_0_0_0_1px_rgba(168,85,247,0.3)]'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Icon className={cn('h-4.5 w-4.5 shrink-0', active ? 'text-violet-400' : 'text-muted-foreground group-hover:text-foreground/80')} />
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

export function AppShell() {
  const { view, sidebarOpen, setSidebarOpen } = useNexusStore()

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-card/70 md:flex">
        <div className="flex items-center justify-between p-4">
          <Logo />
          <ThemeToggle />
        </div>
        <NavList />
        <div className="border-t border-border/70 p-4">
          <p className="text-[11px] leading-relaxed text-muted-foreground/70">
            NEXUS v2.0 — IA 100 % locale (réseau de neurones embarqué, zéro API) + studios créatifs intégrés.
          </p>
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
          {view === 'studio3d' && <Studio3D />}
          {view === 'image' && <ImageStudio />}
          {view === 'video' && <VideoStudio />}
          {view === 'code' && <CodeStudio />}
          {view === 'connexions' && <ConnectionsPanel />}
        </main>
      </div>
    </div>
  )
}
