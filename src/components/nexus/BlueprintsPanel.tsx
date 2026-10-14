'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, LayoutTemplate, Loader2, Pencil, Plus, Power, Trash2, Workflow } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { BlueprintEditor } from '@/components/nexus/BlueprintEditor'
import { useNexusStore } from '@/lib/store'
import { nodeSpec, type BlueprintSummary, type NexusAgent } from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

/**
 * Atelier de Blueprints : on construit soi-même le schéma d'utilisation d'un
 * agent (règles, conditions, cerveau, connaissances, outils, réponses).
 */
export function BlueprintsPanel() {
  const [blueprints, setBlueprints] = useState<BlueprintSummary[]>([])
  const [agents, setAgents] = useState<NexusAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<BlueprintSummary | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAgent, setNewAgent] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [bpRes, agentRes] = await Promise.all([
        fetch('/api/blueprints').then((r) => r.json()),
        fetch('/api/agents').then((r) => r.json()),
      ])
      setBlueprints(Array.isArray(bpRes?.blueprints) ? bpRes.blueprints : [])
      setAgents(Array.isArray(agentRes?.agents) ? agentRes.agents : [])
    } catch {
      toast.error('Chargement impossible')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Arrivée depuis le panneau Équipe (« ⚙️ Schéma ») : on ouvre directement le
  // schéma de l'agent ciblé — et on le crée s'il n'en a pas encore.
  const focusAgent = useNexusStore((s) => s.blueprintAgentFocus)
  const setFocusAgent = useNexusStore((s) => s.setBlueprintAgentFocus)
  useEffect(() => {
    if (!focusAgent || loading) return
    const existing = blueprints.find((b) => b.agentId === focusAgent)
    setFocusAgent(null)
    if (existing) {
      setEditing(existing)
      return
    }
    void (async () => {
      try {
        const res = await fetch('/api/blueprints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Schéma de l\u2019agent', agentId: focusAgent, description: '' }),
        })
        const data = (await res.json()) as { blueprint?: BlueprintSummary; error?: string }
        if (!res.ok || !data.blueprint) throw new Error(data.error ?? 'Création impossible')
        setEditing(data.blueprint)
        await load()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Création impossible')
      }
    })()
     
  }, [focusAgent, loading])

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents])

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/blueprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() || 'Mon schéma', agentId: newAgent, description: '' }),
      })
      const data = (await res.json()) as { blueprint?: BlueprintSummary; error?: string }
      if (!res.ok || !data.blueprint) throw new Error(data.error ?? 'Création impossible')
      setNewName('')
      setNewAgent('')
      setEditing(data.blueprint)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Création impossible')
    } finally {
      setCreating(false)
    }
  }

  const toggle = async (bp: BlueprintSummary) => {
    await fetch('/api/blueprints', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bp.id, enabled: !bp.enabled }),
    })
    await load()
  }

  const remove = async (bp: BlueprintSummary) => {
    if (!confirm(`Supprimer le schéma « ${bp.name} » ?`)) return
    await fetch(`/api/blueprints?id=${encodeURIComponent(bp.id)}`, { method: 'DELETE' })
    toast.success('Schéma supprimé')
    await load()
  }

  const detach = async (bp: BlueprintSummary) => {
    await fetch('/api/blueprints', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: bp.id, agentId: '' }),
    })
    toast.success('Schéma détaché de l\u2019agent')
    await load()
  }

  if (editing) {
    return (
      <BlueprintEditor
        blueprint={editing}
        agentId={editing.agentId}
        agentName={agentById.get(editing.agentId)?.name}
        onClose={() => {
          setEditing(null)
          void load()
        }}
        onSaved={(bp) => setEditing(bp)}
      />
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-neutral-500/20 to-neutral-500/20">
            <Workflow className="h-5 w-5 text-neutral-300" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Blueprints</h1>
            <p className="text-sm text-muted-foreground">
              Construisez vous-même le schéma d&apos;utilisation de vos agents : règles « quand tu lis X, réponds Y »,
              conditions, cerveau local, connaissances, outils et réponses.
            </p>
          </div>
        </div>

        {/* Nouveau schéma */}
        <Card className="border-border/70 bg-card/60">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="h-4 w-4 text-neutral-400" /> Nouveau schéma
            </CardTitle>
            <CardDescription className="text-xs">
              Le schéma démarre avec un exemple concret (une règle SAV + le cerveau NEXUS en repli).
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Nom</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Ex. : Bot SAV informatique"
              />
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <label className="text-[11px] text-muted-foreground">Lier à un agent (optionnel)</label>
              <select
                value={newAgent}
                onChange={(e) => setNewAgent(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none"
              >
                <option value="">Aucun agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={create} disabled={creating} className="gap-2 bg-neutral-500 hover:bg-neutral-500">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <LayoutTemplate className="h-4 w-4" />}
              Créer et ouvrir
            </Button>
          </CardContent>
        </Card>

        <Separator />

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Chargement…
          </div>
        ) : blueprints.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border py-14 text-center">
            <Workflow className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aucun schéma pour l&apos;instant.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Créez-en un ci-dessus : vous dessinerez le parcours exact de votre agent.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {blueprints.map((bp) => {
              const agent = agentById.get(bp.agentId)
              const counts = new Map<string, number>()
              for (const n of bp.graph.nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1)
              return (
                <Card key={bp.id} className={cn('border-border/70 bg-card/60', !bp.enabled && 'opacity-60')}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{bp.name}</CardTitle>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-[10px] font-medium',
                          bp.enabled ? 'bg-neutral-500/15 text-neutral-300' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {bp.enabled ? 'Actif' : 'Inactif'}
                      </span>
                    </div>
                    <CardDescription className="text-xs">
                      {bp.description || `${bp.graph.nodes.length} nœud(s) · ${bp.graph.edges.length} lien(s)`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from(counts.entries()).map(([type, n]) => {
                        const s = nodeSpec(type as never)
                        return (
                          <span
                            key={type}
                            className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {s.emoji} {s.label} ×{n}
                          </span>
                        )
                      })}
                    </div>

                    {agent && (
                      <p className="flex items-center gap-1.5 text-[11px] text-neutral-300">
                        <Bot className="h-3 w-3" /> Branché sur {agent.emoji} {agent.name}
                      </p>
                    )}

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setEditing(bp)} className="gap-1.5">
                        <Pencil className="h-3.5 w-3.5" /> Ouvrir
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => toggle(bp)} className="gap-1.5">
                        <Power className="h-3.5 w-3.5" /> {bp.enabled ? 'Désactiver' : 'Activer'}
                      </Button>
                      {agent && (
                        <Button size="sm" variant="ghost" onClick={() => detach(bp)}>
                          Détacher
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => remove(bp)} className="gap-1.5 text-rose-300">
                        <Trash2 className="h-3.5 w-3.5" /> Supprimer
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
