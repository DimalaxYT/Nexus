// ─── NEXUS — Moteur de synthèse textuelle 100 % local (Zéro API externe) ─────
// NEXUS est une IA entièrement codée de A à Z, sans clé API ni service LLM
// externe. Ce module est la porte d'entrée du cerveau : il relie le pipeline de
// discussion (`brain.ts`) au transformeur maison (`llm/`) — tokenizer BPE,
// décodage avec cache clé/valeur, retrieval dans le savoir local et garde-fous
// de qualité — et fournit la synthèse locale des rapports de missions.
//
// Règle de répartition, assumée et documentée :
//   · la CONVERSATION passe par le modèle de langue (texte réellement généré),
//   · les ACTIONS (recherche, code, image, vidéo…) restent déterministes : un
//     modèle de 300 k paramètres ne décide pas d'un appel d'outil de façon
//     fiable, et les compétences locales produisent déjà un résultat exact.
// Quand le modèle n'est pas assez sûr de lui, on ne « bluffe » pas : la réponse
// revient au savoir retrouvé (banque de dialogue, connaissances, notes).

import { extractKeySentences } from './brain/synthesize'
import { answerChat, streamChat, type ChatTurn } from './llm/dialogue'
import { loadActiveModel } from './llm/engine'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Ce que le moteur local a besoin de savoir sur la conversation en cours. */
export interface ChatContext {
  /** Compte propriétaire (cloisonnement du savoir retrouvé). */
  userId?: string | null
  /** Demande effective de l'utilisateur (enrichie du contexte de suivi). */
  lastUser?: string
  /** Échanges précédents (mémoire courte de la conversation). */
  history?: ChatTurn[]
  /**
   * Nature de la demande faite au moteur :
   *   · `chat`          — conversation libre : le modèle rédige la réponse,
   *   · `tool-decision` — décision d'outil attendue en JSON : non prise en
   *                       charge par le modèle local (repli déterministe),
   *   · `tool-result`   — rédaction à partir d'un résultat d'outil : idem, les
   *                       compétences locales mettent déjà en forme leur sortie.
   */
  purpose?: 'chat' | 'tool-decision' | 'tool-result'
  /** Informé de la provenance de la réponse (générée ou retrouvée). */
  onProvenance?: (info: ChatProvenance) => void
}

export interface ChatProvenance {
  /** true = rédigé par le transformeur, false = texte du savoir local retrouvé. */
  generated: boolean
  /** true = génération non tentée (modèle en observation après des refus répétés). */
  skipped?: boolean
  source: string | null
  confidence: number
  avgNll: number
  tokens: number
  ms: number
}

export interface CompleteOptions {
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  thinking?: boolean
  /** Contexte de conversation (compte, historique, nature de la demande). */
  context?: ChatContext
}

export function llmBlockedFor(): number {
  return 0
}

export function llmStatus(): {
  available: boolean
  provider: string
  blockedMs: number
  lastError: string
} {
  return {
    available: true,
    provider: 'nexus-local-engine',
    blockedMs: 0,
    lastError: '',
  }
}

/**
 * Demande-t-on au moteur une décision d'outil ou une rédaction sur résultat
 * d'outil ? Dans les deux cas le modèle local passe la main : ces tâches
 * demandent un suivi d'instructions qu'un petit modèle n'assure pas, et le
 * cerveau déterministe les traite déjà correctement.
 */
function isToolTask(messages: LlmMessage[], purpose?: ChatContext['purpose']): boolean {
  if (purpose === 'tool-decision' || purpose === 'tool-result') return true
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  if (!system) return false
  if (/R[ÉE]SULTAT D'OUTIL/i.test(system)) return true
  if (/R[ée]ponds UNIQUEMENT avec l'objet JSON/.test(system)) return true
  return false
}

/** Extrait le message utilisateur et l'historique utiles au modèle local. */
function chatInput(messages: LlmMessage[], context?: ChatContext): { message: string; history: ChatTurn[] } {
  const message = (context?.lastUser ?? messages.findLast((m) => m.role === 'user')?.content ?? '').trim()
  const history: ChatTurn[] = (context?.history ?? [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim())
    .slice(-6)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
  // L'historique fourni contient la demande courante : elle ne doit pas être
  // comptée comme un échange précédent (sinon la ligne `H:` dupliquerait `Q:`).
  while (history.length > 0) {
    const last = history[history.length - 1]
    if (last.role === 'user' && last.content.trim() === message.trim()) history.pop()
    else break
  }
  return { message, history }
}

/** Informe l'appelant de la provenance de la réponse (journal, interface). */
function reportProvenance(context: ChatContext | undefined, answer: { generated: boolean; skipped?: boolean; source: string | null; confidence: number; avgNll: number; tokens: number; ms: number }): void {
  context?.onProvenance?.({
    generated: answer.generated,
    skipped: Boolean(answer.skipped),
    source: answer.source,
    confidence: answer.confidence,
    avgNll: Number.isFinite(answer.avgNll) ? Number(answer.avgNll.toFixed(3)) : -1,
    tokens: answer.tokens,
    ms: answer.ms,
  })
}

export function resetLlmCircuit(): void {
  // No-op : le moteur est 100 % local et toujours disponible
}

/**
 * Complétion non diffusée. Trois cas :
 *   1. rapport de mission (corpus de sources collectées) → synthèse locale
 *      déterministe, qui croise les sources et cite les domaines,
 *   2. décision d'outil / rédaction sur résultat d'outil → `null`, le cerveau
 *      déterministe prend le relais (compétences locales),
 *   3. conversation → réponse du modèle local (retrieval + rédaction + garde-fous).
 */
export async function llmComplete(
  messages: LlmMessage[],
  opts: CompleteOptions = {}
): Promise<string | null> {
  const userMsg = messages.findLast((m) => m.role === 'user')?.content ?? ''

  // 1. Synthèse de rapport de mission (CONTENUS COLLECTÉS présents)
  if (userMsg.includes('CONTENUS COLLECTÉS') && userMsg.includes('Mission :')) {
    return synthesizeMissionReportLocal(userMsg)
  }

  // 2. Tâche d'outil : hors du champ du modèle local.
  if (isToolTask(messages, opts.context?.purpose)) return null

  // 3. Conversation : le transformeur maison rédige.
  const { message, history } = chatInput(messages, opts.context)
  if (!message) return null
  const model = await loadActiveModel().catch(() => null)
  const answer = await answerChat({
    message,
    history,
    userId: opts.context?.userId ?? null,
    model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    gate: true,
  })
  if (!answer.ok) return null
  reportProvenance(opts.context, answer)
  return answer.text
}

/**
 * Réponse de conversation diffusée au fil de l'eau (SSE).
 *
 * Le texte est d'abord généré EN ENTIER puis validé (confiance du modèle,
 * mots appris, répétition, ancrage dans le savoir retrouvé) avant le premier
 * morceau envoyé : on n'affiche jamais un début de charabia qu'il faudrait
 * reprendre. La génération elle-même ne coûte que ~150 ms (cache clé/valeur),
 * donc la diffusion progressive reste immédiate pour l'utilisateur.
 *
 * Renvoie le texte complet, ou `null` quand rien d'utilisable n'a pu être
 * produit (l'appelant retombe alors sur son repli local).
 */
export async function llmStream(
  messages: LlmMessage[],
  onDelta: (chunk: string) => void,
  opts: CompleteOptions = {}
): Promise<string | null> {
  if (isToolTask(messages, opts.context?.purpose)) return null
  const { message, history } = chatInput(messages, opts.context)
  if (!message) return null

  const model = await loadActiveModel().catch(() => null)
  const answer = await streamChat({
    message,
    history,
    userId: opts.context?.userId ?? null,
    model,
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    onDelta,
    gate: true,
  })
  if (!answer.ok) return null
  reportProvenance(opts.context, answer)
  return answer.text
}

/**
 * Synthétise localement un rapport de mission structuré à partir du corpus collecté.
 */
function synthesizeMissionReportLocal(prompt: string): string | null {
  const missionMatch = prompt.match(/Mission\s*:\s*«\s*([^»]+)\s*»/)
  const topicMatch = prompt.match(/Sujet\s*:\s*([^\n]+)/)
  const missionName = missionMatch?.[1]?.trim() || 'Mission NEXUS'
  const topic = topicMatch?.[1]?.trim() || missionName

  const corpusIdx = prompt.indexOf('CONTENUS COLLECTÉS')
  if (corpusIdx < 0) return null
  const corpus = prompt.slice(corpusIdx)

  // Découpe les blocs [1] (page — domaine) Titre \n Contenu
  const blocks = corpus.split(/\n(?=\[\d+\]\s+\()/).filter((b) => /^\[\d+\]/.test(b.trim()))
  if (blocks.length === 0) return null

  const sources: { idx: string; kind: string; domain: string; title: string; body: string }[] = []
  for (const b of blocks) {
    const m = b.match(/^\[(\d+)\]\s+\(([^—)]+)—\s*([^)]+)\)\s*([^\n]+)\n([\s\S]*)$/)
    if (m) {
      sources.push({
        idx: m[1],
        kind: m[2].trim(),
        domain: m[3].trim(),
        title: m[4].trim(),
        body: m[5].trim(),
      })
    }
  }
  if (sources.length === 0) return null

  const summarySentences: string[] = []
  const keyBullets: string[] = []

  for (const src of sources) {
    const best = extractKeySentences(src.body, topic, 2)
    if (best.length > 0) {
      if (summarySentences.length < 4) {
        summarySentences.push(`${best[0]} **[${src.domain}]**`)
      }
      for (const s of best) {
        if (keyBullets.length < 8) {
          keyBullets.push(`- **${src.title.slice(0, 75)}** : ${s} *[${src.domain}]*`)
        }
      }
    } else if (src.body.length > 40 && keyBullets.length < 8) {
      const clean = src.body.replace(/\s+/g, ' ').slice(0, 220)
      keyBullets.push(`- **${src.title.slice(0, 75)}** : ${clean}… *[${src.domain}]*`)
    }
  }

  const out: string[] = []
  out.push(`## Ce que j'ai compris — ${missionName}`)
  if (summarySentences.length > 0) {
    out.push(summarySentences.join(' '))
  } else {
    out.push(
      `L'analyse croisée des ${sources.length} sources collectées sur **${topic}** met en évidence les éléments factuels détaillés ci-dessous.`
    )
  }

  out.push(`\n## Points clés`)
  if (keyBullets.length > 0) {
    out.push(keyBullets.join('\n'))
  } else {
    out.push(`- ${sources.length} source(s) analysée(s) sur « ${topic} ».`)
  }

  out.push(`\n## Sources consultées`)
  out.push(
    sources
      .map((s) => `- **[${s.domain}]** ${s.title} *(${s.kind})*`)
      .join('\n')
  )

  return out.join('\n\n')
}

/** Extrait le premier objet JSON d'un texte (tolère les fences ```json). */
export function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') inString = !inString
    if (inString) continue
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T
        } catch {
          return null
        }
      }
    }
  }
  return null
}
