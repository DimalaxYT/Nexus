import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CodeFiles, CodeProposal, Conversation, SceneSpec, ViewId } from '@/lib/nexus-types'

/** État d'activité d'UN cerveau (agent ou NEXUS) dans la salle des cerveaux 3D. */
export interface BrainActivityItem {
  id: string // identifiant stable (id d'agent ou 'nexus')
  name: string
  emoji: string
  color: string
  role?: string
  status: 'idle' | 'thinking' | 'speaking'
  thought: string // dernière pensée en direct (fragment affiché près du cerveau)
  at: number // dernier update (epoch ms)
}

interface NexusState {
  // Navigation
  view: ViewId
  setView: (v: ViewId) => void
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Conversations (persistées localStorage + serveur)
  conversations: Conversation[]
  activeConversationId: string | null
  createConversation: () => string
  setActiveConversation: (id: string | null) => void
  updateConversation: (id: string, updater: (c: Conversation) => Conversation) => void
  deleteConversation: (id: string) => void
  deleteAllConversations: () => void
  hydrated: boolean
  hydrateFromServer: () => Promise<void>

  // Transferts entre l'agent et les studios
  pendingScene: SceneSpec | null
  setPendingScene: (s: SceneSpec | null) => void
  pendingImage: string | null
  setPendingImage: (d: string | null) => void
  pendingCode: CodeFiles | null
  setPendingCode: (c: CodeFiles | null) => void
  pendingVideo: string | null
  setPendingVideo: (u: string | null) => void

  // Fichiers de code ACTUELS du Studio Code — partagés avec les agents :
  // quand on discute avec un agent, il peut LIRE ce code et PROPOSER une
  // version améliorée (jamais d'écriture directe : l'utilisateur valide).
  codeFiles: CodeFiles
  setCodeFiles: (c: CodeFiles | ((prev: CodeFiles) => CodeFiles)) => void

  // Proposition de code d'un agent en attente de validation (diff → Studio Code)
  pendingProposal: CodeProposal | null
  setPendingProposal: (p: CodeProposal | null) => void

  // SALLE DES CERVEAUX 3D : activité en direct des agents + NEXUS (session)
  brainActivity: Record<string, BrainActivityItem>
  setBrainActivity: (item: Partial<BrainActivityItem> & { id: string }) => void
  setBrainActivities: (items: (Partial<BrainActivityItem> & { id: string })[]) => void
  idleAllBrains: () => void
  clearBrainActivity: () => void
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Fichiers de départ du Studio Code (page web minimale, cohérente avec CodeStudio). */
const TEMPLATES_PLACEHOLDER: CodeFiles = {
  html: '<div class="carte">\n  <h1>Bonjour NEXUS</h1>\n  <p>Commencez à coder…</p>\n</div>',
  css: 'body {\n  display: grid;\n  place-items: center;\n  min-height: 100vh;\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  background: #09090b;\n  color: #e4e4e7;\n}\n.carte {\n  padding: 2rem 3rem;\n  border-radius: 1rem;\n  background: #18181b;\n  text-align: center;\n}',
  js: "console.log('Prêt à coder !');",
}

// ── Synchronisation serveur (SQLite) ─────────────────────────────────────────

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Nettoie les messages avant envoi : jamais de base64 (résolu via registre client). */
function cleanForSync(c: Conversation) {
  return {
    id: c.id,
    title: c.title,
    messages: c.messages.map((m) =>
      m.images.length === 0
        ? m
        : { ...m, images: m.images.map((img) => ({ ...img, dataUrl: '' })) }
    ),
  }
}

/** Sauvegarde debounced d'une conversation côté serveur. */
function scheduleConvSync(id: string) {
  const existing = syncTimers.get(id)
  if (existing) clearTimeout(existing)
  syncTimers.set(
    id,
    setTimeout(() => {
      syncTimers.delete(id)
      const conv = useNexusStore.getState().conversations.find((c) => c.id === id)
      if (!conv) return
      fetch('/api/conversations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanForSync(conv)),
      }).catch(() => {
        /* hors-ligne : le localStorage reste la source de secours */
      })
    }, 900)
  )
}

/** Suppression immédiate côté serveur. */
function convDelete(id: string) {
  const existing = syncTimers.get(id)
  if (existing) {
    clearTimeout(existing)
    syncTimers.delete(id)
  }
  fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {})
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useNexusStore = create<NexusState>()(
  persist(
    (set, get) => ({
      view: 'hub',
      setView: (v) => set({ view: v, sidebarOpen: false }),
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),

      conversations: [],
      activeConversationId: null,
      createConversation: () => {
        const id = uid()
        const conv: Conversation = {
          id,
          title: 'Nouvelle conversation',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
        set((s) => ({
          conversations: [conv, ...s.conversations],
          activeConversationId: id,
        }))
        scheduleConvSync(id)
        return id
      },
      setActiveConversation: (id) => set({ activeConversationId: id }),
      updateConversation: (id, updater) => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...updater(c), updatedAt: Date.now() } : c
          ),
        }))
        scheduleConvSync(id)
      },
      deleteConversation: (id) => {
        set((s) => {
          const rest = s.conversations.filter((c) => c.id !== id)
          return {
            conversations: rest,
            activeConversationId:
              s.activeConversationId === id ? rest[0]?.id ?? null : s.activeConversationId,
          }
        })
        convDelete(id)
      },
      deleteAllConversations: () => {
        set({ conversations: [], activeConversationId: null })
        fetch('/api/conversations?all=1', { method: 'DELETE' }).catch(() => {})
      },

      hydrated: false,
      hydrateFromServer: async () => {
        if (get().hydrated) return
        set({ hydrated: true })
        try {
          const res = await fetch('/api/conversations')
          if (!res.ok) return
          const { conversations } = (await res.json()) as {
            conversations: { id: string; title: string; createdAt: string; updatedAt: string }[]
          }
          if (!Array.isArray(conversations) || conversations.length === 0) return

          // Fusion avec le local : la version la plus récente gagne (par id)
          const local = new Map(get().conversations.map((c) => [c.id, c]))
          const merged = new Map(local)
          for (const meta of conversations) {
            const localTs = local.get(meta.id)?.updatedAt ?? 0
            const serverTs = new Date(meta.updatedAt).getTime()
            if (serverTs > localTs) {
              // Récupère le contenu complet côté serveur
              try {
                const detail = await fetch(`/api/conversations?id=${encodeURIComponent(meta.id)}`)
                if (detail.ok) {
                  const { conversation } = (await detail.json()) as { conversation: Conversation }
                  if (conversation) {
                    merged.set(meta.id, {
                      ...conversation,
                      createdAt: new Date(conversation.createdAt).getTime() || Date.now(),
                      updatedAt: serverTs,
                    })
                  }
                }
              } catch {
                /* conversation serveur illisible : on garde la version locale */
              }
            }
          }

          // Préserve la conversation active localement (jamais écrasée par une version vide)
          const activeId = get().activeConversationId
          const active = activeId ? merged.get(activeId) : null
          if (active && active.messages.length === 0 && (local.get(activeId!)?.messages.length ?? 0) > 0) {
            merged.set(activeId!, local.get(activeId!)!)
          }

          set({
            conversations: Array.from(merged.values()).sort((a, b) => b.updatedAt - a.updatedAt),
          })
        } catch {
          /* serveur injoignable : le localStorage reste la source */
        }
      },

      pendingScene: null,
      setPendingScene: (s) => set({ pendingScene: s }),
      pendingImage: null,
      setPendingImage: (d) => set({ pendingImage: d }),
      pendingCode: null,
      setPendingCode: (c) => set({ pendingCode: c }),
      pendingVideo: null,
      setPendingVideo: (u) => set({ pendingVideo: u }),

      codeFiles: { ...TEMPLATES_PLACEHOLDER },
      setCodeFiles: (c) =>
        set((s) => ({ codeFiles: typeof c === 'function' ? (c as (prev: CodeFiles) => CodeFiles)(s.codeFiles) : c })),

      pendingProposal: null,
      setPendingProposal: (p) => set({ pendingProposal: p }),

      brainActivity: {},
      setBrainActivity: (item) =>
        set((s) => {
          const prev = s.brainActivity[item.id]
          const merged: BrainActivityItem = {
            id: item.id,
            name: item.name ?? prev?.name ?? '',
            emoji: item.emoji ?? prev?.emoji ?? '🤖',
            color: item.color ?? prev?.color ?? '#a78bfa',
            role: item.role ?? prev?.role,
            status: item.status ?? prev?.status ?? 'idle',
            thought: item.thought ?? prev?.thought ?? '',
            at: Date.now(),
          }
          return { brainActivity: { ...s.brainActivity, [item.id]: merged } }
        }),
      setBrainActivities: (items) =>
        set((s) => {
          const next = { ...s.brainActivity }
          for (const item of items) {
            const prev = next[item.id]
            next[item.id] = {
              id: item.id,
              name: item.name ?? prev?.name ?? '',
              emoji: item.emoji ?? prev?.emoji ?? '🤖',
              color: item.color ?? prev?.color ?? '#a78bfa',
              role: item.role ?? prev?.role,
              status: item.status ?? prev?.status ?? 'idle',
              thought: item.thought ?? prev?.thought ?? '',
              at: Date.now(),
            }
          }
          return { brainActivity: next }
        }),
      idleAllBrains: () =>
        set((s) => ({
          brainActivity: Object.fromEntries(
            Object.entries(s.brainActivity).map(([k, v]) => [k, { ...v, status: 'idle' as const }])
          ),
        })),
      clearBrainActivity: () => set({ brainActivity: {} }),
    }),
    {
      name: 'nexus-store',
      partialize: (s) => ({
        // Les images base64 restent en mémoire (runtimeImages) : on ne persiste que leur référence
        conversations: s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.images.length === 0
              ? m
              : { ...m, images: m.images.map((img) => ({ ...img, dataUrl: '' })) }
          ),
        })),
        activeConversationId: s.activeConversationId,
        // Le code du Studio Code est persisté : les agents y accèdent d'une session à l'autre
        codeFiles: s.codeFiles,
      }),
    }
  )
)

export { uid }
