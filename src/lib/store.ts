import { create } from 'zustand'
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware'
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
  /**
   * Changement de compte connecté (connexion / déconnexion) : on vide
   * l'historique affiché puis on recharge CELUI DU COMPTE depuis le serveur.
   * Évite tout mélange de conversations entre deux utilisateurs.
   */
  switchUserData: (userId: string | null) => Promise<void>

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

  /**
   * Agent mise en avant par le panneau Équipe (« ⚙️ Schéma ») : l'atelier
   * Blueprints ouvre directement le schéma de cet agent (et le crée au besoin).
   */
  blueprintAgentFocus: string | null
  setBlueprintAgentFocus: (id: string | null) => void

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

// ── Persistance locale différée ──────────────────────────────────────────────
// zustand/persist réécrivait TOUT l'historique dans le localStorage (sérialisation
// JSON complète) à CHAQUE modification du store : à chaque paquet de texte
// affiché pendant une réponse (toutes les 70 ms), à chaque étape, à chaque
// changement d'activité des cerveaux… Avec un historique de quelques Mo, chaque
// écriture bloquait l'onglet plusieurs dizaines de millisecondes : la réponse
// saccadait et l'interface ramait d'autant plus que l'historique grandissait.
// Désormais l'état est écrit au plus une fois par seconde (toujours le plus
// récent), et immédiatement quand l'onglet est masqué ou fermé.

type PersistedSlice = Pick<NexusState, 'conversations' | 'activeConversationId' | 'codeFiles'>

/** Les images base64 restent en mémoire (runtimeImages) : on ne persiste que leur référence. */
function stripImages(conversations: Conversation[]): Conversation[] {
  return conversations.map((c) => ({
    ...c,
    messages: c.messages.map((m) =>
      m.images.length === 0 ? m : { ...m, images: m.images.map((img) => ({ ...img, dataUrl: '' })) }
    ),
  }))
}

function deferredLocalStorage(delayMs: number): PersistStorage<PersistedSlice> | undefined {
  if (typeof window === 'undefined') return undefined
  let ls: Storage
  try {
    ls = window.localStorage
  } catch {
    return undefined
  }
  let pending: { name: string; value: StorageValue<PersistedSlice> } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    const job = pending
    pending = null
    if (!job) return
    try {
      const { state, version } = job.value
      ls.setItem(job.name, JSON.stringify({ state: { ...state, conversations: stripImages(state.conversations) }, version }))
    } catch {
      /* quota dépassé : la copie serveur reste la référence */
    }
  }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
  return {
    getItem: (name) => {
      const raw = ls.getItem(name)
      if (!raw) return null
      try {
        return JSON.parse(raw) as StorageValue<PersistedSlice>
      } catch {
        return null
      }
    },
    setItem: (name, value) => {
      pending = { name, value }
      if (!timer) timer = setTimeout(flush, delayMs)
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null
      ls.removeItem(name)
    },
  }
}

// ── Rapatriement de l'historique serveur ────────────────────────────────────

type ServerConversation = Omit<Conversation, 'createdAt' | 'updatedAt'> & { createdAt: string | number; updatedAt: string | number }

/**
 * Contenu complet de plusieurs conversations, par lots de 25 (deux lots en vol).
 * Avant : une requête PAR conversation, l'une après l'autre — une cinquantaine
 * d'allers-retours successifs à chaque connexion avant que l'historique soit là.
 */
async function fetchConversationDetails(ids: string[]): Promise<ServerConversation[]> {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25))
  const out: ServerConversation[] = []
  let next = 0
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++]
      try {
        const res = await fetch(`/api/conversations?ids=${chunk.map(encodeURIComponent).join(',')}`)
        if (!res.ok) continue
        const data = (await res.json()) as { conversations?: ServerConversation[] }
        for (const c of data.conversations ?? []) if (c && Array.isArray(c.messages)) out.push(c)
      } catch {
        /* lot illisible : on garde les versions locales */
      }
    }
  }
  await Promise.all([worker(), worker()])
  return out
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useNexusStore = create<NexusState>()(
  persist(
    (set, get) => ({
      // Vue par défaut : la discussion. Le site sert d'abord à parler à NEXUS.
      view: 'agent',
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

          // Seules les conversations plus récentes côté serveur sont rapatriées
          const local = new Map(get().conversations.map((c) => [c.id, c]))
          const serverTs = new Map<string, number>()
          for (const meta of conversations) {
            const ts = new Date(meta.updatedAt).getTime()
            if (ts > (local.get(meta.id)?.updatedAt ?? 0)) serverTs.set(meta.id, ts)
          }
          if (serverTs.size === 0) return
          const details = await fetchConversationDetails([...serverTs.keys()])
          if (details.length === 0) return

          // Fusion avec l'état COURANT (l'utilisateur a pu écrire pendant le
          // chargement) : la version la plus récente gagne, par id.
          set((s) => {
            const current = new Map(s.conversations.map((c) => [c.id, c]))
            for (const conversation of details) {
              const ts = serverTs.get(conversation.id)
              if (ts === undefined) continue
              const mine = current.get(conversation.id)
              if (mine && mine.updatedAt >= ts) continue
              // Préserve la conversation active locale (jamais écrasée par une version vide)
              if (mine && conversation.id === s.activeConversationId && conversation.messages.length === 0 && mine.messages.length > 0) continue
              current.set(conversation.id, {
                ...conversation,
                createdAt: new Date(conversation.createdAt).getTime() || Date.now(),
                updatedAt: ts,
              })
            }
            return { conversations: Array.from(current.values()).sort((a, b) => b.updatedAt - a.updatedAt) }
          })
        } catch {
          /* serveur injoignable : le localStorage reste la source */
        }
      },

      switchUserData: async (userId) => {
        // Annule les sauvegardes en attente (elles appartiennent à l'ancien compte)
        for (const timer of syncTimers.values()) clearTimeout(timer)
        syncTimers.clear()
        set({ conversations: [], activeConversationId: null, hydrated: false, pendingProposal: null })
        if (!userId) return
        await get().hydrateFromServer()
      },

      blueprintAgentFocus: null,
      setBlueprintAgentFocus: (id) => set({ blueprintAgentFocus: id }),

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
            color: item.color ?? prev?.color ?? '#ffffff',
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
              color: item.color ?? prev?.color ?? '#ffffff',
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
      storage: deferredLocalStorage(1000),
      // Sélection seulement (pas de copie) : le nettoyage des images se fait à
      // l'écriture différée, pas à chaque modification du store.
      partialize: (s) => ({
        conversations: s.conversations,
        activeConversationId: s.activeConversationId,
        // Le code du Studio Code est persisté : les agents y accèdent d'une session à l'autre
        codeFiles: s.codeFiles,
      }),
    }
  )
)

export { uid }
