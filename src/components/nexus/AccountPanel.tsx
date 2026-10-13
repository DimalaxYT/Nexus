'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  KeyRound,
  Loader2,
  Lock,
  Palette,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  User as UserIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/auth-client'
import { useNexusStore } from '@/lib/store'

const TONES = [
  { id: 'chaleureux', label: 'Chaleureux', hint: 'proche et encourageant' },
  { id: 'neutre', label: 'Neutre', hint: 'factuel' },
  { id: 'professionnel', label: 'Professionnel', hint: 'sobre et précis' },
  { id: 'direct', label: 'Direct', hint: 'court, sans détour' },
  { id: 'pedagogue', label: 'Pédagogue', hint: 'explique pas à pas' },
] as const

const COLORS = ['#a78bfa', '#38bdf8', '#34d399', '#f472b6', '#fbbf24', '#f87171', '#60a5fa', '#c084fc']

interface Stats {
  conversations: number
  agents: number
  blueprints: number
  keys: number
  memories: number
}

/** Mon compte : identité, personnalisation de NEXUS, sécurité et données. */
export function AccountPanel() {
  const { user, saveProfile, changePassword, logout } = useAuth()
  const conversations = useNexusStore((s) => s.conversations)
  const deleteAllConversations = useNexusStore((s) => s.deleteAllConversations)

  // État initialisé à partir du compte : le panneau est remonté (prop `key`)
  // dès que l'utilisateur change — pas besoin d'effet de synchronisation.
  const profile = user?.profile ?? {}
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [displayName, setDisplayName] = useState(profile.displayName ?? user?.name ?? '')
  const [assistantName, setAssistantName] = useState(profile.assistantName ?? 'NEXUS')
  const [tone, setTone] = useState(profile.tone ?? 'chaleureux')
  const [bio, setBio] = useState(profile.bio ?? '')
  const [language, setLanguage] = useState(profile.language ?? 'fr')
  const [instructions, setInstructions] = useState(profile.instructions ?? '')
  const [greeting, setGreeting] = useState(profile.greeting ?? '')
  const [company, setCompany] = useState(profile.company ?? '')
  const [website, setWebsite] = useState(profile.website ?? '')
  const [color, setColor] = useState(profile.avatarColor ?? '#a78bfa')

  const [saving, setSaving] = useState(false)
  const [stats, setStats] = useState<Stats | null>(null)

  const [pwdCurrent, setPwdCurrent] = useState('')
  const [pwdNext, setPwdNext] = useState('')
  const [pwdBusy, setPwdBusy] = useState(false)

  const loadStats = useCallback(async () => {
    try {
      const [conv, agents, blueprints, keys, mem] = await Promise.all([
        fetch('/api/conversations').then((r) => r.json()).catch(() => ({})),
        fetch('/api/agents').then((r) => r.json()).catch(() => ({})),
        fetch('/api/blueprints').then((r) => r.json()).catch(() => ({})),
        fetch('/api/keys').then((r) => r.json()).catch(() => ({})),
        fetch('/api/memory').then((r) => r.json()).catch(() => ({})),
      ])
      setStats({
        conversations: Array.isArray(conv?.conversations) ? conv.conversations.length : 0,
        agents: Array.isArray(agents?.agents) ? agents.agents.length : 0,
        blueprints: Array.isArray(blueprints?.blueprints) ? blueprints.blueprints.length : 0,
        keys: Array.isArray(keys?.keys) ? keys.keys.length : 0,
        memories: Array.isArray(mem?.memories) ? mem.memories.length : 0,
      })
    } catch {
      /* stats indicatives */
    }
  }, [])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  async function save() {
    setSaving(true)
    const ok = await saveProfile({
      name,
      email,
      displayName,
      assistantName,
      tone: tone as 'chaleureux',
      bio,
      language,
      instructions,
      greeting,
      company,
      website,
      avatarColor: color,
    })
    setSaving(false)
    if (ok) void loadStats()
  }

  async function submitPassword() {
    if (pwdNext.length < 8) return toast.error('8 caractères minimum, dont un chiffre.')
    setPwdBusy(true)
    const res = await changePassword(pwdCurrent, pwdNext)
    setPwdBusy(false)
    setPwdCurrent('')
    setPwdNext('')
    if (res.ok) toast.success('Mot de passe changé — reconnectez-vous.')
    else toast.error(res.error ?? 'Changement impossible')
  }

  const initial = (displayName || name || email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {/* En-tête du compte */}
        <div className="flex items-center gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white shadow-lg"
            style={{ background: `linear-gradient(135deg, ${color}, ${color}99)` }}
          >
            {initial}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-foreground">{displayName || name || 'Mon compte'}</h1>
            <p className="truncate text-sm text-muted-foreground">{email}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {stats
                ? `${stats.conversations} conversation(s) · ${stats.agents} agent(s) · ${stats.blueprints} schéma(s) · ${stats.keys} clé(s) API · ${stats.memories} souvenir(s)`
                : 'Chargement de vos données…'}
            </p>
          </div>
        </div>

        {/* Identité */}
        <Card className="border-border/70 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserIcon className="h-4 w-4 text-violet-400" /> Identité
            </CardTitle>
            <CardDescription className="text-xs">Nom affiché et adresse e-mail de connexion.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="acc-name">Nom</Label>
              <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="acc-email">E-mail</Label>
              <Input id="acc-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Personnalisation */}
        <Card className="border-border/70 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-400" /> Personnalisation de NEXUS
            </CardTitle>
            <CardDescription className="text-xs">
              Ces réglages sont propres à <strong>ce compte</strong> : NEXUS adopte votre ton, votre prénom et vos
              consignes à chaque réponse.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-display">Prénom à utiliser</Label>
                <Input id="acc-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-assistant">Appeler l&apos;assistant</Label>
                <Input id="acc-assistant" value={assistantName} onChange={(e) => setAssistantName(e.target.value)} placeholder="NEXUS" />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="acc-company">Entreprise / marque</Label>
                <Input id="acc-company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Optionnel" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-website">Site / référence</Label>
                <Input id="acc-website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Optionnel" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Ton de NEXUS</Label>
              <div className="flex flex-wrap gap-2">
                {TONES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id)}
                    title={t.hint}
                    className={
                      'rounded-full border px-3 py-1.5 text-xs transition-all ' +
                      (tone === t.id
                        ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                        : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground')
                    }
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Couleur de l&apos;avatar</Label>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={
                      'h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ' +
                      (color === c ? 'border-white' : 'border-transparent')
                    }
                    style={{ background: c }}
                    aria-label={`Couleur ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="acc-bio">Votre métier / contexte</Label>
              <Textarea
                id="acc-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Ex. : je gère une boutique en ligne de pièces informatiques."
                className="min-h-[70px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="acc-greeting">Message d&apos;accueil du chat</Label>
              <Input
                id="acc-greeting"
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                placeholder="Optionnel — laissé vide, NEXUS accueille naturellement"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="acc-instructions">Consignes permanentes</Label>
              <Textarea
                id="acc-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Ex. : réponds toujours en technicien SAV, propose un diagnostic en 3 étapes, termine par une question."
                className="min-h-[110px]"
              />
              <p className="text-[11px] text-muted-foreground">
                Injectées dans le cerveau de NEXUS à chaque échange de ce compte.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={saving} className="gap-2 bg-violet-600 hover:bg-violet-500">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Enregistrer
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Sécurité */}
        <Card className="border-border/70 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4 text-emerald-400" /> Sécurité
            </CardTitle>
            <CardDescription className="text-xs">
              Le mot de passe est haché en local (scrypt) — il n&apos;est jamais stocké en clair.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pwd-current">Mot de passe actuel</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pwd-current"
                    type="password"
                    value={pwdCurrent}
                    onChange={(e) => setPwdCurrent(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pwd-next">Nouveau mot de passe</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="pwd-next"
                    type="password"
                    value={pwdNext}
                    onChange={(e) => setPwdNext(e.target.value)}
                    className="pl-9"
                    placeholder="8 caractères mini + 1 chiffre"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={submitPassword} disabled={pwdBusy} className="gap-2">
                {pwdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Changer le mot de passe
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Données */}
        <Card className="border-border/70 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4 text-sky-400" /> Mes données
            </CardTitle>
            <CardDescription className="text-xs">
              Tout ce qui est listé ci-dessous n&apos;appartient qu&apos;à ce compte.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: 'Conversations', value: stats?.conversations ?? conversations.length },
                { label: 'Agents', value: stats?.agents ?? 0 },
                { label: 'Schémas', value: stats?.blueprints ?? 0 },
                { label: 'Clés API', value: stats?.keys ?? 0 },
                { label: 'Souvenirs', value: stats?.memories ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-border/70 bg-muted/30 p-3 text-center">
                  <p className="text-lg font-bold text-foreground">{s.value}</p>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
                </div>
              ))}
            </div>

            <Separator />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Effacer tout l&apos;historique</p>
                <p className="text-[11px] text-muted-foreground">
                  Supprime définitivement les conversations de ce compte (les agents et clés sont conservés).
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => {
                  if (confirm('Supprimer toutes les conversations de ce compte ?')) {
                    deleteAllConversations()
                    toast.success('Historique effacé')
                    void loadStats()
                  }
                }}
                className="gap-2"
              >
                <Trash2 className="h-4 w-4" /> Effacer
              </Button>
            </div>

            <Separator />

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => void logout()} className="gap-2">
                Se déconnecter
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
