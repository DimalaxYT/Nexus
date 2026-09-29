'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, KeyRound, Link2, Loader2, RefreshCw, Unlink, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CONNECTION_PROVIDERS, type AccountConnectionInfo, type ConnectionProvider } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

/**
 * Panneau « Connexions » : relie tes comptes personnels (Gmail, GitHub,
 * Discord). Le token est vérifié RÉELLEMENT auprès du service (API GitHub /
 * Discord / IMAP Gmail) puis stocké localement — il n'est jamais renvoyé à
 * l'interface (seul un masque « …abcd » est visible).
 */
export function ConnectionsPanel() {
  const [connections, setConnections] = useState<AccountConnectionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [provider, setProvider] = useState<ConnectionProvider | null>(null)
  const [handle, setHandle] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/connections')
      const data = await res.json()
      setConnections(Array.isArray(data.connections) ? data.connections : [])
    } catch {
      /* serveur injoignable : on garde l'état */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const connectionOf = (p: ConnectionProvider) => connections.find((c) => c.provider === p && c.status === 'connected')
  const anyError = (p: ConnectionProvider) => connections.find((c) => c.provider === p && c.status === 'error')

  const connect = async (p: ConnectionProvider) => {
    const needsSecret = p !== 'tiktok'
    if (p === 'tiktok' && handle.trim().length < 2) {
      toast.error('Indique d’abord ton @pseudo TikTok')
      return
    }
    if (needsSecret && !secret.trim()) {
      toast.error('Colle d’abord ton token / mot de passe d’application')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: p, handle: handle.trim(), secret: secret.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connexion impossible')
      const conn = data.connection as AccountConnectionInfo
      if (data.ok) {
        toast.success(`${CONNECTION_PROVIDERS.find((x) => x.id === p)?.label} connecté ✅`, {
          description: conn.handle ? `Compte : ${conn.handle}` : conn.note,
        })
        setProvider(null)
        setHandle('')
        setSecret('')
      } else {
        toast.error('Connexion refusée par le service', { description: conn.note })
      }
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Connexion impossible')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (id: string, label: string) => {
    try {
      const res = await fetch(`/api/connections?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Suppression impossible')
      toast.info(`${label} déconnecté`)
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="mb-1 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-bold text-foreground">Connexions</h1>
          <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 px-2 text-xs text-muted-foreground hover:bg-accent" onClick={() => void refresh()}>
            <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} /> Rafraîchir
          </Button>
        </div>
        <p className="mb-5 text-xs leading-relaxed text-muted-foreground">
          Relie tes comptes personnels à NEXUS. Chaque secret est <strong className="text-foreground/80">vérifié réellement</strong> auprès
          du service avant d’être enregistré, puis stocké <strong className="text-foreground/80">localement sur ce serveur</strong> — il
          n’est jamais affiché en clair ni partagé. Une fois un compte relié, <strong className="text-foreground/80">NEXUS et chaque agent</strong> de
          ton équipe peuvent s’en servir : demande « lis ma boîte mail », « mes repos GitHub » ou « mon TikTok » dans le chat.
        </p>

        <div className="flex flex-col gap-3">
          {CONNECTION_PROVIDERS.map((p) => {
            const conn = connectionOf(p.id)
            const err = anyError(p.id)
            const isEditing = provider === p.id
            return (
              <div
                key={p.id}
                className={cn(
                  'rounded-xl border bg-muted/40 p-4 transition-colors',
                  conn ? 'border-emerald-500/40' : err ? 'border-rose-500/40' : 'border-border'
                )}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-xl">{p.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{p.label}</p>
                      {conn ? (
                        <span className="flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                          <CheckCircle2 className="h-3 w-3" /> Connecté {conn.handle ? `· ${conn.handle}` : ''}
                        </span>
                      ) : err ? (
                        <span className="flex items-center gap-1 rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-300">
                          <XCircle className="h-3 w-3" /> Échec
                        </span>
                      ) : (
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                          Non connecté
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{p.hint}</p>
                    {conn && conn.secretMask && (
                      <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                        <KeyRound className="h-3 w-3" /> Secret enregistré : {conn.secretMask} {conn.note ? `· ${conn.note}` : ''}
                      </p>
                    )}
                    {err && err.note && <p className="mt-1 text-[10px] text-rose-300/80">{err.note}</p>}
                  </div>
                  {conn ? (
                    <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1 border-border text-xs text-rose-400 hover:bg-rose-500/10" onClick={() => void disconnect(conn.id, p.label)}>
                      <Unlink className="h-3 w-3" /> <span className="hidden sm:inline">Déconnecter</span>
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className={cn('h-8 shrink-0 gap-1 border-border text-xs hover:bg-accent', isEditing && 'bg-accent text-violet-300')}
                      onClick={() => {
                        setProvider(isEditing ? null : p.id)
                        setSecret('')
                        setHandle(err?.handle ?? '')
                      }}
                      aria-expanded={isEditing}
                    >
                      {isEditing ? 'Annuler' : 'Connecter'}
                    </Button>
                  )}
                </div>

                {isEditing && !conn && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border/70 bg-background/60 p-3">
                    {(p.id === 'gmail' || p.id === 'tiktok') && (
                      <Input
                        value={handle}
                        onChange={(e) => setHandle(e.target.value)}
                        placeholder={p.id === 'gmail' ? 'Adresse Gmail (ex : moi@gmail.com)' : 'Ton @pseudo TikTok (ex : @tonpseudo)'}
                        className="h-9 border-border bg-muted/60 text-sm"
                        aria-label={p.id === 'gmail' ? 'Adresse Gmail' : 'Pseudo TikTok'}
                        type={p.id === 'gmail' ? 'email' : 'text'}
                      />
                    )}
                    <Input
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={p.secretLabel}
                      className="h-9 border-border bg-muted/60 font-mono text-sm"
                      aria-label={p.secretLabel}
                      type="password"
                      autoComplete="off"
                    />
                    <Button
                      size="sm"
                      className="h-9 gap-1.5 bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
                      onClick={() => void connect(p.id)}
                      disabled={busy || (p.id === 'tiktok' ? handle.trim().length < 2 : secret.trim().length < 8)}
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      Vérifier et connecter {p.label}
                    </Button>
                    <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                      La vérification est faite en direct auprès de {p.label}. Si le réseau du serveur bloque la connexion, un message
                      d’erreur clair s’affichera — rien n’est enregistré en cas d’échec d’authentification.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
