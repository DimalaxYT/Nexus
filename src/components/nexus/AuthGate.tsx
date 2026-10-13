'use client'

import { useState } from 'react'
import { useTheme } from 'next-themes'
import { ArrowRight, Bot, KeyRound, Loader2, Lock, Mail, ShieldCheck, Sparkles, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth-client'
import { useSiteSettings } from '@/lib/site-settings-client'
import { cn } from '@/lib/utils'

/**
 * Écran de connexion / création de compte.
 * Il s'affiche dès qu'un compte existe sur l'instance : chaque utilisateur a
 * alors SON historique, SES agents, SES clés API et SA personnalisation.
 */
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
  const { setTheme } = useTheme()

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/* Halos décoratifs */}
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-fuchsia-600/15 blur-3xl" />

      <div className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl text-3xl shadow-xl"
            style={{
              background: `linear-gradient(135deg, ${settings.accent}, ${settings.accent2})`,
              boxShadow: `0 20px 40px -12px ${settings.accent}80`,
            }}
          >
            {settings.logoEmoji ? <span aria-hidden>{settings.logoEmoji}</span> : <Bot className="h-8 w-8 text-white" />}
          </div>
          <h1 className="text-2xl font-extrabold tracking-widest text-foreground">{settings.appName}</h1>
          <p className="mt-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">{settings.tagline}</p>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{settings.loginSubtitle}</p>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/80 p-6 shadow-2xl backdrop-blur">
          <h2 className="mb-4 text-center text-sm font-semibold text-foreground">{settings.loginTitle}</h2>
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-muted/60 p-1">
            <button
              onClick={() => { setMode('login'); setError('') }}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-all',
                mode === 'login' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Connexion
            </button>
            <button
              onClick={() => { setMode('register'); setError('') }}
              className={cn(
                'rounded-lg px-3 py-2 text-sm font-medium transition-all',
                mode === 'register' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Créer un compte
            </button>
          </div>

          {mode === 'register' && !accountsExist && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-xs text-violet-200">
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
                  className="pl-9"
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
                  placeholder="8 caractères minimum"
                  className="pl-9"
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
                    className="pl-9"
                    required
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
            )}

            <Button type="submit" disabled={busy} className="w-full gap-2 bg-violet-600 hover:bg-violet-500">
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

          <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-border/70 bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-400" />
            <p>
              Vos identifiants, vos conversations, vos agents et vos clés API restent <strong>uniquement sur ce
              serveur</strong> — NEXUS n&apos;appelle aucun service d&apos;IA externe.
            </p>
          </div>

          {accountsExist && accountCount > 0 && mode === 'register' && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Un compte existe déjà : la création d&apos;un second compte crée un espace séparé (ses propres
              conversations, agents et clés API).
            </p>
          )}
        </div>

        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setTheme('light')}
            className="text-[11px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Activer le thème clair
          </button>
        </div>
      </div>
    </div>
  )
}
