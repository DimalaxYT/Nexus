'use client'

// ─── NEXUS — Contexte d'authentification côté client ─────────────────────────
// Un seul point d'entrée pour savoir qui est connecté, se connecter, créer un
// compte, se déconnecter et mettre à jour la personnalisation du compte.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useNexusStore } from '@/lib/store'

export interface AuthUser {
  id: string
  email: string
  name: string
  isAdmin: boolean
  plan: string
  /** 'owner' | 'dev' | 'client' — seul 'dev' ouvre l'espace développeur. */
  role: 'owner' | 'dev' | 'client'
  profile: {
    displayName?: string
    assistantName?: string
    tone?: 'neutre' | 'chaleureux' | 'professionnel' | 'direct' | 'pedagogue'
    bio?: string
    language?: string
    instructions?: string
    greeting?: string
    avatarColor?: string
    theme?: 'dark' | 'light'
    company?: string
    website?: string
  }
  createdAt?: string | number | Date
}

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  /** Vrai dès qu'au moins un compte existe sur l'instance. */
  accountsExist: boolean
  accountCount: number
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string; needsCode?: boolean; devCode?: string }>
  register: (name: string, email: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  saveProfile: (patch: Partial<AuthUser['profile']> & { name?: string; email?: string }) => Promise<boolean>
  changePassword: (current: string, next: string) => Promise<{ ok: boolean; error?: string }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function api<T = unknown>(url: string, init?: RequestInit): Promise<{ ok: boolean; data: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) return { ok: false, data, error: data?.error ?? `Erreur ${res.status}` }
    return { ok: true, data }
  } catch (err) {
    return { ok: false, data: {} as T, error: err instanceof Error ? err.message : 'Réseau indisponible' }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [accountsExist, setAccountsExist] = useState(false)
  const [accountCount, setAccountCount] = useState(0)

  // À chaque changement de compte, l'historique affiché est remplacé par celui
  // du compte (jamais de mélange entre deux utilisateurs sur le même navigateur).
  const switchUserData = useNexusStore((s) => s.switchUserData)

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ user: AuthUser | null; accountsExist: boolean; accounts: number }>('/api/auth/me')
      setUser(res.data.user ?? null)
      setAccountsExist(Boolean(res.data.accountsExist))
      setAccountCount(Number(res.data.accounts ?? 0))
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Détection d'une session devenue invalide ailleurs (purge serveur,
  // révocation…) : l'AuthGate reprend la main automatiquement. Polling léger
  // (45 s) + rafraîchissement au retour sur l'onglet.
  useEffect(() => {
    if (loading) return
    const tick = () => void refresh()
    const id = setInterval(tick, 45_000)
    window.addEventListener('focus', tick)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', tick)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [loading, refresh])

  // Recharge les données du compte dès que l'utilisateur change
  useEffect(() => {
    if (loading) return
    void switchUserData(user?.id ?? null)
  }, [user?.id, loading, switchUserData])

  // La connexion ne crée plus la session directement : le serveur envoie un
  // code à 6 chiffres par e-mail (2FA) et la session est ouverte par
  // /api/auth/verify (écran « code » de l'AuthGate).
  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ needsCode?: boolean; devCode?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return { ok: false, error: res.error }
    setAccountsExist(true)
    return { ok: true, needsCode: res.data.needsCode ?? false, devCode: res.data.devCode }
  }, [])

  const register = useCallback(async (name: string, email: string, password: string) => {
    const res = await api<{ user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password }),
    })
    if (!res.ok) return { ok: false, error: res.error }
    setUser(res.data.user ?? null)
    setAccountsExist(true)
    return { ok: true }
  }, [])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
  }, [])

  const saveProfile = useCallback(
    async (patch: Partial<AuthUser['profile']> & { name?: string; email?: string }) => {
      const res = await api<{ user: AuthUser }>('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        toast.error(res.error ?? 'Mise à jour impossible')
        return false
      }
      setUser(res.data.user ?? user)
      toast.success('Personnalisation enregistrée')
      return true
    },
    [user]
  )

  const changePassword = useCallback(async (current: string, next: string) => {
    const res = await api('/api/auth/password', {
      method: 'PATCH',
      body: JSON.stringify({ current, next }),
    })
    if (!res.ok) return { ok: false, error: res.error }
    // Le serveur invalide la session : on repart proprement.
    setUser(null)
    return { ok: true }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, accountsExist, accountCount, login, register, logout, refresh, saveProfile, changePassword }),
    [user, loading, accountsExist, accountCount, login, register, logout, refresh, saveProfile, changePassword]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return ctx
}
