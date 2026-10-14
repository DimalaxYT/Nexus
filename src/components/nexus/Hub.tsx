'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Layers,
  Boxes,
  Brain,
  Clapperboard,
  Code2,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link2,
  PenTool,
  Sparkles,
  UserRound,
  Wand2,
  Terminal,
  Workflow,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNexusStore } from '@/lib/store'
import { useAuth } from '@/lib/auth-client'
import { useSiteSettings } from '@/lib/site-settings-client'
import type { ViewId } from '@/lib/nexus-types'

const TOOLS: {
  id: ViewId
  title: string
  desc: string
  icon: typeof Bot
  gradient: string
  shadow: string
  tag: string
}[] = [
  {
    id: 'agent',
    title: 'Agent IA',
    desc: 'Un agent IA hybride : moteur de raisonnement LLM + compétences locales instantanées. Il cherche sur le web, apprend des compétences lors de missions autonomes (Google, YouTube, TikTok), génère images, scènes 3D, pages web et scripts.',
    icon: Bot,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-neutral-500/30',
    tag: 'Cœur du système',
  },
  {
    id: 'cerveaux',
    title: 'Cerveau Jarvis 3D',
    desc: 'Un cerveau central unique et animé, relié à chaque agent par des liens d’énergie : impulsions en direct pendant la réflexion, anneaux gyroscopiques et hologramme façon J.A.R.V.I.S. — ou vue « Éclaté » avec un cerveau par agent.',
    icon: Brain,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-neutral-500/30',
    tag: 'L’équipe qui pense',
  },
  {
    id: 'studios',
    title: 'Studios créatifs',
    desc: 'Quatre ateliers réunis : 3D, image, vidéo et code. Éditez à la main ou demandez à vos agents — ils y travaillent pour vous.',
    icon: Layers,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-neutral-500/20',
    tag: 'Création',
  },
  {
    id: 'connexions',
    title: 'Connexions',
    desc: 'Relie tes comptes personnels — Gmail, GitHub, Discord. Tokens vérifiés réellement auprès du service et stockés localement, jamais affichés en clair.',
    icon: Link2,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-blue-500/30',
    tag: 'Tes comptes',
  },
  {
    id: 'blueprints',
    title: 'Blueprints',
    desc: 'Construis toi-même le schéma d’utilisation de tes agents : règles « quand tu lis X, réponds Y », conditions, cerveau local, connaissances, outils et réponses — sur un canvas à glisser-déposer, avec testeur en direct.',
    icon: Workflow,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-neutral-500/30',
    tag: 'Schémas d’agents',
  },
  {
    id: 'cles',
    title: 'Clés API',
    desc: 'Vends des chatbots : une clé = un assistant avec ses propres réponses imposées, son schéma, son accueil, ses origines autorisées et sa limite d’appels. Snippet d’intégration fourni.',
    icon: KeyRound,
    gradient: 'from-neutral-600 to-neutral-800',
    shadow: 'group-hover:shadow-neutral-300/30',
    tag: 'Prêt à vendre',
  },
]

const DEV_TOOL = {
  id: 'dev' as ViewId,
  title: 'Espace développeur',
  desc: 'Dashboard technique : personnalisation du site depuis le web, statistiques, journal d’appels, explorateur de code et agent Dev qui lit et améliore le code de NEXUS.',
  icon: Terminal,
  gradient: 'from-neutral-600 to-neutral-800',
  shadow: 'group-hover:shadow-neutral-500/30',
  tag: 'Réservé au Dev',
}

const CAPABILITIES = [
  { icon: Globe, label: 'Recherche web autonome' },
  { icon: Wand2, label: 'Art procédural local' },
  { icon: Brain, label: 'Réseau de neurones embarqué' },
  { icon: Boxes, label: 'Scènes 3D procédurales' },
  { icon: PenTool, label: 'Retouche photo locale' },
  { icon: Code2, label: 'Scripts Roblox/Luau & +14 langages' },
  { icon: Sparkles, label: 'Mémoire & base de connaissances' },
  { icon: Workflow, label: 'Blueprints (schémas d’agents)' },
  { icon: KeyRound, label: 'Clés API & chatbots revendables' },
  { icon: UserRound, label: 'Comptes, historique & personnalisation' },
]

export function Hub() {
  const setView = useNexusStore((s) => s.setView)
  const { user, logout } = useAuth()
  const { settings } = useSiteSettings()
  const isDev = user?.role === 'dev'
  const isOwner = user?.role === 'owner'

  // Les tuiles masquées depuis l'espace Dev disparaissent de l'accueil.
  const tools = TOOLS.filter((t) => !settings.hiddenTiles.includes(t.id))
  const shown = isDev ? [DEV_TOOL, ...tools] : tools

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-10 md:px-8">
        {/* Hero */}
        <section className="flex flex-col items-center pb-10 pt-6 text-center md:pt-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Agent autonome — rapide, intelligent, et il travaille pour toi même quand tu es absent
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="font-display text-5xl font-bold tracking-tight md:text-6xl"
            style={{ backgroundImage: `linear-gradient(105deg, ${settings.accent}, ${settings.accent2})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}
          >
            {settings.appName}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mt-4 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            {settings.welcomeSubtitle}
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            className="mt-7 flex flex-wrap items-center justify-center gap-3"
          >
            <Button
              size="lg"
              onClick={() => setView('agent')}
              className="h-12 gap-2 rounded-xl bg-foreground px-7 text-base font-semibold text-background transition-transform hover:scale-[1.03] hover:opacity-90"
            >
              Parler à l’agent
              <ArrowRight className="h-4.5 w-4.5" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => setView('studio3d')}
              className="h-12 gap-2 border-border px-6 text-base hover:bg-accent"
            >
              <Boxes className="h-4.5 w-4.5" />
              Explorer le Studio 3D
            </Button>
          </motion.div>
        </section>

        {/* Rappel discret : l'espace développeur vit sur son propre compte */}
        {isOwner && (
          <section className="mx-auto mb-6 w-full max-w-3xl">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-foreground/85">
                  L’espace développeur (dashboard, personnalisation du site, agent Dev) vit sur le{' '}
                  <strong>compte Dev</strong> — identifiant <code className="font-mono text-foreground">dev</code>.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-neutral-500/40 text-neutral-300"
                onClick={() => void logout()}
              >
                Se connecter en Dev
              </Button>
            </div>
          </section>
        )}

        {/* Cartes outils */}
        <section className="grid gap-4 pb-8 sm:grid-cols-2" aria-label="Outils disponibles">
          {shown.map((tool, i) => {
            const Icon = tool.icon
            return (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 + i * 0.07 }}
                onClick={() => setView(tool.id)}
                className={`group relative overflow-hidden rounded-2xl border border-border bg-muted/40 p-6 text-left transition-all hover:-translate-y-1 hover:border-neutral-500/50 hover:shadow-xl ${tool.shadow}`}
              >
                <div className={`absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${tool.gradient} opacity-10 blur-2xl transition-opacity group-hover:opacity-25`} />
                <div className="mb-4 flex items-center justify-between">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${tool.gradient} shadow-lg`}>
                    <Icon className="h-5.5 w-5.5 text-white" />
                  </div>
                  <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {tool.tag}
                  </span>
                </div>
                <h2 className="mb-1.5 text-lg font-bold text-foreground">{tool.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{tool.desc}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100">
                  Ouvrir <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </motion.button>
            )
          })}

          {/* Capacités */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.72 }}
            className="rounded-2xl border border-border bg-muted/40 p-6"
          >
            <h2 className="mb-4 text-lg font-bold text-foreground">Capacités de l’agent</h2>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {CAPABILITIES.map((cap) => {
                const Icon = cap.icon
                return (
                  <li key={cap.label} className="flex items-center gap-2.5 text-sm text-foreground/80">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    {cap.label}
                  </li>
                )
              })}
            </ul>
          </motion.div>
        </section>

        <footer className="mt-auto pb-4 pt-2 text-center">
          <p className="text-xs text-muted-foreground/70">
            NEXUS v2.0 — cerveau IA local · réseau de neurones embarqué, zéro API externe
          </p>
        </footer>
      </div>
    </div>
  )
}
