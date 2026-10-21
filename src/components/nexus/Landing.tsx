'use client'

// ─── NEXUS — Landing publique (vitrine, zéro fonction) ────────────────────────
// Première impression du produit : héros typographique fort sur fond d'aurore,
// grille technique, cartes de verre. Aucun accès aux fonctions : tout passe
// par le CTA « Ouvrir NEXUS » → /app (connexion ou création de compte).

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Boxes,
  Brain,
  Code2,
  Image as ImageIcon,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  UserRound,
  Workflow,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ThemeCycleButton } from '@/components/nexus/theme-cycle'

const FEATURES = [
  {
    icon: Bot,
    title: 'Une vraie conversation',
    desc: 'Le site tient d’abord en une chose : parler avec NEXUS. Un modèle de langage transformeur écrit à la main, entraîné ici, qui rédige ses réponses token par token — pas un arbre de phrases toutes faites.',
  },
  {
    icon: Brain,
    title: 'Cerveau 100 % local',
    desc: 'Tokenizer BPE, attention multi-têtes, entraînement AdamW, décodage avec cache clé/valeur : tout est codé dans ce dépôt. Aucune API, aucune clé, aucun service d’IA tiers — vos phrases ne quittent pas votre serveur.',
  },
  {
    icon: Workflow,
    title: 'Ancré, jamais inventé',
    desc: 'Chaque réponse s’appuie sur un savoir retrouvé (vos notes, vos mémoires, la banque de connaissances) et passe des garde-fous de qualité. Si le modèle doute, il le dit et répond à partir du savoir plutôt que d’inventer.',
  },
  {
    icon: Workflow,
    title: 'Agent autonome',
    desc: 'Au-delà de la discussion : recherche web réelle, missions en arrière-plan, schémas d’agents sur canvas — l’IA agit aussi quand vous n’êtes pas là.',
  },
  {
    icon: Boxes,
    title: 'Studio 3D',
    desc: 'Éditeur 3D temps réel avec calques, matériaux PBR, animation clé par clé et export GLB/OBJ. L’IA construit vos scènes.',
  },
  {
    icon: ImageIcon,
    title: 'Studios Image & Vidéo',
    desc: 'Retouche photo locale, art génératif procédural, montage vidéo navigateur avec export webm. Tout dans l’onglet.',
  },
  {
    icon: Code2,
    title: 'Studio Code',
    desc: '20 langages, aperçu instantané, console et versions — avec les propositions de code des agents à valider en diff.',
  },
  {
    icon: KeyRound,
    title: 'Clés API revendables',
    desc: 'Une clé = un chatbot à votre image, avec ses réponses imposées et sa limite d’appels. Snippet d’intégration fourni.',
  },
  {
    icon: UserRound,
    title: 'Comptes & mémoires',
    desc: 'Chaque utilisateur a son historique, ses agents, sa base de connaissances et sa personnalisation. Rien ne se mélange.',
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Créez votre espace',
    desc: 'Un e-mail, un mot de passe — votre compte et vos données naissent sur ce serveur, pas ailleurs.',
  },
  {
    n: '02',
    title: 'Façonnez vos agents',
    desc: 'Équipe multi-agents, blueprints, mémoires et connaissances : vous composez l’intelligence dont vous avez besoin.',
  },
  {
    n: '03',
    title: 'Laissez travailler',
    desc: 'Discutez, créez des images, des scènes 3D, du code — et lancez des missions autonomes en arrière-plan.',
  },
]

function ThemeToggle() {
  return <ThemeCycleButton className="rounded-lg" />
}

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-80px' },
}

export function Landing({ hasAccounts }: { hasAccounts: boolean }) {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      {/* Décor : aurore + grille technique */}
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[46rem] bg-grid" aria-hidden />

      {/* ── Barre de navigation ─────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5">
          <a href="#" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">
              N
            </span>
            <span className="font-display text-base font-bold tracking-[0.22em]">NEXUS</span>
          </a>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex" aria-label="Navigation de la vitrine">
            <a href="#features" className="transition-colors hover:text-foreground">Fonctionnalités</a>
            <a href="#how" className="transition-colors hover:text-foreground">Fonctionnement</a>
            <a href="#privacy" className="transition-colors hover:text-foreground">Confidentialité</a>
          </nav>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild className="h-9 gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] hover:opacity-90">
              <Link href="/app">
                Ouvrir NEXUS
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        {/* ── Héros ─────────────────────────────────────────────────────────── */}
        <section className="relative mx-auto flex w-full max-w-6xl flex-col items-center px-5 pb-20 pt-20 text-center md:pt-28">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
            </span>
            Modèle de langage maison — entraîné sur votre serveur
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="max-w-4xl font-display text-5xl font-bold leading-[1.04] tracking-tight md:text-7xl"
          >
            Parlez avec une IA
            <br />
            <span className="text-gradient">écrite de A à Z.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.16 }}
            className="mt-6 max-w-2xl text-balance text-base leading-relaxed text-muted-foreground md:text-lg"
          >
            NEXUS est un site dont le but est simple : discuter avec une intelligence
            artificielle qui tourne entièrement chez vous. Le modèle de langage est codé
            et entraîné dans ce dépôt — aucune API, aucun service externe, aucune clé.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3"
          >
            <Button asChild size="lg" className="h-12 gap-2 rounded-xl bg-primary px-7 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.03] hover:opacity-90">
              <Link href="/app">
                {hasAccounts ? 'Parler à NEXUS' : 'Créer mon espace et parler à NEXUS'}
                <ArrowRight className="h-4.5 w-4.5" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-12 gap-2 rounded-xl border-border px-6 text-base hover:bg-accent">
              <Link href="/app">
                <Lock className="h-4 w-4" />
                Se connecter
              </Link>
            </Button>
          </motion.div>

          <motion.dl
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="mt-14 grid w-full max-w-2xl grid-cols-3 gap-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground"
          >
            {[
              ['100 %', 'local & privé'],
              ['0', 'API ou clé externe'],
              ['~0,4 s', 'par réponse'],
            ].map(([value, label]) => (
              <div key={label} className="glass edge-glow rounded-xl px-4 py-3.5">
                <dt className="sr-only">{label}</dt>
                <dd className="font-display text-xl font-bold text-foreground md:text-2xl">{value}</dd>
                <dd className="mt-1">{label}</dd>
              </div>
            ))}
          </motion.dl>
        </section>

        {/* ── Fonctionnalités ─────────────────────────────────────────────── */}
        <section id="features" className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-16">
          <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mb-10 max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">— Tout-en-un</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
              Une équipe d&apos;agents, huit studios, un seul onglet.
            </h2>
          </motion.div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <motion.article
                  key={f.title}
                  {...fadeUp}
                  transition={{ duration: 0.45, delay: (i % 4) * 0.07 }}
                  className="group glass rounded-2xl p-5 transition-all hover:-translate-y-1 hover:border-foreground/25 hover:shadow-glow"
                >
                  <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/50 text-foreground transition-colors group-hover:bg-muted">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mb-1.5 font-display text-base font-semibold">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
                </motion.article>
              )
            })}
          </div>
        </section>

        {/* ── Fonctionnement ──────────────────────────────────────────────── */}
        <section id="how" className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-16">
          <motion.div {...fadeUp} transition={{ duration: 0.5 }} className="mb-10 max-w-2xl">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">— Trois étapes</p>
            <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">Opérationnel en deux minutes.</h2>
          </motion.div>
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                {...fadeUp}
                transition={{ duration: 0.45, delay: i * 0.1 }}
                className="glass edge-glow relative overflow-hidden rounded-2xl p-6"
              >
                <span className="pointer-events-none absolute -right-3 -top-6 font-display text-8xl font-bold text-foreground/[0.045]">
                  {s.n}
                </span>
                <p className="font-mono text-xs text-foreground/80">{s.n}</p>
                <h3 className="mt-3 font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* ── Confidentialité ─────────────────────────────────────────────── */}
        <section id="privacy" className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-5 py-16">
          <motion.div
            {...fadeUp}
            transition={{ duration: 0.5 }}
            className="glass edge-glow relative overflow-hidden rounded-3xl px-6 py-10 md:px-12 md:py-14"
          >
            <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" aria-hidden />
            <div className="relative grid items-center gap-8 md:grid-cols-[1.2fr_1fr]">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">— Confidentialité</p>
                <h2 className="mt-2 font-display text-3xl font-bold tracking-tight md:text-4xl">
                  Vos données restent sous votre contrôle.
                </h2>
                <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
                  Le cerveau de NEXUS est codé à la main : réseau de neurones embarqué, moteurs de recherche,
                  générateurs d&apos;images et de 3D — le tout tourne sur la machine. Aucune clé OpenAI, aucune
                  compétition avec vos conversations : vous restez maître de vos données.
                </p>
                <Button asChild className="mt-7 gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground hover:opacity-90">
                  <Link href="/app">
                    Commencer maintenant
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <ul className="space-y-3.5">
                {[
                  { icon: ShieldCheck, text: 'Mots de passe hachés (scrypt), sessions signées, secrets chiffrés AES-256-GCM.' },
                  { icon: Lock, text: 'Base de données locale — rien n’est répliqué chez un tiers.' },
                  { icon: Zap, text: 'Réflexions en moins de 50 ms : la latence du cloud n’existe plus.' },
                ].map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.text} className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/50 p-4 text-sm text-foreground/85">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      {item.text}
                    </li>
                  )
                })}
              </ul>
            </div>
          </motion.div>
        </section>
      </main>

      {/* ── Pied de page — surfaces du thème ───────────────────────────────── */}
      <footer className="relative border-t border-border/70 bg-card/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-5 px-5 py-9 md:h-24 md:flex-row md:gap-8 md:py-0">
          <p className="font-display text-2xl font-bold tracking-[0.45em] text-foreground md:text-3xl">4UR</p>
          <div className="flex items-center gap-5">
            <span className="hidden h-px w-16 bg-border sm:block" aria-hidden />
            <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-foreground/80">
              For your digital world.
            </p>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            IA <span className="mx-1.5 text-muted-foreground/50">·</span> Agents <span className="mx-1.5 text-muted-foreground/50">·</span> Studios
          </p>
        </div>
        <div className="border-t border-border/60">
          <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-2 px-5 py-4 text-[11px] text-muted-foreground sm:flex-row">
            <p>© {new Date().getFullYear()} 4UR — NEXUS, cerveau IA 100 % local.</p>
            <Link href="/app" className="flex items-center gap-1.5 font-medium text-foreground/70 transition-colors hover:text-foreground">
              Ouvrir l&apos;application
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
