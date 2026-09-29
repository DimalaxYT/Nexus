'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Clapperboard,
  Code2,
  Globe,
  Image as ImageIcon,
  Link2,
  PenTool,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useNexusStore } from '@/lib/store'
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
    gradient: 'from-violet-500 to-fuchsia-500',
    shadow: 'group-hover:shadow-violet-500/30',
    tag: 'Cœur du système',
  },
  {
    id: 'cerveaux',
    title: 'Cerveau Jarvis 3D',
    desc: 'Un cerveau central unique et animé, relié à chaque agent par des liens d’énergie : impulsions en direct pendant la réflexion, anneaux gyroscopiques et hologramme façon J.A.R.V.I.S. — ou vue « Éclaté » avec un cerveau par agent.',
    icon: Brain,
    gradient: 'from-fuchsia-500 to-purple-500',
    shadow: 'group-hover:shadow-fuchsia-500/30',
    tag: 'L’équipe qui pense',
  },
  {
    id: 'studio3d',
    title: 'Studio 3D',
    desc: 'Éditeur 3D temps réel : calques, undo/redo, mesure, PBR, environnements, animation clé par clé, templates et export GLB/OBJ. L’IA construit des scènes sur demande.',
    icon: Boxes,
    gradient: 'from-fuchsia-500 to-rose-500',
    shadow: 'group-hover:shadow-rose-500/30',
    tag: 'Moteur temps réel',
  },
  {
    id: 'image',
    title: 'Studio Image',
    desc: 'Retouche photo 100 % locale : filtres, recadrage, pinceau, texte, plus génération d’images procédurales (art génératif par graine) en un clic.',
    icon: ImageIcon,
    gradient: 'from-emerald-500 to-teal-500',
    shadow: 'group-hover:shadow-emerald-500/30',
    tag: 'Création visuelle',
  },
  {
    id: 'video',
    title: 'Studio Vidéo',
    desc: 'Montage navigateur : coupe, filtres cinématographiques, vitesse et export webm. (La génération vidéo IA externe est désactivée — mode 100 % local.)',
    icon: Clapperboard,
    gradient: 'from-amber-500 to-orange-500',
    shadow: 'group-hover:shadow-amber-500/30',
    tag: 'Montage express',
  },
  {
    id: 'code',
    title: 'Studio Code',
    desc: 'Éditeur multi-langages (20 langages : Python, Lua/Roblox, shaders…) avec aperçu instantané, console, versions, et PROPOSITIONS de code des agents à valider (diff).',
    icon: Code2,
    gradient: 'from-cyan-500 to-teal-400',
    shadow: 'group-hover:shadow-cyan-500/30',
    tag: 'Atelier dev',
  },
  {
    id: 'connexions',
    title: 'Connexions',
    desc: 'Relie tes comptes personnels — Gmail, GitHub, Discord. Tokens vérifiés réellement auprès du service et stockés localement, jamais affichés en clair.',
    icon: Link2,
    gradient: 'from-violet-500 to-indigo-400',
    shadow: 'group-hover:shadow-indigo-500/30',
    tag: 'Tes comptes',
  },
]

const CAPABILITIES = [
  { icon: Globe, label: 'Recherche web autonome' },
  { icon: Wand2, label: 'Art procédural local' },
  { icon: Brain, label: 'Réseau de neurones embarqué' },
  { icon: Boxes, label: 'Scènes 3D procédurales' },
  { icon: PenTool, label: 'Retouche photo locale' },
  { icon: Code2, label: 'Scripts Roblox/Luau & +14 langages' },
  { icon: Sparkles, label: 'Mémoire & base de connaissances' },
]

export function Hub() {
  const setView = useNexusStore((s) => s.setView)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 py-10 md:px-8">
        {/* Hero */}
        <section className="flex flex-col items-center pb-10 pt-6 text-center md:pt-14">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-xs font-medium text-violet-300"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Agent autonome — rapide, intelligent, et il travaille pour toi même quand tu es absent
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-6xl"
          >
            NEXUS
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            className="mt-4 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            Ton agent IA personnel : il répond vite, cherche sur le web en synthétisant les
            pages, compose des images procédurales, construit des mondes en 3D, retouche tes
            photos, écrit des scripts — et exécute seul tes missions en arrière-plan,
            en apprenant des compétences au passage.
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
              className="h-12 gap-2 bg-gradient-to-r from-violet-500 to-fuchsia-500 px-7 text-base font-semibold text-white shadow-lg shadow-violet-500/30 transition-transform hover:scale-[1.03]"
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

        {/* Cartes outils */}
        <section className="grid gap-4 pb-8 sm:grid-cols-2" aria-label="Outils disponibles">
          {TOOLS.map((tool, i) => {
            const Icon = tool.icon
            return (
              <motion.button
                key={tool.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.3 + i * 0.07 }}
                onClick={() => setView(tool.id)}
                className={`group relative overflow-hidden rounded-2xl border border-border bg-muted/40 p-6 text-left transition-all hover:-translate-y-1 hover:border-violet-500/50 hover:shadow-xl ${tool.shadow}`}
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
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-violet-300 opacity-0 transition-opacity group-hover:opacity-100">
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
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/15">
                      <Icon className="h-3.5 w-3.5 text-violet-400" />
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
