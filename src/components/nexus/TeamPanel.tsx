'use client'

import { memo, useCallback, useEffect, useState } from 'react'
import {
  Check,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  Users,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  ROLE_LABELS,
  type AgentRole,
  type NexusAgent,
  type NexusAgentGroup,
} from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

const ROLES: { value: AgentRole; label: string; hint: string }[] = [
  { value: 'chercheur', label: '🔎 Chercheur', hint: 'Cherche des sources (Google, YouTube, TikTok)' },
  { value: 'analyste', label: '🧠 Analyste', hint: 'Comprend, extrait et retient les points clés' },
  { value: 'redacteur', label: '✍️ Rédacteur', hint: 'Rédige la synthèse finale de la mission' },
  { value: 'codeur', label: '💻 Codeur', hint: 'ACCÈS LIMITÉ : éditeur de code + studio 3D + navigateur uniquement (pas d\'images, pas de missions)' },
  { value: 'specialiste', label: '🛠️ Spécialiste', hint: 'Coup de main polyvalent sur tous les fronts' },
]

/** L'armée de codeurs prête à recruter en un clic (spécialisation Codage). */
const CODER_ARMY = [
  {
    name: 'Bit',
    emoji: '💠',
    color: '#38bdf8',
    prompt:
      "Tu es Bit, codeur Luau/Roblox ultra-rapide. Tu écris du code Luau propre et commenté en français, optimisé pour Roblox Studio (services, events, DataStore). Tu vas droit au but : d'abord le code complet, ensuite 2 lignes d'explication maximum.",
  },
  {
    name: 'Script',
    emoji: '📜',
    color: '#34d399',
    prompt:
      "Tu es Script, expert Python et automatisation. Tu écris des scripts clairs et robustes : gestion d'erreurs, commentaires en français, exemples d'utilisation. Tu proposes toujours une version simple et une version améliorée.",
  },
  {
    name: 'Kernel',
    emoji: '🧬',
    color: '#fbbf24',
    prompt:
      "Tu es Kernel, spécialiste JavaScript/TypeScript et web. Tu codes des composants modernes et performants (ES2023+, DOM propre, sans dépendances inutiles). Tu expliques tes choix techniques en une phrase concise.",
  },
  {
    name: 'Pixel',
    emoji: '🎮',
    color: '#fb7185',
    prompt:
      "Tu es Pixel, débuggeur et optimiseur de code. Tu identifies le bug, tu l'expliques en une phrase, puis tu donnes le code corrigé COMPLET. Tu ne lâches pas un problème tant qu'il n'est pas résolu.",
  },
]

const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#4ade80', '#f97316']

const EMOJIS = ['🤖', '🔎', '🧠', '✍️', '🦾', '🧭', '📡', '🧪', '🎯', '🦉', '🐙', '⚡', '🌟', '🛠️']
const GROUP_EMOJIS = ['👥', '🚀', '🧩', '🎯', '🌍', '🔬', '💡', '🛰️', '🎬', '🎮', '📊', '⚔️']

/**
 * Panneau « Équipe » : l'utilisateur crée ses propres agents (nom, emoji, rôle,
 * PROMPT SYSTÈME personnel, couleur) et les organise en GROUPES qui peuvent
 * ensuite recevoir des discussions entières depuis le sélecteur du chat.
 */
export function TeamPanel({
  open,
  onOpenChange,
  agents,
  onRefresh,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  agents: NexusAgent[]
  onRefresh: () => void
}) {
  const [tab, setTab] = useState<'agents' | 'groupes'>('agents')

  // ── Groupes (chargés en interne) ──────────────────────────────────────────
  const [groups, setGroups] = useState<NexusAgentGroup[]>([])
  const refreshGroups = useCallback(() => {
    fetch('/api/agents/groups')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.groups)) setGroups(data.groups as NexusAgentGroup[])
      })
      .catch(() => {})
  }, [])
  useEffect(() => {
    if (open) refreshGroups()
  }, [open, refreshGroups])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-xl" style={{ scrollbarWidth: 'thin' }}>
        <SheetHeader className="border-b border-border/70 px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-violet-400" />
            Équipe multi-agents
          </SheetTitle>
          <SheetDescription className="text-xs">
            Crée tes propres agents avec leur <strong>prompt personnel</strong>, regroupe-les en
            <strong> équipes</strong>, puis choisis dans le chat avec qui parler : un agent, un
            groupe, tout le monde — ou NEXUS seul.
          </SheetDescription>
          {/* Onglets Agents / Groupes */}
          <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/50 p-1">
            <button
              type="button"
              onClick={() => setTab('agents')}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                tab === 'agents' ? 'bg-violet-500/15 text-violet-300' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              🤖 Agents ({agents.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('groupes')}
              className={cn(
                'rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                tab === 'groupes' ? 'bg-sky-500/15 text-sky-300' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <UsersRound className="mr-1 inline h-3.5 w-3.5" />
              Groupes ({groups.length})
            </button>
          </div>
        </SheetHeader>

        {tab === 'agents' ? (
          <AgentsTab agents={agents} onRefresh={onRefresh} />
        ) : (
          <GroupsTab agents={agents} groups={groups} onRefresh={refreshGroups} />
        )}
      </SheetContent>
    </Sheet>
  )
}

// ── Onglet Agents ─────────────────────────────────────────────────────────────

/**
 * Carte d'agent mémoïsée : taper dans le formulaire ou changer d'onglet ne
 * re-rend PAS les cartes existantes (fluidité du panneau Équipe, même avec
 * une armée d'agents).
 */
const AgentCard = memo(function AgentCard({
  agent,
  onEdit,
  onToggle,
  onRemove,
}: {
  agent: NexusAgent
  onEdit: (agent: NexusAgent) => void
  onToggle: (agent: NexusAgent) => void
  onRemove: (agent: NexusAgent) => void
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-muted/40 p-3.5 transition-opacity',
        !agent.enabled && 'opacity-50'
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
          style={{ backgroundColor: `${agent.color}22`, border: `1px solid ${agent.color}55` }}
        >
          {agent.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
            <span
              className="rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{ borderColor: `${agent.color}55`, backgroundColor: `${agent.color}14`, color: agent.color }}
            >
              {ROLE_LABELS[agent.role]}
            </span>
            {!agent.enabled && (
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                en pause
              </span>
            )}
            {agent.writer && (
              <span className="rounded-full border border-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                ✍️ Rédacteur du Bureau
              </span>
            )}
          </div>
          {agent.description && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{agent.description}</p>
          )}
          {agent.prompt && (
            <p className="mt-1.5 line-clamp-2 rounded-md border border-border/60 bg-background/60 px-2 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground/80">
              ⚙️ {agent.prompt}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onEdit(agent)}
            aria-label={`Modifier ${agent.name}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => onToggle(agent)}
            aria-label={agent.enabled ? `Mettre ${agent.name} en pause` : `Réactiver ${agent.name}`}
          >
            <Power className={cn('h-3.5 w-3.5', agent.enabled && 'text-emerald-400')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
            onClick={() => onRemove(agent)}
            aria-label={`Supprimer ${agent.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  )
})

function AgentsTab({ agents, onRefresh }: { agents: NexusAgent[]; onRefresh: () => void }) {
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Formulaire
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🤖')
  const [role, setRole] = useState<AgentRole>('chercheur')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [writer, setWriter] = useState(false)

  const resetForm = () => {
    setName('')
    setEmoji('🤖')
    setRole('chercheur')
    setDescription('')
    setPrompt('')
    setColor(COLORS[0])
    setWriter(false)
    setEditingId(null)
  }

  const startCreate = () => {
    resetForm()
    setCreating(true)
  }

  const startEdit = useCallback(
    (agent: NexusAgent) => {
      setName(agent.name)
      setEmoji(agent.emoji)
      setRole(agent.role)
      setDescription(agent.description)
      setPrompt(agent.prompt ?? '')
      setColor(agent.color)
      setWriter(Boolean(agent.writer))
      setEditingId(agent.id)
      setCreating(true)
    },
    []
  )

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Donne un nom à ton agent')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/agents', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          name: trimmed,
          emoji,
          role,
          description: description.trim(),
          prompt: prompt.trim(),
          color,
          writer,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible')
      toast.success(editingId ? `Agent « ${trimmed} » mis à jour` : `Agent « ${trimmed} » rejoint l'équipe !`)
      setCreating(false)
      resetForm()
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }

  const toggleEnabled = useCallback(
    async (agent: NexusAgent) => {
      try {
        const res = await fetch('/api/agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: agent.id, enabled: !agent.enabled }),
        })
        if (!res.ok) throw new Error()
        onRefresh()
      } catch {
        toast.error('Action impossible')
      }
    },
    [onRefresh]
  )

  const remove = useCallback(
    async (agent: NexusAgent) => {
      try {
        const res = await fetch(`/api/agents?id=${encodeURIComponent(agent.id)}`, { method: 'DELETE' })
        if (!res.ok) throw new Error('Suppression impossible')
        toast.success(`Agent « ${agent.name} » retiré de l'équipe`)
        onRefresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Suppression impossible')
      }
    },
    [onRefresh]
  )

  /** Recrue en un clic : 4 codeurs spécialisés + le groupe « Armée de codeurs ». */
  const createCoderArmy = async () => {
    setBusy(true)
    try {
      // Idempotent : on ne recrée pas un codeur déjà présent (par nom)
      const existingNames = new Set(agents.map((a) => a.name.toLowerCase()))
      const ids: string[] = []
      for (const coder of CODER_ARMY) {
        if (existingNames.has(coder.name.toLowerCase())) continue
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: coder.name,
            emoji: coder.emoji,
            role: 'codeur',
            description: 'Spécialisation Codage : éditeur de code, studio 3D et navigateur uniquement.',
            prompt: coder.prompt,
            color: coder.color,
            specialties: ['code'],
          }),
        })
        const data = await res.json()
        if (res.ok && data?.agent?.id) ids.push(data.agent.id as string)
      }
      // Groupe dédié (les membres existants de même nom sont retrouvés via /api/agents)
      const allRes = await fetch('/api/agents')
      const allData = await allRes.json()
      const allAgents: NexusAgent[] = Array.isArray(allData?.agents) ? allData.agents : []
      const coderIds = allAgents.filter((a) => a.role === 'codeur').map((a) => a.id)
      if (coderIds.length > 0) {
        await fetch('/api/agents/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Armée de codeurs',
            emoji: '⚔️',
            color: '#38bdf8',
            members: coderIds,
          }),
        })
      }
      toast.success(
        ids.length > 0
          ? `⚔️ ${ids.length} codeur${ids.length > 1 ? 's' : ''} recruté${ids.length > 1 ? 's' : ''} — groupe « Armée de codeurs » prêt dans le sélecteur`
          : '⚔️ Armée de codeurs déjà en place — groupe actualisé'
      )
      onRefresh()
    } catch {
      toast.error('Recrutement impossible — réessaie')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* Liste des agents */}
      <div className="flex flex-col gap-2.5 p-4">
        {agents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground/70">
            Équipe vide — recrute ton premier agent ci-dessous.
          </p>
        ) : (
          agents.map((agent) => <AgentCard key={agent.id} agent={agent} onEdit={startEdit} onToggle={toggleEnabled} onRemove={remove} />)
        )}
      </div>

      {/* Formulaire de création / édition d'agent */}
      <div className="mt-auto border-t border-border/70 bg-muted/30 p-4">
        {!creating ? (
          <div className="flex flex-col gap-2">
            <Button className="h-9 w-full gap-1.5 bg-violet-500 text-white hover:bg-violet-600" onClick={startCreate}>
              <Plus className="h-4 w-4" />
              Créer un agent
            </Button>
            <Button variant="outline" className="h-9 w-full gap-1.5 border-sky-500/40 text-sky-300 hover:bg-sky-500/10" onClick={createCoderArmy} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <span>⚔️</span>}
              Recruter une armée de codeurs (4 agents + groupe)
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nom de l&apos;agent
              </label>
              <div className="flex gap-2">
                <div className="relative">
                  <select
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="h-9 w-14 cursor-pointer appearance-none rounded-md border border-border bg-background text-center text-lg"
                    aria-label="Emoji de l'agent"
                  >
                    {EMOJIS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex : Nova, DataMiner, Prof YouTube…"
                  className="h-9 flex-1 border-border bg-background text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rôle dans les missions
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {ROLES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    title={r.hint}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors',
                      role === r.value
                        ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
                        : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent'
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/70">{ROLES.find((r) => r.value === role)?.hint}</p>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                ⚡ Prompt personnel <span className="font-normal normal-case text-muted-foreground">(sa personnalité)</span>
              </label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={3}
                placeholder="ex : Tu es Nova, une experte en IA pleine d'énergie. Tu adores les exemples concrets, tu parles de façon enthousiaste et tu cites toujours des chiffres."
                className="resize-none border-border bg-background font-mono text-xs"
              />
              <p className="mt-1 text-[10px] text-muted-foreground/70">
                Définis qui il est, comment il parle, sa spécialité — il utilisera ce prompt dans les discussions et les missions.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Description <span className="font-normal normal-case">(optionnelle)</span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="ex : Expert des vidéos tech, il cherche des tutos en français…"
                className="resize-none border-border bg-background text-sm"
              />
            </div>

            <button
              type="button"
              onClick={() => setWriter((v) => !v)}
              aria-pressed={writer}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors',
                writer ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-border bg-muted/50 hover:bg-accent'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  writer ? 'border-emerald-400 bg-emerald-500 text-white' : 'border-border'
                )}
              >
                {writer && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className={cn('block text-xs font-semibold', writer ? 'text-emerald-300' : 'text-foreground/80')}>
                  ✍️ Rédacteur du Bureau
                </span>
                <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                  Quand il participe à un Bureau (ou une table ronde), c'est LUI qui reprend les idées des agents et rédige la réponse
                  finale — à la place de NEXUS. Parfait pour un agent « phrases réponses ».
                </span>
              </span>
            </button>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Couleur
              </label>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-transform',
                      color === c ? 'scale-110 border-foreground' : 'border-transparent'
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`Couleur ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="h-9 flex-1 gap-1.5 bg-violet-500 text-white hover:bg-violet-600"
                onClick={submit}
                disabled={busy || !name.trim()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Enregistrer' : 'Recruter'}
              </Button>
              <Button
                variant="outline"
                className="h-9 border-border px-3 text-sm hover:bg-accent"
                onClick={() => {
                  setCreating(false)
                  resetForm()
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

// ── Onglet Groupes ────────────────────────────────────────────────────────────

function GroupsTab({
  agents,
  groups,
  onRefresh,
}: {
  agents: NexusAgent[]
  groups: NexusAgentGroup[]
  onRefresh: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('👥')
  const [color, setColor] = useState(COLORS[0])
  const [members, setMembers] = useState<string[]>([])

  const agentById = new Map(agents.map((a) => [a.id, a]))

  const resetForm = () => {
    setName('')
    setEmoji('👥')
    setColor(COLORS[0])
    setMembers([])
    setEditingId(null)
  }

  const startCreate = () => {
    resetForm()
    setCreating(true)
  }

  const startEdit = (group: NexusAgentGroup) => {
    setName(group.name)
    setEmoji(group.emoji)
    setColor(group.color)
    setMembers(group.members.filter((id) => agentById.has(id)))
    setEditingId(group.id)
    setCreating(true)
  }

  const toggleMember = (id: string) => {
    setMembers((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  const submit = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Donne un nom à ton groupe')
      return
    }
    if (members.length === 0) {
      toast.error('Ajoute au moins un agent au groupe')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/agents/groups', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingId ? { id: editingId } : {}),
          name: trimmed,
          emoji,
          color,
          members,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Enregistrement impossible')
      toast.success(editingId ? `Groupe « ${trimmed} » mis à jour` : `Groupe « ${trimmed} » créé !`)
      setCreating(false)
      resetForm()
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (group: NexusAgentGroup) => {
    try {
      const res = await fetch(`/api/agents/groups?id=${encodeURIComponent(group.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Suppression impossible')
      toast.success(`Groupe « ${group.name} » dissous`)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suppression impossible')
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2.5 p-4">
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground/70">
            Aucun groupe — forme ton équipe ci-dessous : elle apparaîtra dans le sélecteur du chat.
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-border bg-muted/40 p-3.5">
              <div className="flex items-start gap-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg"
                  style={{ backgroundColor: `${group.color}22`, border: `1px solid ${group.color}55` }}
                >
                  {group.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{group.name}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {group.members.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground/70">Groupe vide</span>
                    ) : (
                      group.members.map((id) => {
                        const a = agentById.get(id)
                        if (!a) return null
                        return (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                            style={{ borderColor: `${a.color}55`, backgroundColor: `${a.color}14`, color: a.color }}
                          >
                            {a.emoji} {a.name}
                          </span>
                        )
                      })
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={() => startEdit(group)}
                    aria-label={`Modifier le groupe ${group.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"
                    onClick={() => remove(group)}
                    aria-label={`Supprimer le groupe ${group.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Formulaire de création / édition de groupe */}
      <div className="mt-auto border-t border-border/70 bg-muted/30 p-4">
        {!creating ? (
          <Button className="h-9 w-full gap-1.5 bg-sky-500 text-white hover:bg-sky-600" onClick={startCreate}>
            <Plus className="h-4 w-4" />
            Créer un groupe
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Nom du groupe
              </label>
              <div className="flex gap-2">
                <div className="relative">
                  <select
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="h-9 w-14 cursor-pointer appearance-none rounded-md border border-border bg-background text-center text-lg"
                    aria-label="Emoji du groupe"
                  >
                    {GROUP_EMOJIS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ex : Cellule Recherche IA, Dream Team…"
                  className="h-9 flex-1 border-border bg-background text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Membres <span className="font-normal normal-case">({members.length} sélectionné{members.length > 1 ? 's' : ''})</span>
              </label>
              {agents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-[11px] text-muted-foreground/70">
                  Crée d&apos;abord des agents dans l&apos;onglet « Agents ».
                </p>
              ) : (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border bg-background/60 p-1.5">
                  {agents.map((a) => {
                    const selected = members.includes(a.id)
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleMember(a.id)}
                        className={cn(
                          'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
                          selected ? 'bg-sky-500/10 text-foreground' : 'text-muted-foreground hover:bg-accent'
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                            selected ? 'border-sky-400 bg-sky-500 text-white' : 'border-border'
                          )}
                        >
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="text-base leading-none">{a.emoji}</span>
                        <span className="font-medium text-foreground">{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">{ROLE_LABELS[a.role]}</span>
                        {!a.enabled && <span className="ml-auto text-[9px] text-amber-400">en pause</span>}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Couleur
              </label>
              <div className="flex gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={cn(
                      'h-7 w-7 rounded-full border-2 transition-transform',
                      color === c ? 'scale-110 border-foreground' : 'border-transparent'
                    )}
                    style={{ backgroundColor: c }}
                    aria-label={`Couleur ${c}`}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                className="h-9 flex-1 gap-1.5 bg-sky-500 text-white hover:bg-sky-600"
                onClick={submit}
                disabled={busy || !name.trim()}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? 'Enregistrer' : 'Former le groupe'}
              </Button>
              <Button
                variant="outline"
                className="h-9 border-border px-3 text-sm hover:bg-accent"
                onClick={() => {
                  setCreating(false)
                  resetForm()
                }}
              >
                Annuler
              </Button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
