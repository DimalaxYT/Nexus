'use client'

import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import {
  ArrowUp,
  Bell,
  BellOff,
  BookOpen,
  Boxes,
  Brain,
  Check,
  ChevronDown,
  Code2,
  Download,
  ExternalLink,
  FileCode2,
  Film,
  Globe,
  History,
  Image as ImageIcon,
  Library,
  ListChecks,
  Loader2,
  Plus,
  Search,
  ShieldAlert,
  Square,
  Trash2,
  TriangleAlert,
  User,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { uid, useNexusStore, type BrainActivityItem } from '@/lib/store'
import {
  loadThumbnails,
  makeThumbnail,
  persistThumbnails,
  runtimeImages,
  thumbnailRegistry,
  ROLE_LABELS,
  type AgentEvent,
  type AgentStep,
  type ArtifactImage,
  type BrowsedPage,
  type ChatMessage,
  type ChatTarget,
  type CodeArtifact,
  type DeliberationEntry,
  type MemoryItem,
  type NexusAgent,
  type NexusAgentGroup,
  type NexusTask,
  type SceneSpec,
  type SourceItem,
  type VideoArtifact,
} from '@/lib/nexus-types'
import { Markdown } from '@/components/nexus/Markdown'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { HistoryPanel, KnowledgePanel, MemoryPanel } from '@/components/nexus/AgentPanels'
import { BrowserPanel } from '@/components/nexus/BrowserPanel'
import { MissionsPanel } from '@/components/nexus/MissionsPanel'
import { TeamPanel } from '@/components/nexus/TeamPanel'
import { BrainView } from '@/components/nexus/BrainView'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  { label: 'Veille IA', text: 'Quelles sont les dernières avancées en intelligence artificielle cette semaine ? Fais une synthèse.' },
  { label: 'Image IA', text: 'Génère une image épique : une ville futuriste au coucher du soleil avec des véhicules volants.' },
  { label: 'Vidéo IA', text: 'Génère une vidéo : un vol de drone au-dessus d\u2019une ville néon sous la pluie, style cinématographique.' },
  { label: 'Scène 3D', text: 'Crée une scène 3D : une fusée sur la plateforme de lancement, de nuit, avec projecteurs.' },
  { label: 'Page web', text: 'Crée une page web portfolio pour un photographe avec galerie interactive et formulaire de contact.' },
  { label: 'Script Python', text: 'Écris un script Python qui organise automatiquement les fichiers d\u2019un dossier par extension.' },
]

function StepIcon({ tool }: { tool: AgentStep['tool'] }) {
  if (tool === 'web_search') return <Search className="h-3.5 w-3.5" />
  if (tool === 'generate_image') return <ImageIcon className="h-3.5 w-3.5" />
  if (tool === 'read_webpage') return <ExternalLink className="h-3.5 w-3.5" />
  if (tool === 'generate_webpage') return <Code2 className="h-3.5 w-3.5" />
  if (tool === 'generate_code') return <FileCode2 className="h-3.5 w-3.5" />
  if (tool === 'generate_video') return <Film className="h-3.5 w-3.5" />
  if (tool === 'save_knowledge') return <BookOpen className="h-3.5 w-3.5" />
  if (tool === 'search_knowledge') return <Library className="h-3.5 w-3.5" />
  if (tool === 'update_task') return <ListChecks className="h-3.5 w-3.5" />
  if (tool === 'system') return <ShieldAlert className="h-3.5 w-3.5" />
  return <Boxes className="h-3.5 w-3.5" />
}

function StepsTimeline({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null
  return (
    <div className="mb-3 flex flex-col gap-1.5">
      {steps.map((step) => (
        <div
          key={step.id}
          className={cn(
            'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-xs',
            step.status === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              : 'border-border bg-muted/60 text-foreground/80'
          )}
        >
          {step.status === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-violet-400" />
          ) : step.status === 'error' ? (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-3 w-3 text-emerald-400" />
            </span>
          )}
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-violet-400">
            <StepIcon tool={step.tool} />
          </span>
          <span className="font-medium text-foreground">{step.label}</span>
          <span className="truncate text-muted-foreground">— {step.detail}</span>
        </div>
      ))}
    </div>
  )
}

function ThinkingMenu({ message }: { message: ChatMessage }) {
  const hasContent = message.steps.length > 0 || Boolean(message.thought)
  const speakerName = message.speaker?.name ?? 'NEXUS'
  // Pendant la réflexion : déplié automatiquement ; ensuite replié par défaut.
  // null = l'utilisateur n'a pas encore choisi → on suit l'état pending.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? message.pending
  const toggle = () => setUserOpen(!open)

  if (message.pending && message.content.length === 0) {
    return (
      <div className="mb-3">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
          NEXUS réfléchit…
          {message.steps.length > 0 && (
            <span className="rounded-full bg-violet-500/25 px-1.5 text-[10px] font-semibold text-violet-200">
              {message.steps.length}
            </span>
          )}
          <ChevronDown className={cn('h-3.5 w-3.5 text-violet-300/80 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="mt-2 rounded-xl border border-border bg-muted/40 p-3">
            {message.thought && (
              <p className="mb-2 border-l-2 border-violet-500/50 pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
                « {message.thought} »
              </p>
            )}
            <StepsTimeline steps={message.steps} />
            {!message.thought && message.steps.length === 0 && (
              <p className="text-xs text-muted-foreground/70">Analyse de votre demande…</p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (!hasContent) return null
  return (
    <div className="mb-3">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Brain className="h-3.5 w-3.5 text-violet-400/80" />
        Réflexion de {speakerName}
        {message.steps.length > 0 && (
          <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300">
            {message.steps.length}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-border bg-muted/30 p-3">
          {message.thought && (
            <p className="mb-2 border-l-2 border-violet-500/50 pl-2.5 text-xs italic leading-relaxed text-muted-foreground">
              « {message.thought} »
            </p>
          )}
          <StepsTimeline steps={message.steps} />
        </div>
      )}
    </div>
  )
}

function SourceList({ sources }: { sources: SourceItem[] }) {
  if (sources.length === 0) return null
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Sources ({sources.length})
      </p>
      <ul className="flex flex-col gap-1.5">
        {sources.map((s, i) => (
          <li key={`${s.url}-${i}`}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-baseline gap-1.5 text-xs text-muted-foreground hover:text-violet-300"
            >
              <span className="font-medium text-foreground/80 group-hover:text-violet-300">{s.title}</span>
              <span className="truncate text-muted-foreground/70">{s.domain}</span>
              <ExternalLink className="h-3 w-3 shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ArtifactImages({
  images,
  onOpenInStudio,
}: {
  images: ArtifactImage[]
  onOpenInStudio: (dataUrl: string) => void
}) {
  if (images.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {images.map((img) => {
        const src = img.dataUrl || runtimeImages.get(img.id) || thumbnailRegistry.get(img.id) || ''
        if (!src) {
          return (
            <div
              key={img.id}
              className="flex h-44 w-44 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-muted/50 p-3 text-center"
            >
              <ImageIcon className="h-5 w-5 text-muted-foreground/70" />
              <p className="text-[11px] leading-snug text-muted-foreground">Image expirée après rechargement</p>
              <p className="line-clamp-2 text-[10px] text-muted-foreground/70">{img.prompt}</p>
            </div>
          )
        }
        return (
          <div key={img.id} className="group relative overflow-hidden rounded-xl border border-border">
            <img src={src} alt={img.prompt} className="max-h-72 w-auto max-w-full object-contain" />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => onOpenInStudio(src)}
              >
                <Boxes className="h-3 w-3" />
                Retoucher
              </Button>
              <a
                href={src}
                download={`nexus-image-${img.id}.png`}
                className="inline-flex h-7 items-center gap-1.5 rounded-md bg-secondary px-2 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
              >
                <Download className="h-3 w-3" />
                PNG
              </a>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SceneCard({ scene, onOpen }: { scene: SceneSpec; onOpen: () => void }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/10 p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-rose-500">
        <Boxes className="h-5 w-5 text-white" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{scene.name}</p>
        <p className="text-xs text-muted-foreground">
          Scène 3D prête — {scene.objects.length} objets {scene.ground ? '· sol inclus' : ''}
        </p>
      </div>
      <Button size="sm" className="h-8 gap-1.5 bg-violet-500 text-white hover:bg-violet-600" onClick={onOpen}>
        <ExternalLink className="h-3.5 w-3.5" />
        Studio 3D
      </Button>
    </div>
  )
}

function CodeCard({ code, onOpen }: { code: CodeArtifact; onOpen: () => void }) {
  const isScript = Boolean(code.files.language) && !['web', 'html'].includes(code.files.language ?? '')
  return (
    <div className="mt-3 flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600">
        {isScript ? <FileCode2 className="h-5 w-5 text-white" /> : <Code2 className="h-5 w-5 text-white" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{code.name}</p>
        <p className="text-xs text-muted-foreground">
          {isScript
            ? `Script ${code.files.language} prêt — ${code.files.filename ?? 'fichier'} (éditeur de code)`
            : 'Page web prête — HTML · CSS · JS interactive'}
        </p>
      </div>
      <Button size="sm" className="h-8 shrink-0 gap-1.5 bg-sky-500 text-white hover:bg-sky-600" onClick={onOpen}>
        <ExternalLink className="h-3.5 w-3.5" />
        Studio Code
      </Button>
    </div>
  )
}

function VideoCard({ video, onOpen }: { video: VideoArtifact; onOpen: (url: string) => void }) {
  const isLocal = video.url.startsWith('/')
  const downloadHref = isLocal
    ? `${video.url}${video.url.includes('?') ? '&' : '?'}download=1`
    : `/api/tools/video/download?url=${encodeURIComponent(video.url)}`
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10">
      <video src={video.url} controls preload="metadata" className="max-h-80 w-full bg-black" />
      <div className="flex items-center gap-3 p-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 to-rose-500">
          <Film className="h-4.5 w-4.5 text-white" />
        </span>
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{video.prompt}</p>
        <a
          href={downloadHref}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
        >
          <Download className="h-3.5 w-3.5" />
          MP4
        </a>
        <Button
          size="sm"
          className="h-8 shrink-0 gap-1.5 bg-fuchsia-500 text-white hover:bg-fuchsia-600"
          onClick={() => onOpen(video.url)}
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Studio Vidéo
        </Button>
      </div>
    </div>
  )
}

function MessageBubbleInner({
  message,
  onOpenScene,
  onOpenImage,
  onOpenCode,
  onOpenVideo,
}: {
  message: ChatMessage
  onOpenScene: (s: SceneSpec) => void
  onOpenImage: (dataUrl: string) => void
  onOpenCode: (code: CodeArtifact) => void
  onOpenVideo: (url: string) => void
}) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] flex-col items-end gap-1 sm:max-w-[75%]">
          {message.target && (
            <span className="mr-9 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              → {message.target}
            </span>
          )}
          <div className="flex items-start gap-2.5">
            <div className="rounded-2xl rounded-tr-md bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-2.5 text-sm leading-relaxed text-white shadow-md shadow-violet-500/20">
              {message.content}
            </div>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent">
              <User className="h-3.5 w-3.5 text-foreground/80" />
            </span>
          </div>
        </div>
      </div>
    )
  }
  const speaker = message.speaker ?? null
  // Bulle vide : coquille du premier tour fermée par un changement de speaker
  // (table ronde / agent personnalisé) → on ne l'affiche pas.
  const isEmpty =
    !message.pending &&
    message.content.length === 0 &&
    message.images.length === 0 &&
    message.videos.length === 0 &&
    !message.scene &&
    !message.code &&
    message.sources.length === 0 &&
    message.steps.length === 0 &&
    !message.thought &&
    !(message.deliberation && message.deliberation.length > 0)
  if (isEmpty) return null
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[92%] items-start gap-2.5 sm:max-w-[80%]">
        <span
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={
            speaker
              ? { backgroundColor: `${speaker.color}30`, border: `1px solid ${speaker.color}70` }
              : undefined
          }
        >
          {speaker ? (
            <span className="text-sm leading-none">{speaker.emoji}</span>
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500">
              <Boxes className="h-3.5 w-3.5 text-white" />
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          {speaker && (
            <p className="mb-0.5 text-[11px] font-bold tracking-wide" style={{ color: speaker.color }}>
              {speaker.name.toUpperCase()}
            </p>
          )}
          <ThinkingMenu message={message} />
          {message.deliberation && message.deliberation.length > 0 && (
            <DeliberationPanel entries={message.deliberation} />
          )}
          {message.content.length > 0 && <Markdown content={message.content} />}
          <ArtifactImages images={message.images} onOpenInStudio={onOpenImage} />
          {message.videos.map((v) => (
            <VideoCard key={v.id} video={v} onOpen={onOpenVideo} />
          ))}
          {message.scene && (
            <SceneCard
              scene={message.scene}
              onOpen={() => onOpenScene(message.scene as SceneSpec)}
            />
          )}
          {message.code && (
            <CodeCard code={message.code} onOpen={() => onOpenCode(message.code as CodeArtifact)} />
          )}
          <SourceList sources={message.sources} />
        </div>
      </div>
    </div>
  )
}

// ── BUREAU : panneau « ce qu'ils échangent » — les contributions VERBATIM ─────
// L'utilisateur voit EXACTEMENT ce que chaque agent a dit pendant la
// délibération (texte complet, jamais tronqué), dépliable.
function DeliberationPanel({ entries }: { entries: DeliberationEntry[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-sky-500/30 bg-sky-500/5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sky-500/10"
      >
        <Users className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="text-xs font-semibold text-sky-200">Bureau — ce que l'équipe a échangé</span>
        <span className="rounded-full bg-sky-500/20 px-1.5 text-[10px] font-semibold text-sky-300">
          {entries.length} contribution{entries.length > 1 ? 's' : ''}
        </span>
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 text-sky-300/80 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-sky-500/20 px-3 py-2.5">
          {entries.map((e, i) => (
            <div key={`${e.name}-${i}`} className="rounded-lg border border-border/70 bg-card/70 px-2.5 py-2">
              <p className="mb-1 text-[11px] font-bold tracking-wide" style={{ color: e.color }}>
                {e.emoji} {e.name.toUpperCase()}
              </p>
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/85">{e.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const MessageBubble = memo(MessageBubbleInner)

export function AgentChat() {
  const {
    conversations,
    activeConversationId,
    createConversation,
    setActiveConversation,
    updateConversation,
    deleteConversation,
    hydrateFromServer,
    setView,
    setPendingScene,
    setPendingImage,
    setPendingCode,
    setPendingVideo,
  } = useNexusStore()

  // Code actuel du Studio Code (partagé avec les agents en discussion privée)
  // + enregistreur de proposition (diff à valider dans le Studio Code)
  const codeFiles = useNexusStore((s) => s.codeFiles)
  const setPendingProposal = useNexusStore((s) => s.setPendingProposal)
  // Salle des cerveaux 3D : activité en direct + ouverture du panneau
  const setBrainActivity = useNexusStore((s) => s.setBrainActivity)
  const setBrainActivities = useNexusStore((s) => s.setBrainActivities)
  const idleAllBrains = useNexusStore((s) => s.idleAllBrains)
  const [brainsOpen, setBrainsOpen] = useState(false)

  const active = conversations.find((c) => c.id === activeConversationId) ?? conversations[0] ?? null
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [knowledgeOpen, setKnowledgeOpen] = useState(false)
  const [knowledgeCount, setKnowledgeCount] = useState(0)
  const [notifyOn, setNotifyOn] = useState(false)
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browsedPages, setBrowsedPages] = useState<BrowsedPage[]>([])
  const [missionsOpen, setMissionsOpen] = useState(false)
  const [tasks, setTasks] = useState<NexusTask[]>([])
  const [teamOpen, setTeamOpen] = useState(false)
  const [agents, setAgents] = useState<NexusAgent[]>([])
  const [groups, setGroups] = useState<NexusAgentGroup[]>([])
  // Destinataire de la discussion (sélecteur au-dessus de la saisie), persisté
  const [target, setTarget] = useState<ChatTarget>(() => {
    if (typeof window === 'undefined') return { kind: 'nexus' } as ChatTarget
    try {
      const raw = localStorage.getItem('nexus-chat-target')
      if (raw) return JSON.parse(raw) as ChatTarget
    } catch {
      /* valeur corrompue : défaut */
    }
    return { kind: 'nexus' } as ChatTarget
  })
  const abortRef = useRef<AbortController | null>(null)
  const notifyRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true)

  const refreshMemories = useCallback(() => {
    fetch('/api/memory')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.memories) setMemories(data.memories as MemoryItem[])
      })
      .catch(() => {})
  }, [])

  const refreshKnowledge = useCallback(() => {
    fetch('/api/knowledge')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.items)) setKnowledgeCount(data.items.length as number)
      })
      .catch(() => {})
  }, [])

  const refreshTasks = useCallback(() => {
    fetch('/api/tasks')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.tasks)) setTasks(data.tasks as NexusTask[])
      })
      .catch(() => {})
  }, [])

  const refreshAgents = useCallback(() => {
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.agents)) setAgents(data.agents as NexusAgent[])
      })
      .catch(() => {})
  }, [])

  const refreshGroups = useCallback(() => {
    fetch('/api/agents/groups')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data?.groups)) setGroups(data.groups as NexusAgentGroup[])
      })
      .catch(() => {})
  }, [])

  // Chargement initial : vignettes persistées + historique serveur + mémoire + connaissances + missions + équipe
  useEffect(() => {
    loadThumbnails()
    hydrateFromServer()
    refreshMemories()
    refreshKnowledge()
    refreshTasks()
    refreshAgents()
    refreshGroups()
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('nexus-notify') === '1'
      notifyRef.current = saved
      setNotifyOn(saved)
    }
  }, [hydrateFromServer, refreshMemories, refreshKnowledge, refreshTasks, refreshAgents, refreshGroups])

  // Persiste la cible choisie + se resynchronise à la fermeture du panneau Équipe
  useEffect(() => {
    try {
      localStorage.setItem('nexus-chat-target', JSON.stringify(target))
    } catch {
      /* quota : ignoré */
    }
  }, [target])
  useEffect(() => {
    if (!teamOpen) {
      refreshAgents()
      refreshGroups()
    }
  }, [teamOpen, refreshAgents, refreshGroups])

  // Cible obsolète (agent supprimé / groupe dissous) → retour automatique à NEXUS
  useEffect(() => {
    if (target.kind === 'agent' && !agents.some((a) => a.id === target.agentId)) setTarget({ kind: 'nexus' })
    if (target.kind === 'group' && !groups.some((g) => g.id === target.groupId)) setTarget({ kind: 'nexus' })
    if (target.kind === 'bureau' && target.groupId && !groups.some((g) => g.id === target.groupId)) setTarget({ kind: 'nexus' })
  }, [target, agents, groups])

  // Libellé/icône du destinataire courant
  const targetInfo = useMemo(() => {
    switch (target.kind) {
      case 'all':
        return { icon: '👥', label: `tous les agents (${agents.filter((a) => a.enabled).length}) · table ronde` }
      case 'group': {
        const g = groups.find((x) => x.id === target.groupId)
        return { icon: g?.emoji ?? '👥', label: g ? `groupe ${g.name} · table ronde` : 'Groupe inconnu' }
      }
      case 'bureau': {
        if (target.groupId) {
          const g = groups.find((x) => x.id === target.groupId)
          return { icon: g?.emoji ?? '🏛️', label: g ? `Bureau du groupe ${g.name} — réponse unique` : 'Bureau (groupe inconnu)' }
        }
        return { icon: '🏛️', label: `Bureau — ${agents.filter((a) => a.enabled).length} agents délibèrent, réponse unique` }
      }
      case 'agent': {
        const a = agents.find((x) => x.id === target.agentId)
        return { icon: a?.emoji ?? '🤖', label: a ? a.name : 'Agent inconnu' }
      }
      default:
        return { icon: '🟣', label: 'NEXUS · globale' }
    }
  }, [target, agents, groups])

  // Polling des missions : les exécutions en arrière-plan progressent même
  // panneau fermé (badge + journal en direct)
  useEffect(() => {
    const timer = setInterval(refreshTasks, 8000)
    return () => clearInterval(timer)
  }, [refreshTasks])

  /** Notification navigateur quand l'onglet est en arrière-plan. */
  const pushNotification = useCallback((title: string, body: string) => {
    if (
      !notifyRef.current ||
      typeof Notification === 'undefined' ||
      Notification.permission !== 'granted' ||
      document.visibilityState === 'visible'
    )
      return
    try {
      const n = new Notification(title, { body: body.slice(0, 180), tag: 'nexus-task' })
      n.onclick = () => {
        window.focus()
        n.close()
      }
    } catch {
      /* notifications indisponibles : ignoré */
    }
  }, [])

  const toggleNotify = useCallback(async () => {
    if (notifyRef.current) {
      notifyRef.current = false
      setNotifyOn(false)
      localStorage.setItem('nexus-notify', '0')
      toast.info('Notifications désactivées')
      return
    }
    if (typeof window === 'undefined' || !('Notification' in window)) {
      toast.error('Notifications non supportées par ce navigateur')
      return
    }
    let perm = Notification.permission
    if (perm !== 'granted') {
      try {
        perm = await Notification.requestPermission()
      } catch {
        perm = 'denied'
      }
    }
    if (perm === 'granted') {
      notifyRef.current = true
      setNotifyOn(true)
      localStorage.setItem('nexus-notify', '1')
      toast.success('Notifications activées — vous serez alerté dès qu’une tâche se termine, même en arrière-plan')
    } else {
      toast.error('Permission de notification refusée par le navigateur')
    }
  }, [])

  // Défilement auto vers le bas
  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [active?.messages])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  const patchAssistant = useCallback(
    (convId: string, msgId: string, patch: (m: ChatMessage) => ChatMessage) => {
      updateConversation(convId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === msgId ? patch(m) : m)),
      }))
    },
    [updateConversation]
  )

  const send = useCallback(
    async (rawText: string) => {
      const text = rawText.trim()
      if (!text || streaming) return

      let convId = active?.id
      if (!convId) convId = createConversation()

      const assistantId = uid()
      const targetLabel = target.kind === 'nexus' ? undefined : targetInfo.label
      const userMsg: ChatMessage = {
        id: uid(),
        role: 'user',
        content: text,
        steps: [],
        sources: [],
        images: [],
        scene: null,
        code: null,
        videos: [],
        thought: '',
        expiredImages: false,
        createdAt: Date.now(),
        target: targetLabel,
      }
      const placeholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        steps: [],
        sources: [],
        images: [],
        scene: null,
        code: null,
        videos: [],
        thought: '',
        expiredImages: false,
        createdAt: Date.now(),
        pending: true,
      }

      // Payload allégé : seuls les 30 derniers messages partent au serveur,
      // chacun tronqué — le contexte complet reste géré par la mémoire longue.
      // Évite les requêtes géantes (lenteur, timeouts, erreurs 502).
      const history = (active?.messages ?? [])
        .filter((m) => !m.pending && m.content.trim().length > 0)
        .slice(-30)
        .map((m) => ({
          role: m.role,
          content: m.content.length > 4000 ? m.content.slice(0, 4000) + '…' : m.content,
        }))

      updateConversation(convId, (c) => ({
        ...c,
        title: c.title === 'Nouvelle conversation' ? text.slice(0, 46) : c.title,
        messages: [...c.messages, userMsg, placeholder],
      }))

      setInput('')
      setStreaming(true)
      stickRef.current = true
      const controller = new AbortController()
      abortRef.current = controller

      // Buffers pour limiter les re-rendus — currentId suit la bulle active
      // (un speaker multi-agents ouvre une nouvelle bulle)
      let content = ''
      let dirty = false
      let finished = false
      let currentId = assistantId
      // Cerveaux 3D : qui pense / qui parle en ce moment (SSE → store)
      let currentBrainId = 'nexus'
      let brainSpeaking = false
      const flush = () => {
        if (!dirty) return
        dirty = false
        patchAssistant(convId as string, currentId, (m) => ({ ...m, content }))
      }
      const timer = setInterval(flush, 70)

      // La fin est déclenchée par l'événement 'done' — PAS par la fermeture du
      // flux, afin que l'extraction mémoire (arrière-plan serveur) ne bloque
      // pas l'interface.
      const finish = () => {
        if (finished) return
        finished = true
        clearInterval(timer)
        flush()
        patchAssistant(convId as string, currentId, (m) => ({
          ...m,
          content,
          pending: false,
        }))
        setStreaming(false)
        abortRef.current = null
        // Les cerveaux repassent en veille (respiration lente)
        idleAllBrains()
        // Notification navigateur si l'utilisateur est ailleurs
        pushNotification('NEXUS a terminé votre demande', content.trim().slice(0, 170) || 'Votre réponse est prête.')
      }

      // Boucle de récupération : jusqu'à 2 nouvelles tentatives automatiques si
      // l'échec survient AVANT tout contenu reçu (429, 502, réseau, serveur),
      // avec un délai croissant (le serveur a déjà son propre backoff anti-429).
      let attempt = 0
      let sawServerError = false
      let serverErrorMessage = ''
      const RETRY_DELAYS = [1200, 3500]
      while (true) {
        attempt++
        sawServerError = false
        try {
          const res = await fetch('/api/agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [...history, { role: 'user', content: text }],
              ...(target.kind !== 'nexus' ? { target } : {}),
              // Discussion avec un agent : on lui donne ACCÈS au code actuel du
              // Studio Code (lecture) — il proposera une version à valider.
              ...(target.kind === 'agent' && (codeFiles.html.trim() || codeFiles.css.trim() || codeFiles.js.trim())
                ? { currentCode: codeFiles }
                : {}),
            }),
            signal: controller.signal,
          })

          if (!res.ok || !res.body) {
            throw new Error(`Erreur serveur (${res.status})`)
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''

          const handleEvent = (event: AgentEvent) => {
            if (event.type === 'ping') return // battement de cœur anti-timeout : rien à afficher
            if (event.type === 'token') {
              content += event.content
              dirty = true
              // Premiers mots streamés → le cerveau courant « parle »
              if (!brainSpeaking) {
                brainSpeaking = true
                setBrainActivity({ id: currentBrainId, status: 'speaking' })
              }
            } else if (event.type === 'done') {
              finish()
            } else if (event.type === 'step') {
            // Routage vers la BULLE COURANTE (currentId) : en multi-agents, la
            // coquille initiale est fermée dès le premier speaker — les étapes,
            // pensées et sources doivent suivre la bulle active, pas la coquille
            // (sinon bulles « Réflexion » fantômes sur une bulle vide).
            patchAssistant(convId as string, currentId, (m) => {
              const exists = m.steps.some((s) => s.id === event.id)
              const step: AgentStep = {
                id: event.id,
                tool: event.tool,
                label: event.label,
                detail: event.detail,
                status: event.status,
              }
              return {
                ...m,
                steps: exists ? m.steps.map((s) => (s.id === event.id ? step : s)) : [...m.steps, step],
              }
            })
          } else if (event.type === 'image') {
            runtimeImages.set(event.id, event.dataUrl)
            const img: ArtifactImage = { id: event.id, dataUrl: event.dataUrl, prompt: event.prompt }
            patchAssistant(convId as string, currentId, (m) => ({ ...m, images: [...m.images, img] }))
            // Vignette persistante : l'image reste visible après rechargement
            makeThumbnail(event.dataUrl).then((thumb) => {
              thumbnailRegistry.set(event.id, thumb)
              persistThumbnails()
            })
          } else if (event.type === 'scene') {
            patchAssistant(convId as string, currentId, (m) => ({ ...m, scene: event.scene }))
          } else if (event.type === 'code') {
            patchAssistant(convId as string, currentId, (m) => ({ ...m, code: event.code }))
          } else if (event.type === 'deliberation') {
            // BUREAU : les échanges complets des agents, mot pour mot — rattachés
            // à la bulle courante (celle de la réponse consolidée).
            patchAssistant(convId as string, currentId, (m) => ({ ...m, deliberation: event.entries }))
            // Les cerveaux des contributeurs passent « parlent » avec leur texte
            setBrainActivities(
              event.entries.map((e) => ({
                id: e.name,
                name: e.name,
                emoji: e.emoji,
                color: e.color,
                thought: e.text.slice(-220),
                status: 'speaking' as const,
              }))
            )
          } else if (event.type === 'proposal') {
            // PROPOSITION de code : l'agent a relu le code du Studio et propose
            // une version — l'utilisateur revoit le diff et valide (jamais auto).
            setPendingProposal(event.proposal)
            toast.success(`💼 Proposition de code de ${event.proposal.agentEmoji} ${event.proposal.agentName}`, {
              description: 'Studio Code → panneau « Propositions » : relis le diff, puis valide ou rejette.',
            })
          } else if (event.type === 'video') {
            const video: VideoArtifact = { id: event.id, url: event.url, prompt: event.prompt }
            patchAssistant(convId as string, currentId, (m) => ({ ...m, videos: [...m.videos, video] }))
            toast.success('Vidéo générée — visible ci-dessous et dans le Studio Vidéo')
          } else if (event.type === 'thought') {
            patchAssistant(convId as string, currentId, (m) => ({ ...m, thought: event.text }))
            // Le cerveau courant affiche sa réflexion (bulle flottante)
            setBrainActivity({ id: currentBrainId, thought: event.text, status: brainSpeaking ? 'speaking' : 'thinking' })
          } else if (event.type === 'agent_thought') {
            // Pensée EN DIRECT d'un agent du collectif (parallèle) → cerveaux 3D
            setBrainActivity({
              id: event.name,
              name: event.name,
              emoji: event.emoji,
              color: event.color,
              thought: event.text,
              status: 'thinking',
            })
          } else if (event.type === 'webpage') {
            setBrowsedPages((prev) =>
              [
                {
                  url: event.url,
                  title: event.title,
                  text: event.text,
                  ...(event.screenshot ? { screenshot: event.screenshot } : {}),
                  at: Date.now(),
                },
                ...prev,
              ].slice(0, 20)
            )
          } else if (event.type === 'speaker') {
            // Multi-agents : la bulle courante est clôturée, la suivante
            // appartient à cet agent (sa couleur, son emoji, son nom).
            patchAssistant(convId as string, currentId, (m) => ({ ...m, content, pending: false }))
            content = ''
            dirty = false
            brainSpeaking = false
            currentBrainId = event.id
            setBrainActivity({ id: event.id, name: event.name, emoji: event.emoji, color: event.color, status: 'thinking', thought: '' })
            const nextId = uid()
            updateConversation(convId as string, (c) => ({
              ...c,
              messages: [
                ...c.messages,
                {
                  id: nextId,
                  role: 'assistant' as const,
                  content: '',
                  steps: [],
                  sources: [],
                  images: [],
                  scene: null,
                  code: null,
                  videos: [],
                  thought: '',
                  expiredImages: false,
                  createdAt: Date.now(),
                  pending: true,
                  speaker: { id: event.id, name: event.name, emoji: event.emoji, color: event.color },
                },
              ],
            }))
            currentId = nextId
          } else if (event.type === 'task') {
            const label =
              event.status === 'done'
                ? 'terminée'
                : event.status === 'blocked'
                  ? 'bloquée'
                  : event.status === 'running'
                    ? 'en cours'
                    : 'à faire'
            toast.success(`Mission « ${event.name} » — ${label}`, {
              description:
                event.status === 'done'
                  ? 'Le rapport de synthèse est prêt : panneau Task → « Voir le rapport ».'
                  : event.note || 'Voir le panneau Task pour le détail.',
            })
            refreshTasks()
          } else if (event.type === 'sources') {
            patchAssistant(convId as string, currentId, (m) => {
              const known = new Set(m.sources.map((s) => s.url))
              const fresh = event.sources.filter((s) => !known.has(s.url))
              return { ...m, sources: [...m.sources, ...fresh] }
            })
          } else if (event.type === 'knowledge') {
            toast.success(`Note enregistrée dans la base de connaissances : ${event.title}`, {
              description: `Catégorie : ${event.category}`,
            })
            refreshKnowledge()
          } else if (event.type === 'meta') {
            if (event.title) {
              const naive = text.slice(0, 46)
              updateConversation(convId as string, (c) =>
                c.title === 'Nouvelle conversation' || c.title === naive
                  ? { ...c, title: event.title! }
                  : c
              )
            }
            if (typeof event.memoryAdded === 'number' && event.memoryAdded > 0) {
              toast.success(
                `NEXUS a mémorisé ${event.memoryAdded} nouvelle${event.memoryAdded > 1 ? 's' : ''} information${event.memoryAdded > 1 ? 's' : ''}`,
                { description: 'Disponible dans le panneau Mémoire.' }
              )
              refreshMemories()
            }
          } else if (event.type === 'error') {
            sawServerError = true
            serverErrorMessage = event.message
            toast.error(event.message)
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split('\n\n')
          buffer = parts.pop() ?? ''
          for (const part of parts) {
            const line = part.trim()
            if (!line.startsWith('data:')) continue
            try {
              handleEvent(JSON.parse(line.slice(5).trim()) as AgentEvent)
            } catch {
              /* événement partiel ignoré */
            }
          }
        }

        // Filet de sécurité si l'événement 'done' n'est jamais arrivé
        if (sawServerError) {
          if (content.trim().length === 0) {
            // Erreur fatale avant toute réponse → nouvelle(s) tentative(s), puis message clair
            if (attempt <= RETRY_DELAYS.length) {
              finished = false
              await new Promise((r) => setTimeout(r, RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]))
              continue
            }
            finish()
            patchAssistant(convId as string, assistantId, (m) => ({
              ...m,
              content: `⚠️ **L’agent a rencontré un problème.** ${serverErrorMessage}\n\nLa requête a été réessayée automatiquement. Si le problème persiste, ouvrez une nouvelle conversation — le contexte long est automatiquement allégé.`,
              pending: false,
            }))
            break
          }
          // Réponse partielle reçue puis erreur → on affiche ce qu'on a + la note d'erreur
          content += '\n\n' + `⚠️ **Erreur :** ${serverErrorMessage}`
          dirty = true
          finish()
          break
        }
        finish()
        break
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          finish()
          if (content.length === 0) {
            patchAssistant(convId as string, assistantId, (m) => ({
              ...m,
              content: '_Génération interrompue._',
              pending: false,
            }))
          }
          return
        }
        const msg = err instanceof Error ? err.message : 'Erreur réseau'
        // Réessai(s) automatique(s) si aucun contenu n'a été reçu (429, 502, réseau…)
        if (content.length === 0 && attempt <= RETRY_DELAYS.length) {
          finished = false
          await new Promise((r) => setTimeout(r, RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)]))
          continue
        }
        finish()
        pushNotification('NEXUS a rencontré un problème', msg)
        if (content.length === 0) {
          patchAssistant(convId as string, assistantId, (m) => ({
            ...m,
            content: `⚠️ **Impossible de contacter l’agent.** ${msg}\n\nLa connexion a été réessayée automatiquement. Si le problème persiste, ouvrez une nouvelle conversation — le contexte long est automatiquement allégé.`,
            pending: false,
          }))
        }
        break
        }
      }
    },
    [active, streaming, createConversation, patchAssistant, updateConversation, refreshMemories, refreshKnowledge, refreshTasks, pushNotification, target, targetInfo, setBrainActivity, setBrainActivities, idleAllBrains]
  )

  const stop = () => abortRef.current?.abort()

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const onOpenScene = useCallback((scene: SceneSpec) => {
    setPendingScene(scene)
    setView('studio3d')
  }, [setPendingScene, setView])
  const onOpenImage = useCallback((dataUrl: string) => {
    setPendingImage(dataUrl)
    setView('image')
  }, [setPendingImage, setView])
  const onOpenCode = useCallback((code: CodeArtifact) => {
    setPendingCode(code.files)
    setView('code')
  }, [setPendingCode, setView])
  const onOpenVideo = useCallback((url: string) => {
    setPendingVideo(url)
    setView('video')
  }, [setPendingVideo, setView])

  /** Lance une mission : message structuré envoyé à l'agent dans la conversation. */
  const onLaunchMission = (task: NexusTask) => {
    const parts = [`MISSION : ${task.name}`]
    if (task.duration) parts.push(`Durée : ${task.duration}`)
    if (task.objectives.length > 0) {
      parts.push(`Objectifs :
${task.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}`)
    }
    if (task.description) parts.push(`Description : ${task.description}`)
    parts.push(
      'Tu commences cette mission maintenant. Travaille dessus étape par étape (utilise tes outils si nécessaire), puis fais un premier rapport de ce que tu as fait et de ce qui reste.'
    )
    setMissionsOpen(false)
    send(parts.join('\n\n'))
  }

  const messages = useMemo(
    () =>
      (active?.messages ?? []).map((m) => ({
        ...m,
        // Normalisation : les conversations persistées avant v1.3 n'ont pas ces champs
        videos: m.videos ?? [],
        thought: m.thought ?? '',
        speaker: m.speaker ?? null,
      })),
    [active?.messages]
  )

  // Toutes les sources de la conversation pour le panneau navigateur
  const allSources: SourceItem[] = []
  for (const m of messages) {
    for (const s of m.sources) {
      if (!allSources.some((x) => x.url === s.url)) allSources.push(s)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Barre de conversation */}
      <div className="flex items-center gap-1.5 border-b border-border/70 bg-card/50 px-3 py-2 md:px-4">
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => setHistoryOpen(true)}
          aria-label="Ouvrir l'historique des conversations"
        >
          <History className="h-4 w-4" />
          <span className="hidden sm:inline">Historique</span>
          <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300">
            {conversations.length}
          </span>
        </Button>
        <p className="min-w-0 flex-1 truncate text-center text-sm font-medium text-foreground/90">
          {active?.title ?? 'Nouvelle conversation'}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => setBrowserOpen(true)}
          aria-label="Ouvrir le navigateur"
        >
          <Globe className="h-4 w-4 text-sky-400" />
          <span className="hidden sm:inline">Navigateur</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => setBrainsOpen(true)}
          aria-label="Ouvrir la salle des cerveaux 3D"
        >
          <Brain className="h-4 w-4 text-fuchsia-400" />
          <span className="hidden sm:inline">Cerveaux</span>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => {
            refreshTasks()
            setMissionsOpen(true)
          }}
          aria-label="Ouvrir les missions"
        >
          <ListChecks className="h-4 w-4 text-amber-400" />
          <span className="hidden sm:inline">Task</span>
          {tasks.filter((t) => t.status !== 'done').length > 0 && (
            <span className="rounded-full bg-amber-500/15 px-1.5 text-[10px] font-semibold text-amber-300">
              {tasks.filter((t) => t.status !== 'done').length}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => {
            refreshAgents()
            setTeamOpen(true)
          }}
          aria-label="Ouvrir l'équipe multi-agents"
        >
          <Users className="h-4 w-4 text-violet-400" />
          <span className="hidden sm:inline">Équipe</span>
          {agents.filter((a) => a.enabled).length > 0 && (
            <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300">
              {agents.filter((a) => a.enabled).length}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => setKnowledgeOpen(true)}
          aria-label="Ouvrir la base de connaissances"
        >
          <BookOpen className="h-4 w-4 text-emerald-400" />
          <span className="hidden sm:inline">Savoir</span>
          {knowledgeCount > 0 && (
            <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-300">
              {knowledgeCount}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5 border-border bg-muted/50 px-2.5 text-sm hover:bg-accent"
          onClick={() => {
            refreshMemories()
            setMemoryOpen(true)
          }}
          aria-label="Ouvrir la mémoire de l'agent"
        >
          <Brain className="h-4 w-4 text-violet-400" />
          <span className="hidden sm:inline">Mémoire</span>
          {memories.length > 0 && (
            <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-300">
              {memories.length}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className={cn(
            'h-9 w-9 shrink-0 border-border hover:bg-accent',
            notifyOn && 'border-amber-500/40 bg-amber-500/10 text-amber-300'
          )}
          onClick={toggleNotify}
          aria-label={notifyOn ? 'Désactiver les notifications' : 'Activer les notifications de fin de tâche'}
        >
          {notifyOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 border-border hover:bg-accent"
          onClick={() => createConversation()}
          aria-label="Nouvelle conversation"
        >
          <Plus className="h-4 w-4" />
        </Button>
        {active && active.messages.length > 0 && (
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 border-border text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
            onClick={() => {
              deleteConversation(active.id)
              toast.success('Conversation supprimée')
            }}
            aria-label="Supprimer la conversation"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-10 text-center">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 shadow-xl shadow-violet-500/30">
                <Boxes className="h-8 w-8 text-white" />
              </div>
              <h2 className="text-xl font-bold text-foreground">Bonjour, je suis NEXUS</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Ton agent autonome — et maintenant, ton <strong>équipe d'agents</strong> : je réponds
                vite, je cherche sur le web, je crée du code, des images, des scènes 3D, et je
                travaille <strong>seul en arrière-plan</strong> sur les missions que tu me confies,
                même quand tu n'es pas là.
              </p>
              <p className="mt-3 max-w-md rounded-lg border border-violet-500/25 bg-violet-500/10 px-3 py-2 text-xs leading-relaxed text-violet-200">
                💬 <strong>Avec qui veux-tu parler ?</strong> Choisis juste au-dessus de la barre de
                saisie : <strong>NEXUS</strong> (globale), le <strong>Bureau</strong> (tous les agents
                réfléchissent ensemble, une seule réponse consolidée), la <strong>table ronde</strong>{' '}
                (chaque agent dans sa bulle), un <strong>groupe</strong>, ou un <strong>agent</strong>{' '}
                seul avec son prompt personnel.
              </p>
              <div className="mt-6 grid w-full max-w-lg grid-cols-2 gap-2.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => send(s.text)}
                    className="rounded-xl border border-border bg-muted/40 p-3 text-left transition-all hover:border-violet-500/50 hover:bg-accent/60"
                  >
                    <p className="text-xs font-semibold text-violet-300">{s.label}</p>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{s.text}</p>
                  </button>
                ))}
              </div>
              <p className="mt-5 max-w-md text-[11px] leading-relaxed text-muted-foreground/70">
                Astuce : confie-moi une mission via le bouton <strong>Task</strong> — mon équipe
                cherche sur Google, YouTube et TikTok, <strong>regarde les vidéos</strong> (transcription),
                retient l&apos;essentiel et rédige un <strong>rapport de synthèse</strong> que tu peux lire.
                Recrute tes propres agents via le bouton <strong>Équipe</strong>.
              </p>
            </div>
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onOpenScene={onOpenScene}
                onOpenImage={onOpenImage}
                onOpenCode={onOpenCode}
                onOpenVideo={onOpenVideo}
              />
            ))
          )}
        </div>
      </div>

      {/* Zone de saisie */}
      <div className="border-t border-border/70 bg-card/50 p-3 md:p-4">
        <div className="mx-auto w-full max-w-3xl">
          {/* Sélecteur de destinataire : NEXUS / tous les agents / un groupe / un agent */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                aria-label="Choisir avec qui parler"
              >
                <span className="text-sm leading-none">{targetInfo.icon}</span>
                <span className="truncate">Discussion avec {targetInfo.label}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              <DropdownMenuItem onClick={() => setTarget({ kind: 'nexus' })} className="gap-2">
                <span className="text-base leading-none">🟣</span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">NEXUS</span>
                  <span className="block text-[10px] text-muted-foreground">Globale — l'agent principal, sans agents</span>
                </span>
                {target.kind === 'nexus' && <Check className="h-3.5 w-3.5 text-violet-400" />}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                🏛️ Bureau (les agents réfléchissent tous, NEXUS répond)
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTarget({ kind: 'bureau' })} className="gap-2">
                <span className="text-base leading-none">🏛️</span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">Bureau — toute l'équipe</span>
                  <span className="block text-[10px] text-muted-foreground">
                    Délibération parallèle · UNE réponse consolidée
                  </span>
                </span>
                {target.kind === 'bureau' && !target.groupId && <Check className="h-3.5 w-3.5 text-violet-400" />}
              </DropdownMenuItem>
              {groups.map((g) => (
                <DropdownMenuItem
                  key={`bureau-${g.id}`}
                  onClick={() => setTarget({ kind: 'bureau', groupId: g.id })}
                  className="gap-2"
                >
                  <span className="text-base leading-none">🏛️</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">Bureau : {g.name}</span>
                    <span className="block text-[10px] text-muted-foreground">Groupe · délibération · réponse unique</span>
                  </span>
                  {target.kind === 'bureau' && target.groupId === g.id && (
                    <Check className="h-3.5 w-3.5 text-violet-400" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Table ronde (chacun répond dans sa bulle, puis synthèse)
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setTarget({ kind: 'all' })} className="gap-2">
                <span className="text-base leading-none">👥</span>
                <span className="flex-1">
                  <span className="block text-sm font-medium">Tous les agents</span>
                  <span className="block text-[10px] text-muted-foreground">
                    Toute l'équipe active ({agents.filter((a) => a.enabled).length})
                  </span>
                </span>
                {target.kind === 'all' && <Check className="h-3.5 w-3.5 text-violet-400" />}
              </DropdownMenuItem>
              {groups.map((g) => (
                <DropdownMenuItem
                  key={g.id}
                  onClick={() => setTarget({ kind: 'group', groupId: g.id })}
                  className="gap-2"
                >
                  <span className="text-base leading-none">{g.emoji}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{g.name}</span>
                    <span className="block text-[10px] text-muted-foreground">Groupe · {g.members.length} membre{g.members.length > 1 ? 's' : ''}</span>
                  </span>
                  {target.kind === 'group' && target.groupId === g.id && (
                    <Check className="h-3.5 w-3.5 text-violet-400" />
                  )}
                </DropdownMenuItem>
              ))}
              {groups.length === 0 && (
                <p className="px-2 py-1 text-[10px] text-muted-foreground/70">
                  Aucun groupe — crée-en dans le panneau Équipe.
                </p>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Agent seul (discussion privée)
              </DropdownMenuLabel>
              {agents.filter((a) => a.enabled).map((a) => (
                <DropdownMenuItem
                  key={a.id}
                  onClick={() => setTarget({ kind: 'agent', agentId: a.id })}
                  className="gap-2"
                >
                  <span className="text-base leading-none">{a.emoji}</span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium">{a.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{ROLE_LABELS[a.role]}{a.prompt ? ' · prompt personnalisé' : ''}</span>
                  </span>
                  {target.kind === 'agent' && target.agentId === a.id && (
                    <Check className="h-3.5 w-3.5 text-violet-400" />
                  )}
                </DropdownMenuItem>
              ))}
              {agents.filter((a) => a.enabled).length === 0 && (
                <p className="px-2 py-1 text-[10px] text-muted-foreground/70">
                  Aucun agent actif — recrute-en dans le panneau Équipe.
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={
                target.kind === 'nexus'
                  ? "Demandez n'importe quoi à NEXUS… (Entrée pour envoyer)"
                  : target.kind === 'bureau'
                    ? `Question au bureau (${targetInfo.label.replace(' — ', ' · ')})… (Entrée pour envoyer)`
                    : `Message pour ${targetInfo.label}… (Entrée pour envoyer)`
              }
              aria-label="Message pour l’agent"
              className="max-h-36 w-full resize-none rounded-xl border border-border bg-muted/60 py-3 pl-4 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
              style={{ minHeight: '2.75rem' }}
            />
          </div>
          {streaming ? (
            <Button
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl bg-rose-500 text-white hover:bg-rose-600"
              onClick={stop}
              aria-label="Arrêter la génération"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-11 w-11 shrink-0 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/25 hover:opacity-90"
              onClick={() => send(input)}
              disabled={input.trim().length === 0}
              aria-label="Envoyer le message"
            >
              <ArrowUp className="h-4.5 w-4.5" />
            </Button>
          )}
        </div>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground/70">
          NEXUS combine un moteur de raisonnement LLM et des compétences locales instantanées — recherche web, lecture de pages, code, images, scènes 3D, missions autonomes et mémoire longue.
        </p>
      </div>

      {/* Panneaux latéraux */}
      <HistoryPanel open={historyOpen} onOpenChange={setHistoryOpen} />
      <Dialog open={brainsOpen} onOpenChange={setBrainsOpen}>
        <DialogContent className="flex h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:h-[85vh]">
          <DialogHeader className="border-b border-border/70 px-5 py-3">
            <DialogTitle className="text-base">🧠 Cerveau Jarvis — en direct</DialogTitle>
            <DialogDescription className="text-xs">
              Un cerveau central unique relié à chaque agent : les impulsions voyagent sur les liens quand
              quelqu’un réfléchit ou parle. Bascule vers la vue « Éclaté » pour un cerveau par agent.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <BrainView compact />
          </div>
        </DialogContent>
      </Dialog>
      <MemoryPanel open={memoryOpen} onOpenChange={setMemoryOpen} memories={memories} onRefresh={refreshMemories} />
      <KnowledgePanel open={knowledgeOpen} onOpenChange={setKnowledgeOpen} onChanged={refreshKnowledge} />
      <BrowserPanel open={browserOpen} onOpenChange={setBrowserOpen} pages={browsedPages} sources={allSources} />
      <MissionsPanel
        open={missionsOpen}
        onOpenChange={setMissionsOpen}
        tasks={tasks}
        onRefresh={refreshTasks}
        onLaunch={onLaunchMission}
        busy={streaming}
        agents={agents}
      />
      <TeamPanel open={teamOpen} onOpenChange={setTeamOpen} agents={agents} onRefresh={refreshAgents} />
    </div>
  )
}
