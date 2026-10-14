'use client'

// ─── NEXUS — Porte d'entrée de l'application (connexion / création) ──────────
// Écran d'accès à /app : tant que l'utilisateur n'est pas connecté, aucune
// fonction n'est montée. Split-screen : panneau de marque à gauche, formulaire
// épuré à droite — dans la nouvelle identité obsidienne (cyan / émeraude).

import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  UserPlus,
  Workflow,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-client'
import { useSiteSettings } from '@/lib/site-settings-client'
import { cn } from '@/lib/utils'

const MARKETING_POINTS = [
  { icon: Zap, text: 'Cerveau local — réflexions en moins de 50 ms, sans cloud.' },
  { icon: Workflow, text: 'Blueprints : dessinez le schéma de vos agents sur canvas.' },
  { icon: ShieldCheck, text: 'Historique, mémoires et clés API cloisonnés par compte.' },
]

export function AuthGate() {
  const { login, register, accountsExist, accountCount } = useAuth()
  const { settings } = useSiteSettings()
  // Mode initial : création de compte si l'instance n'en a aucun, connexion sinon.
  const [mode, setMode] = useState<'login' | 'register'>(accountsExist ? 'login' : 'register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (mode === 'register') {
      if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
      if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères (dont un chiffre).')
      if (!/\d/.test(password)) return setError('Le mot de passe doit contenir au moins un chiffre.')
    }

    setBusy(true)
    const res = mode === 'login' ? await login(email, password) : await register(name, email, password)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Une erreur est survenue')
  }

  return (
    <div className="relative flex min-h-dvh bg-background text-foreground">
      {/* Décor aurore */}
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* ── Panneau de marque (desktop) ─────────────────────────────────── */}
      <aside className="relative hidden w-[46%] shrink-0 flex-col justify-between overflow-hidden border-r border-border/60 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" aria-hidden />

        <Link href="/" className="relative flex items-center gap-2.5 text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <div className="relative">
          <div className="mb-8 flex items-center gap-3">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl font-display text-xl font-bold text-[#071016] shadow-glow"
              style={{ background: `linear-gradient(135deg, ${settings.accent}, ${settings.accent2})` }}
            >
              {settings.logoEmoji ? <span aria-hidden>{settings.logoEmoji}</span> : 'N'}
            </span>
            <div>
              <p className="font-display text-lg font-bold tracking-[0.22em]">{settings.appName}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{settings.tagline}</p>
            </div>
          </div>
          <h1 className="max-w-md font-display text-4xl font-bold leading-tight tracking-tight">
            Votre équipe d&apos;agents IA, <span className="text-gradient">entièrement chez vous.</span>
          </h1>
          <ul className="mt-10 space-y-4">
            {MARKETING_POINTS.map((point) => {
              const Icon = point.icon
              return (
                <li key={point.text} className="flex items-center gap-3 text-sm text-foreground/80">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/10 text-cyan-300">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  {point.text}
                </li>
              )
            })}
          </ul>
        </div>

        <p className="relative font-mono text-[11px] leading-relaxed text-muted-foreground/70">
          « Réseau de neurones embarqué, zéro API externe — vos conversations ne
          quittent jamais ce serveur. »
        </p>
      </aside>

      {/* ── Formulaire ──────────────────────────────────────────────────── */}
      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          {/* Marque compacte (mobile) */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <span
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl font-display text-xl font-bold text-[#071016] shadow-glow"
              style={{ background: `linear-gradient(135deg, ${settings.accent}, ${settings.accent2})` }}
            >
              {settings.logoEmoji ? <span aria-hidden>{settings.logoEmoji}</span> : <Bot className="h-6 w-6" />}
            </span>
            <h1 className="font-display text-xl font-bold tracking-[0.22em]">{settings.appName}</h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{settings.tagline}</p>
          </div>

          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold tracking-tight">{settings.loginTitle}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{settings.loginSubtitle}</p>
          </div>

          {/* Sélecteur de mode */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/40 p-1">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError('') }}
                aria-pressed={mode === m}
                className={cn(
                  'rounded-lg px-3 py-2 text-sm font-medium transition-all',
                  mode === m
                    ? 'bg-gradient-to-r from-cyan-500/90 to-emerald-400/90 text-[#071016] shadow'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m === 'login' ? 'Connexion' : 'Créer un compte'}
              </button>
            ))}
          </div>

          {mode === 'register' && !accountsExist && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3.5 text-xs leading-relaxed text-emerald-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Aucun compte sur cette instance : celui-ci deviendra le <strong>compte propriétaire</strong> et
                récupérera les données déjà présentes (agents, conversations, connaissances).
              </p>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-name">Votre prénom</Label>
                <Input
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex"
                  autoComplete="given-name"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="auth-email">Adresse e-mail ou identifiant</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-email"
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.fr"
                  className="rounded-xl pl-9"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="auth-password">Mot de passe</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="auth-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 caractères minimum, dont un chiffre"
                  className="rounded-xl pl-9"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
            </div>

            {mode === 'register' && (
              <div className="space-y-1.5">
                <Label htmlFor="auth-confirm">Confirmer le mot de passe</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="auth-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="Répétez le mot de passe"
                    className="rounded-xl pl-9"
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">{error}</p>
            )}

            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 font-semibold text-[#071016] shadow-glow transition-transform hover:scale-[1.01]"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === 'login' ? (
                <ArrowRight className="h-4 w-4" />
              ) : (
                <UserPlus className="h-4 w-4" />
              )}
              {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
            </Button>
          </form>

          {accountsExist && accountCount > 0 && mode === 'register' && (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              Un compte existe déjà : la création d&apos;un second compte crée un espace séparé (ses propres
              conversations, agents et clés API).
            </p>
          )}

          <div className="mt-6 flex items-center justify-between text-[11px] text-muted-foreground">
            <Link href="/" className="flex items-center gap-1.5 transition-colors hover:text-foreground lg:hidden">
              <ArrowLeft className="h-3.5 w-3.5" />
              Accueil
            </Link>
            <p className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" />
              Identifiants & conversations stockés sur ce serveur uniquement.
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
