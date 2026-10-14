'use client'

// ─── NEXUS — Porte d'entrée de l'application (connexion / création) ──────────
// Écran d'accès à /app : tant que l'utilisateur n'est pas connecté, aucune
// fonction n'est montée. Flux complet :
//   connexion → code de vérification e-mail (2FA) → session
//   mot de passe oublié → code e-mail → nouveau mot de passe
// Identité monochrome : noir #000 / gris foncé #1A1A1A / gris #6B6B6B / blanc.

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Moon,
  ShieldCheck,
  Sun,
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

type Screen = 'login' | 'register' | 'forgot' | 'reset'

const MARKETING_POINTS = [
  { icon: Zap, text: 'Cerveau local — réflexions en moins de 50 ms, sans service externe.' },
  { icon: Workflow, text: 'Blueprints : dessinez le schéma de vos agents sur canvas.' },
  { icon: ShieldCheck, text: 'Connexion confirmée par un code e-mail (2FA) à chaque fois.' },
]

function ThemeToggleCorner() {
  const { resolvedTheme, setTheme } = useTheme()
  // Garde d'hydratation : resolvedTheme est undefined avant le montage.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const dark = mounted && resolvedTheme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-5 top-5 z-10 h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(dark ? 'light' : 'dark')}
      aria-label={dark ? 'Passer en thème clair' : 'Passer en thème sombre'}
    >
      <Sun className="h-4 w-4 dark:hidden" />
      <Moon className="hidden h-4 w-4 dark:block" />
    </Button>
  )
}

export function AuthGate() {
  const { login, register, accountsExist, accountCount, refresh } = useAuth()
  const { settings } = useSiteSettings()
  // Mode initial : création de compte si l'instance n'en a aucun, connexion sinon.
  const [screen, setScreen] = useState<Screen>(accountsExist ? 'login' : 'register')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  function go(screen: Screen) {
    setScreen(screen)
    setError('')
    setInfo('')
    setCode('')
    setDevCode(null)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (screen === 'register') {
      if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
      if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères (dont un chiffre).')
      if (!/\d/.test(password)) return setError('Le mot de passe doit contenir au moins un chiffre.')
    }

    setBusy(true)
    if (screen === 'login') {
      // Connexion en une étape : la session est posée par la réponse du serveur.
      const res = await login(email, password)
      setBusy(false)
      if (!res.ok) return setError(res.error ?? 'Une erreur est survenue')
      return
    }
    if (screen === 'forgot') {
      try {
        const r = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const d = (await r.json()) as { ok?: boolean; devCode?: string; error?: string }
        setBusy(false)
        if (!r.ok || !d.ok) return setError(d.error ?? 'Demande impossible.')
        setDevCode(d.devCode ?? null)
        setInfo(`Si un compte existe pour ${email}, un code vient d'être envoyé${d.devCode ? ' (SMTP non configuré : code affiché ci-dessous).' : '.'}`)
        setScreen('reset')
      } catch {
        setBusy(false)
        setError('Réseau indisponible.')
      }
      return
    }
    // register
    const res = await register(name, email, password)
    setBusy(false)
    if (!res.ok) setError(res.error ?? 'Une erreur est survenue')
  }

  /** Réinitialisation : vérif du code puis application du nouveau mot de passe. */
  async function submitReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) return setError('Les deux mots de passe ne correspondent pas.')
    if (password.length < 8 || !/\d/.test(password)) {
      return setError('Le mot de passe doit contenir au moins 8 caractères (dont un chiffre).')
    }
    setBusy(true)
    try {
      if (!resetToken) {
        const v = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ step: 'verify', email, code }),
        })
        const dv = (await v.json()) as { ok?: boolean; resetToken?: string; error?: string }
        if (!v.ok || !dv.ok || !dv.resetToken) {
          setBusy(false)
          return setError(dv.error ?? 'Code refusé.')
        }
        setResetToken(dv.resetToken)
        setInfo('Code validé — choisissez votre nouveau mot de passe.')
        setBusy(false)
        return
      }
      const a = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'apply', email, resetToken, password }),
      })
      const da = (await a.json()) as { ok?: boolean; error?: string }
      setBusy(false)
      if (!a.ok || !da.ok) return setError(da.error ?? 'Réinitialisation impossible.')
      toast.success('Mot de passe mis à jour — connectez-vous.')
      go('login')
    } catch {
      setBusy(false)
      setError('Réseau indisponible.')
    }
  }

  const isReset = screen === 'reset'
  const title =
    screen === 'login' || screen === 'register'
      ? settings.loginTitle
      : isReset
        ? 'Nouveau mot de passe'
        : 'Mot de passe oublié'
  const subtitle =
    screen === 'login' || screen === 'register'
      ? settings.loginSubtitle
      : isReset
        ? info || 'Saisissez le code reçu par e-mail puis votre nouveau mot de passe.'
        : 'Nous vous enverrons un code de réinitialisation.'

  return (
    <div className="relative flex min-h-dvh bg-background text-foreground">
      <ThemeToggleCorner />
      {/* Décor brume */}
      <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />

      {/* ── Panneau de marque (desktop) ─────────────────────────────────── */}
      <aside className="relative hidden w-[46%] shrink-0 flex-col justify-between overflow-hidden border-r border-border/60 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 bg-grid" aria-hidden />
        <div className="pointer-events-none absolute -left-24 top-1/3 h-96 w-96 rounded-full bg-foreground/5 blur-3xl" aria-hidden />

        <Link href="/" className="relative flex items-center gap-2.5 text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Retour à l&apos;accueil
        </Link>

        <div className="relative">
          <div className="mb-8 flex items-center gap-3">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl font-display text-xl font-bold text-background"
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
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/50 text-foreground">
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                  {point.text}
                </li>
              )
            })}
          </ul>
        </div>

        <p className="relative font-mono text-[11px] leading-relaxed text-muted-foreground/70">
          « Réseau de neurones embarqué, aucune API externe — vos données restent
          sous votre contrôle. »
        </p>
      </aside>

      {/* ── Formulaire ──────────────────────────────────────────────────── */}
      <main className="relative flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          {/* Marque compacte (mobile) */}
          <div className="mb-8 flex flex-col items-center text-center lg:hidden">
            <span
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl font-display text-xl font-bold text-background"
              style={{ background: `linear-gradient(135deg, ${settings.accent}, ${settings.accent2})` }}
            >
              {settings.logoEmoji ? <span aria-hidden>{settings.logoEmoji}</span> : <Bot className="h-6 w-6" />}
            </span>
            <h1 className="font-display text-xl font-bold tracking-[0.22em]">{settings.appName}</h1>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{settings.tagline}</p>
          </div>

          <div className="mb-6">
            <h2 className="font-display text-2xl font-bold tracking-tight">{title}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
          </div>

          {info && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3.5 text-xs leading-relaxed text-foreground/85">
              <Mail className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{info}</p>
            </div>
          )}

          {devCode && (
            <div className="mb-5 rounded-xl border border-dashed border-foreground/30 bg-muted/40 p-3.5 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Mode développement — votre code
              </p>
              <p className="mt-1 font-mono text-2xl font-bold tracking-[0.4em] text-foreground">{devCode}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Configurez SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM pour l&apos;envoi réel.
              </p>
            </div>
          )}

          {(screen === 'login' || screen === 'register') && (
            <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-border/70 bg-muted/40 p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { go(m); setEmail(''); setPassword(''); setConfirm('') }}
                  aria-pressed={screen === m}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm font-medium transition-all',
                    screen === m
                      ? 'bg-foreground text-background shadow'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {m === 'login' ? 'Connexion' : 'Créer un compte'}
                </button>
              ))}
            </div>
          )}

          {screen === 'register' && !accountsExist && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-border bg-muted/50 p-3.5 text-xs leading-relaxed text-foreground/80">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Aucun compte sur cette instance : celui-ci deviendra le <strong>compte propriétaire</strong> et
                récupérera les données déjà présentes (agents, conversations, connaissances).
              </p>
            </div>
          )}

          {isReset && (
            <form onSubmit={submitReset} className="space-y-4">
              {isReset && !resetToken && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-code">Code reçu par e-mail</Label>
                  <Input
                    id="auth-code"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="••••••"
                    className="rounded-xl text-center font-mono text-lg tracking-[0.5em]"
                    autoComplete="one-time-code"
                    required
                  />
                </div>
              )}
              {isReset && resetToken && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-newpass">Nouveau mot de passe</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="auth-newpass"
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="8 caractères minimum, dont un chiffre"
                        className="rounded-xl pl-9"
                        required
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="auth-newconfirm">Confirmer</Label>
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        id="auth-newconfirm"
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
                </>
              )}
              {error && (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">{error}</p>
              )}
              <Button
                type="submit"
                disabled={busy}
                className="h-11 w-full gap-2 rounded-xl bg-foreground font-semibold text-background transition-transform hover:scale-[1.01] hover:opacity-90"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                {resetToken ? 'Enregistrer le mot de passe' : 'Valider le code'}
              </Button>
              <button
                type="button"
                onClick={() => go('login')}
                className="w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                Retour à la connexion
              </button>
            </form>
          )}

          {(screen === 'login' || screen === 'register') && (
            <form onSubmit={submit} className="space-y-4">
              {screen === 'register' && (
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="auth-password">Mot de passe</Label>
                  {screen === 'login' && (
                    <button
                      type="button"
                      onClick={() => { go('forgot'); setPassword(''); setConfirm('') }}
                      className="text-[11px] text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      Mot de passe oublié ?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={screen === 'register' ? '8 caractères minimum, dont un chiffre' : 'Votre mot de passe'}
                    className="rounded-xl pl-9"
                    required
                    autoComplete={screen === 'login' ? 'current-password' : 'new-password'}
                  />
                </div>
              </div>

              {screen === 'register' && (
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
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">{error}</p>
              )}

              <Button
                type="submit"
                disabled={busy}
                className="h-11 w-full gap-2 rounded-xl bg-foreground font-semibold text-background transition-transform hover:scale-[1.01] hover:opacity-90"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : screen === 'login' ? (
                  <ArrowRight className="h-4 w-4" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {screen === 'login' ? 'Se connecter' : 'Créer mon compte'}
              </Button>
            </form>
          )}

          {screen === 'forgot' && (
            <form onSubmit={submit} className="space-y-4">
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
                    required
                  />
                </div>
              </div>
              {error && (
                <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-400">{error}</p>
              )}
              <Button
                type="submit"
                disabled={busy}
                className="h-11 w-full gap-2 rounded-xl bg-foreground font-semibold text-background transition-transform hover:scale-[1.01] hover:opacity-90"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                Envoyer le code
              </Button>
              <button
                type="button"
                onClick={() => go('login')}
                className="flex w-full items-center justify-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3 w-3" /> Retour à la connexion
              </button>
            </form>
          )}

          {accountsExist && accountCount > 0 && screen === 'register' && (
            <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground">
              Un compte existe déjà : la création d&apos;un second compte crée un espace séparé (ses propres
              conversations, agents et clés API).
            </p>
          )}

          {(screen === 'login' || screen === 'register') && (
            <div className="mt-6 flex items-center justify-between text-[11px] text-muted-foreground">
              <Link href="/" className="flex items-center gap-1.5 transition-colors hover:text-foreground lg:hidden">
                <ArrowLeft className="h-3.5 w-3.5" />
                Accueil
              </Link>
              <p className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                Mots de passe scrypt, secrets chiffrés AES-256-GCM.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
