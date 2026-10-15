'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  CircleDot,
  GripVertical,
  Loader2,
  Play,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { uid } from '@/lib/store'
import {
  BLUEPRINT_NODE_SPECS,
  nodeSpec,
  type BlueprintEdge,
  type BlueprintGraph,
  type BlueprintNode,
  type BlueprintNodeType,
  type BlueprintSummary,
} from '@/lib/nexus-types'
import { cn } from '@/lib/utils'

const GRID = 20
const CANVAS_W = 2600
const CANVAS_H = 1700
const NODE_W = 240

interface Props {
  blueprint: BlueprintSummary | null
  agentId?: string
  agentName?: string
  onClose: () => void
  onSaved: (bp: BlueprintSummary) => void
}

/** Schéma de départ : l'exemple exact du cahier des charges. */
function starterGraph(): BlueprintGraph {
  const start: BlueprintNode = {
    id: uid(), type: 'start', x: 80, y: 300, title: 'Départ',
    config: { greeting: '' },
  }
  const rule: BlueprintNode = {
    id: uid(), type: 'rule', x: 400, y: 180, title: 'Règle SAV',
    config: {
      match: 'Pourquoi mon ordinateur ne fonctionne pas',
      mode: 'contains',
      reply: 'Cela doit probablement être dû à la carte mère.',
    },
  }
  const brain: BlueprintNode = {
    id: uid(), type: 'brain', x: 400, y: 470, title: 'Cerveau NEXUS',
    config: {
      instruction: "Réponds en technicien SAV : diagnostic en 3 étapes maximum, puis une question.",
      variable: 'reponse',
      useHistory: 'true',
    },
  }
  const reply: BlueprintNode = {
    id: uid(), type: 'reply', x: 760, y: 470, title: 'Réponse',
    config: { text: '{{reponse}}' },
  }
  const edges: BlueprintEdge[] = [
    { id: uid(), from: start.id, fromPort: 'out', to: rule.id },
    { id: uid(), from: rule.id, fromPort: 'nomatch', to: brain.id },
    { id: uid(), from: brain.id, fromPort: 'out', to: reply.id },
  ]
  return { nodes: [start, rule, brain, reply], edges }
}

interface PortRef { nodeId: string; port: string }

export function BlueprintEditor({ blueprint, agentId, agentName, onClose, onSaved }: Props) {
  const [name, setName] = useState(blueprint?.name ?? (agentName ? `Schéma de ${agentName}` : 'Mon schéma'))
  const [description, setDescription] = useState(blueprint?.description ?? '')
  const [enabled, setEnabled] = useState(blueprint?.enabled ?? true)
  const [graph, setGraph] = useState<BlueprintGraph>(() =>
    blueprint && blueprint.graph.nodes.length > 0 ? blueprint.graph : starterGraph()
  )
  const [selected, setSelected] = useState<string | null>(graph.nodes[0]?.id ?? null)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [linking, setLinking] = useState<PortRef | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState('Pourquoi mon ordinateur ne fonctionne pas')
  const [testResult, setTestResult] = useState<{
    reply: string
    steps: { label: string; detail: string; status: string }[]
    matchedRule: string | null
    vars: Record<string, string>
  } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  // ── Glisser-déposer des nœuds ─────────────────────────────────────────────
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const p = toCanvas(e.clientX, e.clientY)
      const x = Math.max(0, Math.round((p.x - drag.dx) / GRID) * GRID)
      const y = Math.max(0, Math.round((p.y - drag.dy) / GRID) * GRID)
      setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === drag.id ? { ...n, x, y } : n)) }))
    }
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, toCanvas])

  // ── Traçage d'un lien ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!linking) return
    const move = (e: PointerEvent) => setPointer(toCanvas(e.clientX, e.clientY))
    const up = () => {
      setLinking(null)
      setPointer(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [linking, toCanvas])

  const nodeById = useMemo(() => {
    const map = new Map<string, BlueprintNode>()
    for (const n of graph.nodes) map.set(n.id, n)
    return map
  }, [graph.nodes])

  const addNode = (type: BlueprintNodeType) => {
    const spec = nodeSpec(type)
    // On place le nouveau nœud à droite du nœud sélectionné (ou dans une zone libre)
    const base = selected ? nodeById.get(selected) : undefined
    let x = base ? base.x + 320 : 120
    let y = base ? base.y : 120
    while (graph.nodes.some((n) => Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 60)) y += 90
    const node: BlueprintNode = {
      id: uid(),
      type,
      x: Math.min(x, CANVAS_W - NODE_W - 20),
      y: Math.min(y, CANVAS_H - 140),
      title: spec.label,
      config: defaultConfigFor(type),
    }
    // Relie automatiquement le nœud sélectionné au nouveau (port compatible)
    const edges = [...graph.edges]
    if (base) {
      const port = spec.type === 'rule' ? 'nomatch' : nodeSpec(base.type).ports[0]?.id ?? 'out'
      edges.push({ id: uid(), from: base.id, fromPort: port, to: node.id })
    }
    setGraph({ nodes: [...graph.nodes, node], edges })
    setSelected(node.id)
    setSelectedEdge(null)
  }

  const updateNode = (id: string, patch: Partial<BlueprintNode>) => {
    setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))
  }

  const deleteNode = (id: string) => {
    setGraph((g) => ({
      nodes: g.nodes.filter((n) => n.id !== id),
      edges: g.edges.filter((e) => e.from !== id && e.to !== id),
    }))
    setSelected(null)
  }

  const deleteEdge = (id: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== id) }))
    setSelectedEdge(null)
  }

  const completeLink = (toId: string) => {
    if (!linking || linking.nodeId === toId) return
    const exists = graph.edges.some((e) => e.from === linking.nodeId && e.fromPort === linking.port && e.to === toId)
    if (exists) return
    setGraph((g) => ({
      ...g,
      // Un seul lien par port de sortie (sauf 'nomatch'/'error' qui peuvent se cumuler)
      edges: [
        ...g.edges.filter((e) => !(e.from === linking.nodeId && e.fromPort === linking.port)),
        { id: uid(), from: linking.nodeId, fromPort: linking.port, to: toId },
      ],
    }))
    setLinking(null)
    setPointer(null)
  }

  const autoLayout = () => {
    // Organisation en colonnes par profondeur depuis le nœud de départ
    const start = graph.nodes.find((n) => n.type === 'start') ?? graph.nodes[0]
    if (!start) return
    const depth = new Map<string, number>([[start.id, 0]])
    const queue = [start.id]
    while (queue.length > 0) {
      const id = queue.shift() as string
      for (const e of graph.edges.filter((e) => e.from === id)) {
        if (!depth.has(e.to)) {
          depth.set(e.to, (depth.get(id) ?? 0) + 1)
          queue.push(e.to)
        }
      }
    }
    const perCol = new Map<number, number>()
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) => {
        const d = depth.get(n.id) ?? 1
        const row = perCol.get(d) ?? 0
        perCol.set(d, row + 1)
        return { ...n, x: 80 + d * 300, y: 120 + row * 200 }
      }),
    }))
  }

  const save = async () => {
    if (graph.nodes.length === 0) return toast.error('Le schéma est vide.')
    setSaving(true)
    try {
      const payload = { name, description, agentId: agentId ?? '', graph, enabled }
      const res = await fetch(blueprint ? '/api/blueprints' : '/api/blueprints', {
        method: blueprint ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blueprint ? { id: blueprint.id, ...payload } : payload),
      })
      const data = (await res.json()) as { blueprint?: BlueprintSummary; error?: string }
      if (!res.ok || !data.blueprint) throw new Error(data.error ?? 'Enregistrement impossible')
      // Garde le graphe local (le serveur renvoie la version normalisée)
      setGraph(data.blueprint.graph)
      onSaved(data.blueprint)
      toast.success('Schéma enregistré')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  const runTest = async () => {
    if (!testMessage.trim()) return toast.error('Écrivez un message à tester.')
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/blueprints/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graph, message: testMessage }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        reply?: string
        steps?: { label: string; detail: string; status: string }[]
        matchedRule?: string | null
        vars?: Record<string, string>
      }
      if (!res.ok) throw new Error(data.error ?? 'Test impossible')
      setTestResult({
        reply: data.reply ?? '',
        steps: data.steps ?? [],
        matchedRule: data.matchedRule ?? null,
        vars: data.vars ?? {},
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test impossible')
    } finally {
      setTesting(false)
    }
  }

  const selectedNode = selected ? nodeById.get(selected) : null
  const spec = selectedNode ? nodeSpec(selectedNode.type) : null

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 bg-card/60 px-4 py-2.5">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Retour
        </Button>
        <Separator orientation="vertical" className="h-6" />
        <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-56" placeholder="Nom du schéma" />
        {agentName && (
          <span className="rounded-full border border-neutral-500/30 bg-neutral-500/10 px-2.5 py-1 text-[11px] text-neutral-300">
            Agent : {agentName}
          </span>
        )}
        <div className="flex items-center gap-2">
          <Switch checked={enabled} onCheckedChange={setEnabled} id="bp-enabled" />
          <Label htmlFor="bp-enabled" className="text-xs text-muted-foreground">
            Actif
          </Label>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={autoLayout} className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> Réorganiser
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5 bg-neutral-500 hover:bg-neutral-500">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Enregistrer
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Palette */}
        <aside className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border/70 bg-card/40 p-3 lg:flex">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Ajouter</p>
          {BLUEPRINT_NODE_SPECS.map((s) => (
            <button
              key={s.type}
              onClick={() => addNode(s.type)}
              className="flex items-center gap-2 rounded-lg border border-transparent px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/60 hover:text-foreground"
              title={s.hint}
            >
              <span>{s.emoji}</span>
              <span className="flex-1">{s.label}</span>
              <Plus className="h-3 w-3 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
          <Separator className="my-2" />
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Glissez un nœud pour le déplacer. Tirez un point <CircleDot className="inline h-3 w-3" /> vers un autre
            nœud pour les relier.
          </p>
        </aside>

        {/* Canvas */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.18)_1px,transparent_0)] [background-size:20px_20px]">
          <div
            ref={canvasRef}
            className="relative"
            style={{ width: CANVAS_W, height: CANVAS_H, minHeight: '100%' }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) {
                setSelected(null)
                setSelectedEdge(null)
              }
            }}
          >
            {/* Liens */}
            <svg className="pointer-events-none absolute inset-0" width={CANVAS_W} height={CANVAS_H}>
              {graph.edges.map((edge) => {
                const a = nodeById.get(edge.from)
                const b = nodeById.get(edge.to)
                if (!a || !b) return null
                const ports = nodeSpec(a.type).ports
                const idx = Math.max(0, ports.findIndex((p) => p.id === edge.fromPort))
                const x1 = a.x + NODE_W
                const y1 = a.y + 46 + idx * 24
                const x2 = b.x
                const y2 = b.y + 46
                const mx = (x1 + x2) / 2
                const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
                const isSel = selectedEdge === edge.id
                return (
                  <g key={edge.id}>
                    <path d={d} fill="none" stroke={isSel ? '#f87171' : '#7c6cf0'} strokeWidth={isSel ? 3 : 2} opacity={0.9} />
                    <circle
                      cx={mx}
                      cy={(y1 + y2) / 2}
                      r={9}
                      fill={isSel ? '#f87171' : '#1e1b34'}
                      stroke="#7c6cf0"
                      strokeWidth={2}
                      className="pointer-events-auto cursor-pointer"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setSelectedEdge(edge.id)
                        setSelected(null)
                      }}
                    />
                    <text x={mx} y={(y1 + y2) / 2 + 3.5} textAnchor="middle" fontSize={9} fill="#fff" className="pointer-events-none select-none">
                      {isSel ? '✕' : ''}
                    </text>
                  </g>
                )
              })}
              {linking && pointer && (() => {
                const a = nodeById.get(linking.nodeId)
                if (!a) return null
                const ports = nodeSpec(a.type).ports
                const idx = Math.max(0, ports.findIndex((p) => p.id === linking.port))
                const x1 = a.x + NODE_W
                const y1 = a.y + 46 + idx * 24
                return (
                  <path
                    d={`M ${x1} ${y1} L ${pointer.x} ${pointer.y}`}
                    stroke="#ffffff"
                    strokeWidth={2}
                    strokeDasharray="6 5"
                    fill="none"
                  />
                )
              })()}
            </svg>

            {/* Nœuds */}
            {graph.nodes.map((node) => {
              const s = nodeSpec(node.type)
              const isSel = selected === node.id
              return (
                <div
                  key={node.id}
                  className={cn(
                    'absolute select-none rounded-xl border bg-card shadow-lg transition-shadow',
                    isSel ? 'border-neutral-400 ring-2 ring-neutral-500/40' : 'border-border/80'
                  )}
                  style={{ left: node.x, top: node.y, width: NODE_W }}
                  onPointerDown={() => {
                    if (!linking) setSelected(node.id)
                  }}
                  onPointerUp={() => {
                    if (linking) completeLink(node.id)
                  }}
                >
                  <div
                    className="flex cursor-grab items-center gap-2 rounded-t-xl border-b border-border/70 px-2.5 py-2 active:cursor-grabbing"
                    style={{ background: `linear-gradient(90deg, ${s.color}22, transparent)` }}
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      const p = toCanvas(e.clientX, e.clientY)
                      setDrag({ id: node.id, dx: p.x - node.x, dy: p.y - node.y })
                      setSelected(node.id)
                    }}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-muted-foreground/70" />
                    <span>{s.emoji}</span>
                    <input
                      value={node.title}
                      onChange={(e) => updateNode(node.id, { title: e.target.value.slice(0, 40) })}
                      className="min-w-0 flex-1 bg-transparent text-xs font-semibold text-foreground outline-none"
                      onPointerDown={(e) => e.stopPropagation()}
                    />
                    <button
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => deleteNode(node.id)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-rose-500/20 hover:text-rose-300"
                      title="Supprimer le nœud"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="px-2.5 py-2">
                    <p className="line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">{summarize(node)}</p>
                  </div>

                  {/* Ports de sortie */}
                  {s.ports.map((port, i) => (
                    <div
                      key={port.id}
                      className="absolute flex items-center gap-1"
                      style={{ left: NODE_W - 8, top: 46 + i * 24 - 6 }}
                    >
                      <span className="absolute left-[-46px] whitespace-nowrap text-[9px] text-muted-foreground">
                        {s.ports.length > 1 ? port.label : ''}
                      </span>
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          setLinking({ nodeId: node.id, port: port.id })
                          setPointer(toCanvas(e.clientX, e.clientY))
                        }}
                        className="h-3.5 w-3.5 rounded-full border-2 border-neutral-400 bg-background hover:scale-125"
                        title={`Relier : ${port.label}`}
                      />
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>

        {/* Inspecteur */}
        <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border/70 bg-card/40">
          {selectedNode && spec ? (
            <div className="space-y-3 p-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">{spec.emoji}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{spec.label}</p>
                  <p className="text-[10px] leading-tight text-muted-foreground">{spec.hint}</p>
                </div>
              </div>
              <Separator />
              {spec.fields.map((field) => {
                const value = String(selectedNode.config?.[field.key] ?? '')
                if (field.kind === 'select') {
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-[11px]">{field.label}</Label>
                      <select
                        value={value || (field.options?.[0] ?? '')}
                        onChange={(e) => updateNode(selectedNode.id, { config: { ...selectedNode.config, [field.key]: e.target.value } })}
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none"
                      >
                        {(field.options ?? []).map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                }
                if (field.kind === 'textarea') {
                  return (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-[11px]">{field.label}</Label>
                      <Textarea
                        value={value}
                        onChange={(e) => updateNode(selectedNode.id, { config: { ...selectedNode.config, [field.key]: e.target.value } })}
                        placeholder={field.placeholder}
                        className="min-h-[80px] text-xs"
                      />
                    </div>
                  )
                }
                return (
                  <div key={field.key} className="space-y-1">
                    <Label className="text-[11px]">{field.label}</Label>
                    <Input
                      type={field.kind === 'number' ? 'number' : 'text'}
                      value={value}
                      onChange={(e) => updateNode(selectedNode.id, { config: { ...selectedNode.config, [field.key]: e.target.value } })}
                      placeholder={field.placeholder}
                      className="h-8 text-xs"
                    />
                  </div>
                )
              })}
              <Separator />
              <Button variant="destructive" size="sm" onClick={() => deleteNode(selectedNode.id)} className="w-full gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Supprimer le nœud
              </Button>
            </div>
          ) : selectedEdge ? (
            <div className="space-y-3 p-3">
              <p className="text-sm font-semibold text-foreground">Lien sélectionné</p>
              <Button variant="destructive" size="sm" onClick={() => deleteEdge(selectedEdge)} className="w-full gap-1.5">
                <Trash2 className="h-3.5 w-3.5" /> Supprimer le lien
              </Button>
            </div>
          ) : (
            <div className="space-y-3 p-3">
              <p className="text-sm font-semibold text-foreground">Testeur</p>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Sélectionnez un nœud pour le régler, ou testez tout de suite le schéma avec un message.
              </p>
              <Textarea
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="min-h-[70px] text-xs"
                placeholder="Message du visiteur…"
              />
              <Button size="sm" onClick={runTest} disabled={testing} className="w-full gap-1.5 bg-neutral-600 hover:bg-neutral-500">
                {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Tester le schéma
              </Button>
              {testResult && (
                <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Parcours</p>
                  <ol className="space-y-1">
                    {testResult.steps.map((s, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[11px]">
                        <span
                          className={cn(
                            'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
                            s.status === 'error' ? 'bg-rose-400' : s.status === 'running' ? 'bg-amber-400' : 'bg-neutral-400'
                          )}
                        />
                        <span className="text-foreground/90">
                          <strong>{s.label}</strong> — {s.detail}
                        </span>
                      </li>
                    ))}
                  </ol>
                  {testResult.matchedRule && (
                    <p className="rounded-lg bg-neutral-300/10 px-2 py-1 text-[10px] text-amber-200">
                      Règle déclenchée : « {testResult.matchedRule} »
                    </p>
                  )}
                  <Separator />
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground">{testResult.reply || '_(aucune réponse)_'}</p>
                </div>
              )}
              <Separator />
              <div className="space-y-1.5">
                <Label className="text-[11px]">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[60px] text-xs"
                  placeholder="À quoi sert ce schéma ?"
                />
              </div>
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-neutral-400" />
                Astuce : un nœud <strong>Règle</strong> sans lien de sortie répond directement — c&apos;est le
                « quand tu lis X, réponds Y ».
              </p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** Configuration par défaut d'un nœud fraîchement ajouté. */
function defaultConfigFor(type: BlueprintNodeType): Record<string, unknown> {
  switch (type) {
    case 'start':
      return { greeting: '' }
    case 'rule':
      return { match: '', mode: 'contains', reply: '' }
    case 'condition':
      return { left: 'message', operator: 'contains', value: '', variable: '' }
    case 'brain':
      return { instruction: '', variable: 'reponse', useHistory: 'true' }
    case 'knowledge':
      return { query: '', variable: 'connaissances', max: '3' }
    case 'tool':
      return { tool: 'web_search', argument: '', variable: 'donnees' }
    case 'variable':
      return { name: 'mavariable', value: '{{message}}' }
    case 'webhook':
      return { url: '', method: 'POST', body: '{"message":"{{message}}"}', variable: 'api', timeoutMs: '8000' }
    case 'reply':
      return { text: '{{reponse}}' }
    case 'watch':
      return { url: '', keyword: '', variable: 'veille' }
    case 'notify':
      return { title: 'NEXUS', body: '{{veille}}', channel: 'inapp' }
    case 'end':
      return { text: '' }
    default:
      return {}
  }
}

/** Résumé affiché sous le titre d'un nœud. */
function summarize(node: BlueprintNode): string {
  const c = node.config ?? {}
  switch (node.type) {
    case 'rule':
      return `Si « ${String(c.match ?? '').slice(0, 40) || '…'} » → ${String(c.reply ?? '').slice(0, 60) || '…'}`
    case 'condition':
      return `${c.left === 'variable' ? c.variable : 'message'} ${c.operator} « ${String(c.value ?? '')} »`
    case 'brain':
      return String(c.instruction ?? 'Réponse du cerveau local')
    case 'knowledge':
      return `Recherche : ${String(c.query ?? '(le message)')}`
    case 'tool':
      return `${String(c.tool ?? '')} · ${String(c.argument ?? '(le message)')} → ${String(c.variable ?? '')}`
    case 'variable':
      return `${String(c.name ?? '')} = ${String(c.value ?? '').slice(0, 50)}`
    case 'webhook':
      return `${String(c.method ?? 'POST')} ${String(c.url ?? '').slice(0, 40)}`
    case 'reply':
      return String(c.text ?? '').slice(0, 90) || '(vide)'
    case 'watch':
      return `${String(c.url ?? '(adresse à définir)').slice(0, 50)}${c.keyword ? ` · guette « ${String(c.keyword)} »` : ''}`
    case 'notify':
      return `${String(c.channel ?? 'inapp') === 'inapp' ? 'Notification' : String(c.channel) === 'email' ? 'E-mail' : 'Notification + e-mail'} · ${String(c.title ?? '').slice(0, 40)}`
    case 'start':
      return String(c.greeting ?? 'Réception du message')
    default:
      return String(c.text ?? '')
  }
}
