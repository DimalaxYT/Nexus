// ─── NEXUS — Personnalité et mémoire longue, appliquées à la réponse servie ──
// Le chat ne se contente pas de retrouver un bon passage : il parle à
// QUELQU'UN. Ce module rassemble ce que NEXUS sait de la personne (profil du
// compte, souvenirs durables, dernier sujet de conversation) et l'applique au
// texte réellement affiché — celui du retrieval, pas celui du modèle :
//
//   · prénom        → « Salut Camille ! »
//   · continuité    → « On reprend sur « Comment créer un jeu Roblox » ? »
//   · nom choisi    → « Je suis Nova… » quand le compte a renommé l'assistant
//   · mémoire       → « Qu'est-ce que tu sais de moi ? » reçoit une vraie liste
//   · ton demandé   → direct = pas de question de relance inutile
//
// 100 % local : trois lectures en base (compte, souvenirs, dernière
// conversation), mises en cache 30 s. Aucun appel réseau.

import { db } from '@/lib/db'
import { parseProfile, type UserProfile } from '@/lib/auth'

export type Tone = 'neutre' | 'chaleureux' | 'professionnel' | 'direct' | 'pedagogue'

export interface PersonaMemory {
  content: string
  kind: string
}

export interface Persona {
  /** Prénom de l'utilisateur (dit à l'assistant, sinon profil du compte). */
  userName: string
  /** Nom de l'assistant (profil, « NEXUS » par défaut). */
  assistantName: string
  tone: Tone
  language: string
  /** Consignes permanentes du compte (non appliquées ici : voir persona.ts). */
  instructions: string
  /** Souvenirs durables, du plus récent au plus ancien. */
  memories: PersonaMemory[]
  /** Titre de la conversation précédente (continuité entre sessions). */
  lastTopic: string | null
  /** true : l'utilisateur a déjà parlé (conversation ou souvenir existant). */
  isReturning: boolean
  /** true : aucune conversation, aucun souvenir — premier contact. */
  isFirstEver: boolean
  /** Message d'accueil écrit par l'utilisateur dans son profil. */
  greeting: string
}

const EMPTY: Persona = {
  userName: '',
  assistantName: 'NEXUS',
  tone: 'neutre',
  language: 'fr',
  instructions: '',
  memories: [],
  lastTopic: null,
  isReturning: false,
  isFirstEver: true,
  greeting: '',
}

const TONES: Tone[] = ['neutre', 'chaleureux', 'professionnel', 'direct', 'pedagogue']

const CACHE_MS = 30_000
/** Le « dernier sujet » dépend de la conversation ouverte : il est recalculé
 *  à chaque appel à partir des titres mis en cache (pas figé par le cache). */
const cache = new Map<string, { at: number; persona: Omit<Persona, 'lastTopic'>; topics: { id: string; title: string }[] }>()

/** Purge le cache (écriture d'un souvenir, changement de profil). */
export function invalidatePersonaCache(userId?: string | null): void {
  if (userId) cache.delete(userId)
  else cache.clear()
}

/** Dernière conversation de l'utilisateur, hors conversation en cours. */
async function lastConversationTopic(userId: string, currentId?: string | null): Promise<string | null> {
  try {
    const rows = await db.conversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 4 })
    for (const row of rows ?? []) {
      const id = String(row?.id ?? '')
      if (currentId && id === currentId) continue
      const title = String(row?.title ?? '').trim()
      if (title.length >= 4) return title.slice(0, 90)
    }
    return null
  } catch {
    return null
  }
}

/** Prénom retenu en mémoire longue (« L'utilisateur s'appelle X »). */
function nameFromMemories(memories: PersonaMemory[]): string {
  for (const m of memories) {
    // UNIQUEMENT les souvenirs qui portent sur l'utilisateur lui-même :
    // « Son chat s'appelle Pixel » ne doit jamais devenir le prénom.
    const hit =
      m.content.match(/^L'utilisateur s'appelle\s+([\p{L}][\p{L}'-]{1,30})/iu) ||
      m.content.match(/^L'utilisateur se présente comme\s+([\p{L}][\p{L}'-]{1,30})/iu)
    if (hit) return hit[1].trim()
  }
  return ''
}

/**
 * Charge la personnalité d'un compte. Renvoie `null` sans compte (mode
 * mono-utilisateur historique) : aucune personnalisation n'est alors appliquée.
 */
export async function loadPersona(
  userId?: string | null,
  opts: { conversationId?: string | null } = {}
): Promise<Persona | null> {
  if (!userId) return null
  const pickTopic = (topics: { id: string; title: string }[], current?: string | null): string | null => {
    for (const t of topics) {
      if (current && t.id === current) continue
      if (t.title.trim().length >= 4) return t.title.trim().slice(0, 90)
    }
    return null
  }
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.persona, lastTopic: pickTopic(hit.topics, opts.conversationId) }

  try {
    const [user, memoryRows, conversations] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }).catch(() => null),
      db.memory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 40 }).catch(() => []),
      db.conversation.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 4 }).catch(() => []),
    ])
    if (!user) return null
    const profile: UserProfile = parseProfile(user.profile)
    const memories: PersonaMemory[] = (memoryRows ?? []).map((m: any) => ({
      content: String(m.content ?? '').trim(),
      kind: String(m.kind ?? 'fact'),
    }))
    // Ordre : ce que la personne a DIT à l'assistant (« je m'appelle … », le
    // plus récent d'abord), puis le prénom du compte, puis le nom du compte.
    // Le nom du compte vient souvent de l'e-mail : moins fiable qu'une phrase.
    const userName =
      nameFromMemories(memories) || (profile.displayName ?? '').trim() || String(user.name ?? '').trim()
    const topics = (conversations ?? []).map((row: any) => ({ id: String(row?.id ?? ''), title: String(row?.title ?? '') }))
    const tone = TONES.includes(profile.tone as Tone) ? (profile.tone as Tone) : 'neutre'
    const persona: Persona = {
      userName,
      assistantName: (profile.assistantName ?? '').trim() || 'NEXUS',
      tone,
      language: (profile.language ?? '').trim() || 'fr',
      instructions: (profile.instructions ?? '').trim(),
      memories,
      lastTopic: pickTopic(topics, opts.conversationId),
      isReturning: memories.length > 0 || (conversations ?? []).length > 0,
      isFirstEver: memories.length === 0 && (conversations ?? []).length === 0,
      greeting: (profile.greeting ?? '').trim(),
    }
    const { lastTopic: _topic, ...stable } = persona
    cache.set(userId, { at: Date.now(), persona: stable, topics })
    return persona
  } catch {
    return null
  }
}

// ── Mémoire racontée ────────────────────────────────────────────────────────

const SECOND_PERSON: [RegExp, string][] = [
  [/^L'utilisateur s'appelle\s+/i, 'tu t\'appelles '],
  [/^L'utilisateur se présente comme\s+/i, 'tu te présentes comme '],
  [/^L'utilisateur a\s+(\d+)\s+ans/i, 'tu as $1 ans'],
  [/^L'utilisateur habite à\s+/i, 'tu habites à '],
  [/^L'utilisateur vit à\s+/i, 'tu vis à '],
  [/^L'utilisateur aime\s+/i, 'tu aimes '],
  [/^L'utilisateur préfère\s+/i, 'tu préfères '],
  [/^La (.+?) préférée de l'utilisateur\s*:\s*/i, 'ta $1 préférée : '],
  [/^L'utilisateur travaille sur\s+/i, 'tu travailles sur '],
  [/^L'utilisateur développe\s+/i, 'tu développes '],
  [/^L'utilisateur est\s+/i, 'tu es '],
  [/^Son jeu s'appelle\s+/i, 'ton jeu s\'appelle '],
  [/^Son ([\p{L}-]+) s'appelle\s+/iu, 'ton $1 s\'appelle '],
  [/^Sa ([\p{L}-]+) s'appelle\s+/iu, 'ta $1 s\'appelle '],
  // « mon chat s'appelle Pixel » : le possessif aussi se met à la 2ᵉ personne.
  [/^Mon ([\p{L}-]+) s'appelle\s+/iu, 'ton $1 s\'appelle '],
  [/^Son projet\s*:\s*/i, 'ton projet : '],
  [/^Son objectif\s*:\s*/i, 'ton objectif : '],
  [/^Son pseudo\s*:\s*/i, 'ton pseudo : '],
  [/^Son email\s*:\s*/i, 'ton email : '],
  [/^Retenu par l'utilisateur\s*:\s*/i, ''],
]

/** Reformule un souvenir à la 2ᵉ personne (« L'utilisateur aime X » → « tu aimes X »). */
export function secondPerson(content: string): string {
  const text = String(content ?? '')
    .trim()
    .replace(/^Retenu par l'utilisateur\s*:\s*/i, '')
    .replace(/[.\s]+$/, '')
  for (const [re, to] of SECOND_PERSON) {
    if (re.test(text)) return text.replace(re, to).trim()
  }
  if (/^L'utilisateur\b/i.test(text)) return text.replace(/^L'utilisateur\b/i, 'tu').trim()
  return text.charAt(0).toLowerCase() + text.slice(1)
}

/** « Quelqu'un » : la question porte-t-elle sur ce que NEXUS sait de l'utilisateur ? */
export function isMemoryQuestion(message: string): boolean {
  const m = String(message ?? '')
    .toLowerCase()
    .normalize('NFC')
  if (m.length > 160) return false
  return (
    /\b(?:tu te souviens|tu te rappelles|tu m[’']as retenu|tu me connais|tu sais (?:qui je suis|ce que je suis|des choses sur moi|quelque chose sur moi))\b/.test(m) ||
    /\b(?:ce que tu sais (?:de|sur) moi|ce que tu retiens de moi|ma m[ée]moire|mon profil|qui suis-je)\b/.test(m) ||
    /\b(?:comment je m[’']appelle|quel est mon (?:nom|pr[ée]nom)|mon pr[ée]nom|mon nom)\b/.test(m) ||
    /\b(?:mes projets|mon projet|o[ùu] j[’']habite|quel [âa]ge (?:ai-je|j[’']ai))\b/.test(m) ||
    /\b(?:souviens-toi de moi|rappelle-toi de moi)\b/.test(m)
  )
}

/**
 * Sujet précis d'une question de mémoire (« et mon projet ? ») : sans lui, la
 * réponse listait tout — y compris ce qui n'a rien à voir avec la question.
 */
const FOCI: { ask: RegExp; keep: RegExp | null; label: string }[] = [
  { ask: /\b(projets?|travail\w*|d[ée]veloppe\w*|jeu)\b/i, keep: /\b(projet|travaille|d[ée]veloppe|jeu|objectif)\b/i, label: 'tes projets' },
  { ask: /\b(chat|chien|lapin|animal|perroquet|tortue)\b/i, keep: /\b(chat|chien|lapin|animal|perroquet|tortue)\b/i, label: 'tes animaux' },
  { ask: /\b(ville|habite|loge|tu vis)\b/i, keep: /\b(habite|vit à)\b/i, label: "l'endroit où tu vis" },
  { ask: /\b(pr[ée]nom|mon nom|appelle|qui suis-je)\b/i, keep: null, label: 'ton prénom' },
  { ask: /\b([âa]ge|ans)\b/i, keep: /\bans\b/i, label: 'ton âge' },
]

export function memoryFocus(question: string): string | null {
  const q = String(question ?? '')
  for (const f of FOCI) if (f.ask.test(q)) return f.label
  return null
}

/**
 * Résumé de ce que NEXUS sait de l'utilisateur, à la 2ᵉ personne.
 * `null` s'il n'y a rien : l'appelant décide alors d'avouer honnêtement.
 */
export function memorySummary(persona: Persona | null, max = 5, question = ''): string | null {
  if (!persona) return null
  const focus = FOCI.find((f) => f.ask.test(String(question ?? '')))
  if (focus && focus.label === 'ton prénom') {
    return persona.userName ? `Je me souviens de toi : tu t'appelles ${persona.userName}.` : null
  }
  const facts: string[] = []
  const seen = new Set<string>()
  const push = (fact: string) => {
    const key = fact.toLowerCase().slice(0, 50)
    if (!fact || fact.length < 4 || seen.has(key)) return
    seen.add(key)
    facts.push(fact)
  }
  // Le prénom n'est cité que si la question ne porte pas sur autre chose.
  if (persona.userName && !focus) push(`tu t'appelles ${persona.userName}`)
  let consumed = 0
  const source = focus?.keep ? persona.memories.filter((m) => focus.keep!.test(m.content)) : persona.memories
  if (focus && source.length === 0) return null
  const ordered = [...source].sort((a, b) => {
    const rank = (k: string) => (k === 'person' ? 0 : k === 'preference' ? 1 : k === 'project' ? 2 : 3)
    return rank(a.kind) - rank(b.kind)
  })
  for (const m of ordered) {
    const two = secondPerson(m.content)
    // Le prénom est déjà en tête : ne pas le répéter (« tu t'appelles X »).
    // Attention : « mon chat s'appelle Pixel » n'est PAS le prénom.
    consumed++
    if (persona.userName && /^tu t['’]appelles\b/i.test(two)) continue
    push(two)
    if (facts.length >= max) break
  }
  if (facts.length === 0) return null
  const last = facts.pop() as string
  const body = facts.length > 0 ? `${facts.join(', ')} et ${last}` : last
  // Au-delà de ce qui est cité, on dit combien de souvenirs dorment encore :
  // la personne sait que la mémoire est plus large que la phrase affichée.
  const rest = Math.max(0, source.length - consumed)
  const tail = rest > 0 ? ` J'en garde ${rest} autre${rest > 1 ? 's' : ''} en réserve.` : ''
  return `Je me souviens de toi : ${body}.${tail}`
}

// ── Application au texte servi ──────────────────────────────────────────────

export interface PersonalizeOptions {
  topic: string | null
  persona: Persona | null
  /** Premier message d'une nouvelle conversation. */
  firstTurn?: boolean
  /** Réponse précédente de l'assistant (évite de la répéter mot pour mot). */
  previousAnswer?: string | null
  /** Dernier sujet de l'HISTORIQUE fourni, si aucune conversation n'est en base. */
  lastTalk?: string | null
}

const GREETING_RE = /^(Salut|Bonjour|Bonsoir|Coucou|Hey|Yo|Hello|Ravi|Content|Enchanté)\b/i
const THANKS_RE = /^(Avec plaisir|C'est exactement mon rôle|De rien|Pas de souci)/i

function withName(text: string, name: string): string {
  if (!name) return text
  if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) return text
  return text.replace(GREETING_RE, (m) => `${m} ${name}`)
}

function dropTrailingQuestion(text: string): string {
  // Ton « direct » : on retire la DERNIÈRE phrase si c'est une relance
  // (« … Et toi ? », « Tu veux un exemple ? »). La phrase précédente est
  // conservée ; si elle est trop courte (« Bien sûr ! »), on ne coupe pas.
  const m = text.match(/([^.!?…]*\?)\s*$/)
  if (!m || m.index === undefined) return text
  const sentence = m[1]
  if (!/^\s*(?:Et|Tu veux|On reprend|Dis-moi|Qu'?est-ce|Est-ce|Comment ça|Ça te|Vous|As-tu)\b/i.test(sentence)) return text
  const kept = text.slice(0, m.index).trim()
  return kept.length >= 8 ? kept : text
}

/**
 * Adapte une réponse RETROUVÉE (pas générée) à la personne.
 * Ne crée aucun fait : uniquement le prénom, la continuité, le nom de
 * l'assistant et le ton — le fond reste celui du savoir retrouvé.
 */
export function personalizeServed(text: string, opts: PersonalizeOptions): string {
  const persona = opts.persona
  let out = String(text ?? '').trim()
  if (!persona || !out) return out

  // 1. Nom choisi pour l'assistant (présentation de soi).
  if (persona.assistantName && persona.assistantName.toLowerCase() !== 'nexus') {
    out = out.replace(/\bNEXUS\b/g, persona.assistantName)
  }

  const isGreeting = opts.topic === 'salutations' && GREETING_RE.test(out)
  const isThanks = opts.topic === 'salutations' && THANKS_RE.test(out)

  // 2. Prénom dans la salutation / le remerciement.
  if ((isGreeting || isThanks) && persona.userName) out = withName(out, persona.userName)

  // 3. Continuité entre sessions : le premier message d'une nouvelle
  //    conversation rappelle le sujet de la précédente.
  if (isGreeting && opts.firstTurn && persona.lastTopic) {
    const topic = persona.lastTopic.replace(/[.!?]+$/, '')
    if (/De quoi on parle aujourd'hui \?/i.test(out)) {
      out = out.replace(/De quoi on parle aujourd'hui \?/i, `On reprend sur « ${topic} » ?`)
    } else if (/Tu veux discuter ou travailler sur quelque chose \?/i.test(out)) {
      out = out.replace(/Tu veux discuter ou travailler sur quelque chose \?/i, `On reprend sur « ${topic} » ?`)
    } else {
      out = `${out.replace(/\s+$/, '')} On reprend sur « ${topic} » ?`
    }
  }

  // 3 bis. Aucune conversation enregistrée (titre absent) mais l'historique
  //        contient déjà un échange : on peut quand même reprendre le fil.
  if (isGreeting && opts.firstTurn && !persona.lastTopic && opts.lastTalk) {
    const topic = opts.lastTalk.replace(/[.!?]+$/, '')
    if (/De quoi on parle aujourd'hui \?/i.test(out)) {
      out = out.replace(/De quoi on parle aujourd'hui \?/i, `On reprend sur « ${topic} » ?`)
    }
  }

  // 4. Premier contact : demander le prénom (une seule fois, il sera retenu).
  if (isGreeting && opts.firstTurn && persona.isFirstEver && !persona.userName) {
    out = `${out.replace(/\s+$/, '')} Au fait, comment tu t'appelles ? Je le retiendrai pour la prochaine fois.`
  }

  // 5. Prénom devant un aveu : « Camille, je ne trouve pas ça dans ma base. »
  //    Un seul point de contact, et seulement quand NEXUS avoue ne pas savoir.
  if (persona.userName && !out.includes(persona.userName) && /^(Je ne (?:sais|trouve|trouve pas)|Je n'ai (?:pas|rien))/.test(out) && out.length < 320) {
    out = `${persona.userName}, ${out.charAt(0).toLowerCase()}${out.slice(1)}`
  }

  // 6. Ton demandé.
  if (persona.tone === 'direct') out = dropTrailingQuestion(out)

  // 7. Ne pas resservir exactement la même phrase que le tour précédent.
  const prev = String(opts.previousAnswer ?? '').trim()
  if (prev && prev === out) out = `Comme je te disais : ${out.charAt(0).toLowerCase()}${out.slice(1)}`

  return out.trim()
}
