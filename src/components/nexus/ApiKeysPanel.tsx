'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MATCH_MODES, type ReplyRule } from '@/lib/rules'
import { PERSONAL_KEY_POLICY, type ApiKeyConfig, type ApiKeyInfo } from '@/lib/api-keys-shared'
import type { BlueprintSummary, NexusAgent } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

const DEFAULT_CONFIG: ApiKeyConfig = {
  rules: [],
  systemPrompt: '',
  welcomeMessage: '',
  fallbackMessage: "Je n'ai pas compris votre demande. Pouvez-vous la reformuler ?",
  allowedOrigins: [],
  rateLimitPerMin: 60,
  useAgent: false,
  strictRulesOnly: false,
  debug: false,
}

/** Panneau de création et de configuration des clés API (chatbots revendables). */
export function ApiKeysPanel() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([])
  const [agents, setAgents] = useState<NexusAgent[]>([])
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Secrets connus uniquement pour les clés créées pendant cette session. */
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})

  // Formulaire de création
  const [newName, setNewName] = useState('')
  const [newAgent, setNewAgent] = useState('')
  const [newBlueprint, setNewBlueprint] = useState('')
  const [newPersonal, setNewPersonal] = useState(false)
  const [newLifetime, setNewLifetime] = useState(90)
  const [creating, setCreating] = useState(false)

  // Édition de la clé sélectionnée
  const [draft, setDraft] = useState<{ name: string; agentId: string; blueprintId: string; config: ApiKeyConfig; enabled: boolean } | null>(null)
  const [saving, setSaving] = useState(false)

  // Test en direct
  const [testMessage, setTestMessage] = useState('Pourquoi mon ordinateur ne fonctionne pas')
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState<{ reply: string; source: string; matched: string | null; ms: number } | null>(null)
  const [logs, setLogs] = useState<{ id: string; at: string; ok: boolean; ms: number; message: string; reply: string }[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [k, a, b] = await Promise.all([
        fetch('/api/keys').then((r) => r.json()),
        fetch('/api/agents').then((r) => r.json()),
        fetch('/api/blueprints').then((r) => r.json()),
      ])
      const list: ApiKeyInfo[] = Array.isArray(k?.keys) ? k.keys : []
      setKeys(list)
      setAgents(Array.isArray(a?.agents) ? a.agents : [])
      setBlueprints(Array.isArray(b?.blueprints) ? b.blueprints : [])
      setSelectedId((prev) => prev ?? list[0]?.id ?? null)
    } catch {
      toast.error('Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const selected = useMemo(() => keys.find((k) => k.id === selectedId) ?? null, [keys, selectedId])

  useEffect(() => {
    if (!selected) return setDraft(null)
    setDraft({
      name: selected.name,
      agentId: selected.agentId,
      blueprintId: selected.blueprintId,
      enabled: selected.enabled,
      config: {
        ...DEFAULT_CONFIG,
        ...selected.config,
        rules: Array.isArray(selected.config?.rules) ? selected.config.rules : [],
      },
    })
    setTestOut(null)
    // Charge les derniers appels de la clé
    void fetch(`/api/keys/${selected.id}/logs?take=10`)
      .then((r) => r.json())
      .then((d) => setLogs(Array.isArray(d?.logs) ? d.logs : []))
      .catch(() => setLogs([]))
     
  }, [selected?.id])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || 'Clé API', agentId: newAgent, blueprintId: newBlueprint, config: DEFAULT_CONFIG, personalUse: newPersonal, lifetimeDays: newLifetime }),
      })
      const data = (await res.json()) as { key?: ApiKeyInfo; secret?: string; error?: string }
      if (!res.ok || !data.key) throw new Error(data.error ?? 'Création impossible')
      if (data.secret) setSecrets((s) => ({ ...s, [data.key!.id]: data.secret! }))
      setNewName('')
      setNewAgent('')
      setNewBlueprint('')
      setNewPersonal(false)
      setSelectedId(data.key.id)
      toast.success('Clé créée — copiez-la maintenant, elle ne sera plus affichée.')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  const saveKey = async () => {
    if (!selected || !draft) return
    setSaving(true)
    try {
      const res = await fetch(`/api/keys/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = (await res.json()) as { key?: ApiKeyInfo; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Mise à jour impossible')
      toast.success('Configuration enregistrée')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Mise à jour impossible')
    } finally {
      setSaving(false)
    }
  }

  // Renouvellement : repousse l'échéance (durées autorisées par la politique personnelle).
  const renewKey = async (id: string, days: number) => {
    try {
      const res = await fetch(`/api/keys/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renewDays: days }),
      })
      const data = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Renouvellement impossible')
      toast.success(`Clé renouvelée pour ${days} jours`)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Renouvellement impossible')
    }
  }

  const removeKey = async (id: string) => {
    if (!confirm('Supprimer cette clé ? Les chatbots qui l\'utilisent cesseront de répondre.')) return
    await fetch(`/api/keys/${id}`, { method: 'DELETE' })
    if (selectedId === id) setSelectedId(null)
    toast.success('Clé supprimée')
    await load()
  }

  const testKey = async () => {
    if (!selected) return
    const secret = secrets[selected.id]
    if (!secret) return toast.error('Secret inconnu : il n\'est affiché qu\'à la création. Créez une nouvelle clé pour la tester.')
    if (!testMessage.trim()) return toast.error('Écrivez un message à tester.')
    setTesting(true)
    setTestOut(null)
    try {
      const res = await fetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ message: testMessage }),
      })
      const data = (await res.json()) as { reply?: string; source?: string; matched?: string | null; ms?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Appel impossible')
      setTestOut({ reply: data.reply ?? '', source: data.source ?? '?', matched: data.matched ?? null, ms: Number(data.ms ?? 0) })
      void fetch(`/api/keys/${selected.id}/logs?take=10`)
        .then((r) => r.json())
        .then((d) => setLogs(Array.isArray(d?.logs) ? d.logs : []))
        .catch(() => {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Appel impossible')
    } finally {
      setTesting(false)
    }
  }

  const copy = (text: string, label = 'Copié') => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(label),
      () => toast.error('Copie impossible')
    )
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://votre-serveur'
  const secret = selected ? secrets[selected.id] : undefined

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-300/20 to-neutral-500/20">
            <KeyRound className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Clés API</h1>
            <p className="text-sm text-muted-foreground">
              Une clé = un chatbot prêt à vendre. Vous définissez ses règles de réponse exactes
              (« quand tu lis X, réponds Y »), son schéma d&apos;agent et ses limites.
            </p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          {/* Colonne de gauche : création + liste */}
          <div className="space-y-4">
            <Card className="border-border/70 bg-card/60">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Plus className="h-4 w-4 text-amber-400" /> Nouvelle clé
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Nom (votre client, votre usage)</Label>
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex. : Bot SAV — Dépann'PC" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Agent lié (optionnel)</Label>
                  <select
                    value={newAgent}
                    onChange={(e) => setNewAgent(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
                  >
                    <option value="">Aucun</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Schéma (blueprint) lié</Label>
                  <select
                    value={newBlueprint}
                    onChange={(e) => setNewBlueprint(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
                  >
                    <option value="">Aucun (celui de l&apos;agent le cas échéant)</option>
                    {blueprints.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
                  <p className="text-[11px] font-semibold text-foreground">Usage personnel et non commercial</p>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Ces clés servent à ton usage personnel (projets, tests, apprentissage). Elles ne sont pas destinées à être revendues
                    ni à alimenter un service commercial. Chaque clé expire et doit être renouvelée. Maximum 5 clés actives par compte.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2 text-[11px] text-foreground">
                    <input type="checkbox" className="mt-0.5" checked={newPersonal} onChange={(e) => setNewPersonal(e.target.checked)} />
                    Je certifie un usage personnel et non commercial de cette clé.
                  </label>
                  <select
                    value={newLifetime}
                    onChange={(e) => setNewLifetime(Number(e.target.value))}
                    className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
                  >
                    <option value={30}>Valable 30 jours</option>
                    <option value={90}>Valable 90 jours (recommandé)</option>
                    <option value={365}>Valable 1 an</option>
                  </select>
                </div>
                <Button onClick={create} disabled={creating || !newPersonal} className="w-full gap-2 bg-amber-600 hover:bg-neutral-300">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Générer la clé
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Mes clés ({keys.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {loading ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Chargement…</p>
                ) : keys.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">Aucune clé pour l&apos;instant.</p>
                ) : (
                  keys.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setSelectedId(k.id)}
                      className={cn(
                        'w-full rounded-xl border p-3 text-left transition-all',
                        selectedId === k.id
                          ? 'border-neutral-300/40 bg-neutral-300/10'
                          : 'border-border/70 bg-muted/20 hover:bg-muted/40'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{k.name}</span>
                        <span className={cn('h-2 w-2 shrink-0 rounded-full', k.enabled ? 'bg-neutral-400' : 'bg-zinc-500')} />
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {k.prefix}••••{k.last4}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground/80">
                        {Number(k.totalCalls ?? 0)} appel(s){k.config?.rules?.length ? ` · ${k.config.rules.length} règle(s)` : ''}
                      </p>
                      {k.config?.expiresAt ? (
                        <p className={cn('mt-0.5 text-[10px]', Date.parse(k.config.expiresAt) <= Date.now() ? 'text-rose-300' : 'text-muted-foreground/80')}>
                          {Date.parse(k.config.expiresAt) <= Date.now()
                            ? 'Expirée — supprime-la et crée-en une nouvelle'
                            : `Expire le ${new Date(k.config.expiresAt).toLocaleDateString('fr-FR')}`}
                        </p>
                      ) : null}
                    </button>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Colonne de droite : configuration */}
          <div className="space-y-4">
            {!selected || !draft ? (
              <Card className="border-dashed border-border/70 bg-card/40">
                <CardContent className="py-20 text-center">
                  <KeyRound className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">Sélectionnez une clé pour la configurer.</p>
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Secret + intégration */}
                <Card className="border-neutral-300/30 bg-neutral-300/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ShieldCheck className="h-4 w-4 text-amber-400" /> Clé secrète
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Affichée <strong>une seule fois</strong>, à la création. Elle n&apos;est pas stockée en clair.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {secret ? (
                      <div className="flex items-center gap-2 rounded-lg border border-neutral-300/30 bg-background/60 p-2">
                        <code className="min-w-0 flex-1 truncate font-mono text-xs text-amber-200">
                          {showSecret[selected.id] ? secret : `${secret.slice(0, 8)}${'•'.repeat(24)}${secret.slice(-4)}`}
                        </code>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowSecret((s) => ({ ...s, [selected.id]: !s[selected.id] }))}>
                          {showSecret[selected.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => copy(secret, 'Clé copiée')}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <p className="rounded-lg border border-border/70 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
                        Secret non affichable (clé créée lors d&apos;une session précédente). Pour la tester ici,
                        créez une nouvelle clé : l&apos;API, elle, continue de fonctionner normalement.
                      </p>
                    )}

                    <div className="rounded-lg border border-border/70 bg-zinc-950/60 p-3">
                      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <Terminal className="h-3 w-3" /> Intégration (à donner à votre client)
                      </p>
                      <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-zinc-300">
{`curl -X POST ${origin}/api/v1/chat \\
  -H "Authorization: Bearer ${secret ?? selected.prefix + '••••' + selected.last4}" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Pourquoi mon ordinateur ne fonctionne pas"}'`}
                      </pre>
                      <Button size="sm" variant="outline" className="mt-2 gap-1.5" onClick={() => copy(
`const res = await fetch('${origin}/api/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ${secret ?? 'VOTRE_CLE'}' },
  body: JSON.stringify({ message: 'Pourquoi mon ordinateur ne fonctionne pas' })
})
const { reply } = await res.json()
console.log(reply)`, 'Snippet JS copié')}>
                        <Copy className="h-3.5 w-3.5" /> Copier le snippet JavaScript
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Paramètres généraux */}
                <Card className="border-border/70 bg-card/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Paramètres</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Nom</Label>
                        <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Limite (appels / minute)</Label>
                        <Input
                          type="number"
                          min={0}
                          value={draft.config.rateLimitPerMin}
                          onChange={(e) => setDraft({ ...draft, config: { ...draft.config, rateLimitPerMin: Number(e.target.value) || 0 } })}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Agent lié</Label>
                        <select
                          value={draft.agentId}
                          onChange={(e) => setDraft({ ...draft, agentId: e.target.value })}
                          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
                        >
                          <option value="">Aucun (NEXUS direct)</option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Schéma lié</Label>
                        <select
                          value={draft.blueprintId}
                          onChange={(e) => setDraft({ ...draft, blueprintId: e.target.value })}
                          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
                        >
                          <option value="">Aucun (celui de l&apos;agent)</option>
                          {blueprints.map((b) => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Origines autorisées (CORS) — une par ligne, vide = toutes</Label>
                      <Textarea
                        value={(draft.config.allowedOrigins ?? []).join('\n')}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            config: { ...draft.config, allowedOrigins: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) },
                          })
                        }
                        placeholder={'https://boutique-client.fr\nhttps://www.boutique-client.fr'}
                        className="min-h-[60px] text-xs"
                      />
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <Toggle
                        label="Clé active"
                        checked={draft.enabled}
                        onChange={(v) => setDraft({ ...draft, enabled: v })}
                      />
                      <Toggle
                        label="Utiliser l'agent lié"
                        checked={Boolean(draft.config.useAgent)}
                        onChange={(v) => setDraft({ ...draft, config: { ...draft.config, useAgent: v } })}
                      />
                      <Toggle
                        label="Règles strictes"
                        hint="Ne répondre QUE les règles"
                        checked={Boolean(draft.config.strictRulesOnly)}
                        onChange={(v) => setDraft({ ...draft, config: { ...draft.config, strictRulesOnly: v } })}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Prompt système du chatbot</Label>
                      <Textarea
                        value={draft.config.systemPrompt}
                        onChange={(e) => setDraft({ ...draft, config: { ...draft.config, systemPrompt: e.target.value } })}
                        placeholder="Ex. : Tu es l'assistant SAV de Dépann'PC. Tu réponds en français, en 3 phrases maximum, toujours avec une question de suivi."
                        className="min-h-[80px] text-xs"
                      />
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Message d&apos;accueil</Label>
                        <Input
                          value={draft.config.welcomeMessage}
                          onChange={(e) => setDraft({ ...draft, config: { ...draft.config, welcomeMessage: e.target.value } })}
                          placeholder="Bonjour, comment puis-je vous aider ?"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Réponse de repli</Label>
                        <Input
                          value={draft.config.fallbackMessage}
                          onChange={(e) => setDraft({ ...draft, config: { ...draft.config, fallbackMessage: e.target.value } })}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Règles */}
                <Card className="border-border/70 bg-card/60">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Zap className="h-4 w-4 text-amber-400" /> Règles de réponse
                      </CardTitle>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            config: {
                              ...draft.config,
                              rules: [
                                ...draft.config.rules,
                                { id: `r${Date.now().toString(36)}`, match: '', mode: 'contains', reply: '' },
                              ],
                            },
                          })
                        }
                        className="gap-1.5"
                      >
                        <Plus className="h-3.5 w-3.5" /> Ajouter
                      </Button>
                    </div>
                    <CardDescription className="text-xs">
                      « Quand tu lis … réponds … » — évaluées de haut en bas, la première qui correspond gagne.
                      La réponse est alors <strong>exactement</strong> celle que vous avez écrite.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {draft.config.rules.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border/70 p-6 text-center text-xs text-muted-foreground">
                        Aucune règle. Sans règle, le chatbot répond avec son schéma (blueprint) puis le cerveau NEXUS.
                      </p>
                    ) : (
                      draft.config.rules.map((rule, i) => (
                        <RuleRow
                          key={rule.id ?? i}
                          rule={rule}
                          index={i}
                          onChange={(next) =>
                            setDraft({
                              ...draft,
                              config: { ...draft.config, rules: draft.config.rules.map((r, j) => (j === i ? next : r)) },
                            })
                          }
                          onRemove={() =>
                            setDraft({
                              ...draft,
                              config: { ...draft.config, rules: draft.config.rules.filter((_, j) => j !== i) },
                            })
                          }
                        />
                      ))
                    )}
                  </CardContent>
                </Card>

                <div className="flex flex-wrap justify-end gap-2">
                  {selected.config?.expiresAt ? (
                    <div className="mr-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>
                        {Date.parse(selected.config.expiresAt) <= Date.now()
                          ? 'Clé expirée — elle ne répond plus.'
                          : `Expire le ${new Date(selected.config.expiresAt).toLocaleDateString('fr-FR')}`}
                      </span>
                      {PERSONAL_KEY_POLICY.lifetimesDays.map((d) => (
                        <Button key={d} size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => renewKey(selected.id, d)}>
                          <RotateCw className="h-3 w-3" /> Renouveler {d} j
                        </Button>
                      ))}
                    </div>
                  ) : null}
                  <Button variant="ghost" onClick={() => removeKey(selected.id)} className="gap-1.5 text-rose-300">
                    <Trash2 className="h-4 w-4" /> Supprimer la clé
                  </Button>
                  <Button onClick={saveKey} disabled={saving} className="gap-2 bg-neutral-500 hover:bg-neutral-500">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Enregistrer
                  </Button>
                </div>

                {/* Test en direct */}
                <Card className="border-border/70 bg-card/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Play className="h-4 w-4 text-neutral-400" /> Tester cette clé
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Exactement l&apos;appel que fera le site de votre client.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Input
                        value={testMessage}
                        onChange={(e) => setTestMessage(e.target.value)}
                        placeholder="Message du visiteur…"
                        className="min-w-[220px] flex-1"
                      />
                      <Button onClick={testKey} disabled={testing} className="gap-2 bg-neutral-600 hover:bg-neutral-500">
                        {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        Envoyer
                      </Button>
                    </div>
                    {testOut && (
                      <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span className="rounded-full bg-neutral-500/15 px-2 py-0.5 text-neutral-300">
                            source : {testOut.source}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">{testOut.ms} ms</span>
                          {testOut.matched && (
                            <span className="rounded-full bg-neutral-300/15 px-2 py-0.5 text-amber-200">
                              règle : « {testOut.matched} »
                            </span>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{testOut.reply}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Journal */}
                <Card className="border-border/70 bg-card/60">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Activity className="h-4 w-4 text-neutral-400" /> Derniers appels
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {logs.length === 0 ? (
                      <p className="py-4 text-center text-xs text-muted-foreground">Aucun appel enregistré.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {logs.map((l) => (
                          <div key={l.id} className="rounded-lg border border-border/60 bg-muted/20 p-2 text-[11px]">
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <span className={cn('h-1.5 w-1.5 rounded-full', l.ok ? 'bg-neutral-400' : 'bg-amber-400')} />
                              <span>{new Date(l.at).toLocaleString('fr-FR')}</span>
                              <span>· {l.ms} ms</span>
                            </div>
                            <p className="mt-1 truncate text-foreground/90">↗ {l.message}</p>
                            <p className="truncate text-muted-foreground">↘ {l.reply}</p>
                          </div>
                        ))}
                        <Button size="sm" variant="ghost" onClick={() => void load()} className="gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5" /> Rafraîchir
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-foreground">{label}</p>
        {hint && <p className="truncate text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function RuleRow({ rule, index, onChange, onRemove }: { rule: ReplyRule; index: number; onChange: (r: ReplyRule) => void; onRemove: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Règle {index + 1}</span>
        <button onClick={onRemove} className="rounded p-1 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300" title="Supprimer">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_150px]">
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Quand le visiteur écrit…</Label>
          <Textarea
            value={rule.match}
            onChange={(e) => onChange({ ...rule, match: e.target.value })}
            className="min-h-[52px] text-xs"
            placeholder="Pourquoi mon ordinateur ne fonctionne pas"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] text-muted-foreground">Correspondance</Label>
          <select
            value={rule.mode}
            onChange={(e) => onChange({ ...rule, mode: e.target.value as ReplyRule['mode'] })}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
          >
            {MATCH_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 pt-1 text-[10px] text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(rule.caseSensitive)}
              onChange={(e) => onChange({ ...rule, caseSensitive: e.target.checked })}
              className="h-3 w-3"
            />
            Sensible à la casse
          </label>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">…réponds exactement</Label>
        <Textarea
          value={rule.reply}
          onChange={(e) => onChange({ ...rule, reply: e.target.value })}
          className="min-h-[60px] text-xs"
          placeholder="Cela doit probablement être dû à la carte mère."
        />
      </div>
      <p className="flex items-center gap-1 text-[10px] text-neutral-300/80">
        <Check className="h-3 w-3" /> Réponse garantie à l&apos;identique, sans passage par le cerveau.
      </p>
    </div>
  )
}
