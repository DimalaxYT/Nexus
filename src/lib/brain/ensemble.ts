// ─── NEXUS Brain — Ensemble : table ronde multi-agents + BUREAU ───────────────
// Deux façons de parler à plusieurs agents :
//   TABLE RONDE (« tous les agents » / un groupe) :
//     1. Tous les agents réfléchissent EN PARALLÈLE (vitesse = le plus lent,
//        pas la somme de tous).
//     2. Chaque agent intervient DANS SA PROPRE BULLE avec sa personnalité
//        (son prompt personnel), sa perspective de rôle, sans redites.
//     3. NEXUS clôt avec une SYNTHÈSE qui fusionne le meilleur des contributions.
//   BUREAU (nouveau) :
//     1. Les agents réfléchissent TOUS ensemble en parallèle, en coulisses.
//     2. L'utilisateur ne voit qu'UNE SEULE réponse : la réponse consolidée
//        de NEXUS, qui tranche et livre le résultat du conseil.
// Chaque tour est isolé : si un agent échoue (LLM indisponible…), il répond
// avec sa perspective locale et le collectif continue.

import type { AgentEvent, NexusAgent } from '@/lib/nexus-types'
import { ROLE_LABELS } from '@/lib/nexus-types'
import { llmStream, type LlmMessage } from '@/lib/llm'
import { searchKnowledgeBank } from './knowledge-bank'

export type Emit = (event: AgentEvent) => void

const MAX_TABLE_SPEAKERS = 4 // table ronde : au-delà, les agents suivants attendent la prochaine question
const MAX_BUREAU_MEMBERS = 6 // bureau : plus de cerveaux en coulisses (réponse unique)

export interface EnsembleInput {
  messages: { role: 'user' | 'assistant'; content: string }[]
  lastUser: string
  /** Demande enrichie du contexte de suivi (« réalise-le » → sujet précédent). */
  contextHint?: string
  agents: NexusAgent[] // participants DÉJÀ filtrés (enabled, membres du groupe si groupe)
  send: Emit
}

export const NEXUS_SPEAKER = { id: 'nexus', name: 'NEXUS', emoji: '🟣', color: '#a78bfa' }

/**
 * Purge les méta-commentaires de suivi (« [Suivi : …] », « [Ta dernière réponse …] »)
 * que resolveFollowUp ajoute à la demande : ils servent au LLM mais ne doivent
 * JAMAIS être recopiés dans les contributions affichées ni dans les sujets.
 */
export function cleanContext(text: string): string {
  return text
    .replace(/\s*\[(?:Suivi|Ta dernière réponse|Mémo)[^\]]*\]\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Sujet propre pour affichage : méta-commentaires purgés, coupe aux MOTS (jamais en plein mot). */
function displaySubject(text: string, max = 140): string {
  const clean = cleanContext(text)
  if (clean.length <= max) return clean
  const cut = clean.lastIndexOf(' ', max)
  return `${clean.slice(0, cut > 40 ? cut : max).trimEnd()}…`
}

/** Prompt système d'un agent pour qu'il parle avec SA personnalité. */
export function personaSystemPrompt(agent: NexusAgent, memoryLines: string[]): string {
  const specialties = agent.specialties.length > 0 ? agent.specialties.join(', ') : 'polyvalent'
  const roleLine =
    agent.role === 'codeur'
      ? `Rôle : ${ROLE_LABELS.codeur} — tu programmes (éditeur de code), tu construis des scènes 3D et tu navigues sur le web pour lire la documentation. Tu ne génères PAS d'images, tu ne gères NI les missions NI la mémoire.`
      : `Rôle : ${ROLE_LABELS[agent.role] ?? agent.role} · Spécialités : ${specialties}.`
  return [
    `Tu es ${agent.emoji} ${agent.name}, un agent de l'équipe NEXUS créé par l'utilisateur.`,
    roleLine,
    agent.description ? `Sa fiche : ${agent.description}` : '',
    agent.prompt
      ? `PROMPT PERSONNEL rédigé par ton créateur — il définit TA personnalité, TON ton et TA façon de répondre, respecte-le au maximum :\n"""\n${agent.prompt}\n"""`
      : 'Ton ton est naturel, sympathique et efficace.',
    'Tu réponds TOUJOURS en français et tu tutoies l\'utilisateur. Tu ne te présentes pas, tu ne salue pas : tu vas droit au sujet avec TA perspective.',
    'CONTRIBUE avec du CONTENU RÉEL : faits, plan concret, arguments, exemple ou code — jamais une simple annonce de ce que tu POURRAIS faire (« je peux chercher… », « dès que tu valides je… ») : c\'est interdit. Réponds à la demande comme si ta contribution était la réponse finale.',
    'Tu es dans une discussion d\'équipe avec d\'autres agents : apporte ton angle unique en 2 à 5 phrases COMPLÈTES maximum (termine toujours ta phrase), sans markdown lourd (des phrases fortes, éventuellement 1 liste courte).',
    memoryLines.length > 0 ? `Mémoire de l'équipe sur l'utilisateur :\n${memoryLines.map((m) => `- ${m}`).join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Replis locaux RICHES : si le LLM est indisponible, chaque agent apporte quand
 * même de la VRAIE substance (pas une annonce de service). Ancré sur le sujet,
 * purgé des méta-commentaires, coupé aux mots.
 */
function localContribution(agent: NexusAgent, lastUser: string): string {
  const sujet = displaySubject(lastUser)
  const court = displaySubject(lastUser, 60)
  const bank = searchKnowledgeBank(cleanContext(lastUser), 1)[0]
  const bankLine = bank ? ` Base utile déjà en stock : ${bank.entry.answer.slice(0, 220)}` : ''
  switch (agent.role) {
    case 'chercheur': {
      const mots = court.split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(' ') || court
      return `Angle chercheur — 3 pistes concrètes à creuser sur « ${court} » : (1) les bonnes pratiques actuelles, en cherchant « ${mots} guide 2026 » ; (2) des exemples réels réussis, avec « ${mots} exemple » ; (3) les erreurs fréquentes à éviter, avec « ${mots} erreurs conseils ». Je peux lancer ces recherches immédiatement et rapporter les sources.${bankLine}`
    }
    case 'analyste':
      return `Angle analyste — décomposition de « ${court} » : l'objectif principal, les contraintes à respecter (budget, temps, audience), les 2 ou 3 critères qui feront que le résultat est réussi, et les risques (trop d'ambition d'un coup, manque de sources fiables).${bankLine ? ` Mon analyse rapide : ${bank.entry.answer.slice(0, 240)}` : " Donne-moi des détails et je produit l'analyse complète, point par point."}`
    case 'redacteur':
      return `Angle rédacteur — voici une première ossature concrète pour « ${court} » : une introduction qui pose l'objectif, 3 sections structurées (contexte, contenu principal, recommandations), et une conclusion actionnable. Je fusionne ensuite les apports de l'équipe en un texte propre et prêt à l'emploi.${bankLine}`
    case 'codeur':
      return `Angle codeur — approche technique pour « ${court} » : structure en petites fonctions testables, nommage clair, commentaires utiles, et une version v1 simple qu'on enrichit ensuite. Dis-moi le langage visé (Python, JS/TS, Lua/Roblox, page web…) et je produis le code complet dans l'éditeur — en PROPOSITION que tu valides avant toute modification.`
    default:
      return `Angle spécialiste — sur « ${court} », mon conseil : commencer simple (un plan en 3 étapes), valider chaque étape, puis approfondir ce qui marche. Je peux enchaîner sur le volet web, 3D ou organisation selon ton choix.${bankLine}`
  }
}

/**
 * Garantit des PHRASES COMPLÈTES : si le texte s'arrête en plein milieu d'une
 * phrase (quota de tokens atteint…), on rabote au dernier point final pour ne
 * jamais afficher une fin tronquée. Referme aussi les blocs de code orphelins.
 */
function finishSentences(text: string): string {
  let t = text.trim()
  if (!t) return t
  // Bloc de code ouvert mais jamais fermé → on le referme proprement
  const fences = (t.match(/```/g) ?? []).length
  if (fences % 2 === 1) t += '\n```'
  // Déjà terminée par une ponctuation de phrase (tolère guillemets/parenthèses)
  if (/[.!?…]["'»”)]?$/.test(t) || t.endsWith('---') || t.endsWith('```')) return t
  // Dernière frontière de phrase exploitable
  const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '), t.lastIndexOf('… '), t.lastIndexOf('.\n'))
  if (cut >= 40) return t.slice(0, cut + 1).trimEnd()
  return t // pas de frontière fiable : mieux vaut une phrase courte qu'un texte perdu
}

/** Découpe un texte en paquets larges, streamés très vite (replay fluide). */
async function replayText(text: string, send: Emit): Promise<void> {
  const chunks = text.match(/\S+\s*/g) ?? [text]
  let buffer = ''
  for (let i = 0; i < chunks.length; i++) {
    buffer += chunks[i]
    if (buffer.length >= 60 || i === chunks.length - 1) {
      send({ type: 'token', content: buffer })
      buffer = ''
      if (i < chunks.length - 1) await sleep(4)
    }
  }
}

interface AgentAnswer {
  agent: NexusAgent
  text: string
}

/** Demande SA réponse à chaque agent, TOUS EN PARALLÈLE (mémoires partagées).
 *  onLive : pensée EN DIRECT de chaque agent (throttlée) — alimente les
 *  cerveaux 3D pendant que le collectif réfléchit (status « thinking »). */
async function askAllAgents(
  speakers: NexusAgent[],
  historyMsgs: LlmMessage[],
  requestText: string,
  memoryLines: string[],
  maxTokens: number,
  timeoutMs: number,
  onLive?: (agent: NexusAgent, thought: string) => void
): Promise<AgentAnswer[]> {
  const jobs = speakers.map(async (agent): Promise<AgentAnswer> => {
    let text = ''
    const system = personaSystemPrompt(agent, memoryLines)
    // Throttle des pensées live : 1 envoi max / 900 ms par agent, dernier
    // fragment de phrase affiché (le cerveau 3D « pense » en continu).
    let liveBuf = ''
    let liveAt = 0
    const pushLive = (chunk: string) => {
      if (!onLive) return
      liveBuf = `${liveBuf}${chunk}`.slice(-260)
      const now = Date.now()
      if (now - liveAt < 900) return
      liveAt = now
      const frag = lastClause(liveBuf)
      if (frag) onLive(agent, frag)
    }
    const streamed = await llmStream(
      [
        {
          role: 'system',
          content: `${system}\n\nRéponds directement à la demande de l'utilisateur. Pas d'outil, pas de JSON, pas de préambule : uniquement ta contribution (${agent.name}). Termine toujours ta phrase.`,
        },
        ...historyMsgs,
        { role: 'user', content: requestText.slice(0, 2000) },
      ],
      (chunk) => pushLive(chunk), // live pour les cerveaux 3D (le replay suit l'ordre)
      { timeoutMs, maxTokens, thinking: false }
    )
    text = finishSentences(streamed ?? '')
    if (!text) text = localContribution(agent, requestText)
    return { agent, text }
  })
  return Promise.all(jobs)
}

/** Dernière clause « affichable » d'un flux partiel (coupe propre aux mots). */
function lastClause(buffer: string): string {
  const clean = cleanContext(buffer).trim()
  if (!clean) return ''
  const m = clean.match(/[^.!?…]*[.!?…]\s*[^.!?…]*$/)
  const frag = (m?.[0] ?? clean).trim()
  return frag.length > 12 ? frag.slice(-180) : ''
}

/** Table ronde : bulles une par une (replay), puis synthèse (rédacteur ou NEXUS). */
async function runTableRonde(input: EnsembleInput): Promise<void> {
  const { messages, lastUser, agents, send } = input
  const speakers = agents.slice(0, MAX_TABLE_SPEAKERS)
  const requestText = input.contextHint || lastUser

  // Contexte partagé : les derniers échanges + la question courante
  const historyMsgs: LlmMessage[] = messages
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1600) }))
  const memoryLines = await loadMemoryLines()

  send({ type: 'thought', text: `Table ronde : ${speakers.length} agent${speakers.length > 1 ? 's' : ''} réfléchissent en parallèle avec leur personnalité, puis la synthèse est rédigée.` })

  // ── Tous les agents réfléchissent EN MÊME TEMPS ─────────────────────────────
  const answers = await askAllAgents(
    speakers,
    historyMsgs,
    requestText,
    memoryLines,
    900,
    30_000,
    (agent, thought) =>
      send({ type: 'agent_thought', name: agent.name, emoji: agent.emoji, color: agent.color, text: thought })
  )

  // ── Replay dans l'ordre : une bulle par agent (déjà prêtes → enchaîné vite) ─
  const contributions: { name: string; emoji: string; text: string }[] = []
  for (const { agent, text } of answers) {
    send({ type: 'speaker', ...speakerOf(agent) })
    send({ type: 'thought', text: `${agent.emoji} ${agent.name} (${ROLE_LABELS[agent.role]}) apporte son angle à la table ronde.` })
    await replayText(text, send)
    contributions.push({ name: agent.name, emoji: agent.emoji, text })
  }

  await syntheseCollective(contributions, lastUser, requestText, send, 'la table ronde', speakers, true)
}

/** BUREAU : les agents délibèrent, leurs échanges sont visibles, puis UNE réponse. */
async function runBureau(input: EnsembleInput): Promise<void> {
  const { messages, lastUser, agents, send } = input
  const members = agents.slice(0, MAX_BUREAU_MEMBERS)
  const requestText = input.contextHint || lastUser

  const historyMsgs: LlmMessage[] = messages
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1600) }))
  const memoryLines = await loadMemoryLines()

  const step = { id: `bureau-${Date.now()}`, tool: 'system' as const, label: 'Bureau — délibération de l\'équipe', detail: `${members.length} agent${members.length > 1 ? 's' : ''} réfléchissent en parallèle` }
  send({ type: 'step', ...step, status: 'running' })
  send({ type: 'thought', text: `Je convoque le bureau : ${members.map((a) => `${a.emoji} ${a.name}`).join(', ')} réfléchissent ensemble en coulisses. Tu verras TOUT ce qu'ils échangent, puis la réponse consolidée.` })

  // Délibération : les agents travaillent en parallèle (pas de bulle par agent)
  const answers = await askAllAgents(
    members,
    historyMsgs,
    requestText,
    memoryLines,
    900,
    30_000,
    (agent, thought) =>
      send({ type: 'agent_thought', name: agent.name, emoji: agent.emoji, color: agent.color, text: thought })
  )

  // TRANSPARENCE TOTALE : les échanges complets, mot pour mot, partent au
  // client (panneau « ce qu'ils échangent ») — JAMAIS tronqués.
  const deliberation = answers.map(({ agent, text }) => ({
    name: agent.name,
    emoji: agent.emoji,
    color: agent.color,
    text,
  }))
  send({ type: 'deliberation', entries: deliberation })

  send({ type: 'step', ...step, tool: 'system', label: step.label, detail: `${answers.filter((a) => a.text).length} contributions · échanges visibles · réponse consolidée`, status: 'done' })

  const contributions = answers.map(({ agent, text }) => ({ name: agent.name, emoji: agent.emoji, text }))
  await syntheseCollective(contributions, lastUser, requestText, send, 'le bureau', members, false)
}

/**
 * Synthèse finale du collectif : fusion des contributions en UNE réponse.
 * RÈGLE DU RÉDACTEUR : si un agent désigné « ✍️ rédacteur » participe, c'est
 * LUI qui rédige la réponse finale (avec sa personnalité) — sinon NEXUS reprend
 * les idées des agents et les fusionne.
 */
async function syntheseCollective(
  contributions: { name: string; emoji: string; text: string }[],
  lastUser: string,
  requestText: string,
  send: Emit,
  source: string,
  participants: NexusAgent[],
  announceSpeaker: boolean
): Promise<void> {
  // Le rédacteur désigné parmi les participants (sinon un rôle « rédacteur »,
  // sinon NEXUS assure la fusion comme d'habitude).
  const writer = participants.find((a) => a.writer) ?? participants.find((a) => a.role === 'redacteur') ?? null
  if (writer) {
    send({ type: 'speaker', ...speakerOf(writer) })
    send({ type: 'thought', text: `✍️ ${writer.name} est le rédacteur : il reprend les idées de l'équipe et rédige la réponse finale.` })
  } else if (announceSpeaker) {
    // Table ronde sans rédacteur : on ouvre une NOUVELLE bulle au nom de NEXUS
    // (sinon elle s'ajoute à la dernière bulle d'agent). Bureau : pas de switch,
    // la réponse unique appartient déjà à NEXUS.
    send({ type: 'speaker', ...NEXUS_SPEAKER })
  }
  const transcript = contributions
    .map((c) => `${c.emoji} ${c.name} : ${c.text.slice(0, 900)}`)
    .join('\n\n')

  const identity = writer
    ? `Tu es ${writer.emoji} ${writer.name}, le RÉDACTEUR de l'équipe${writer.prompt ? `, avec ta personnalité : « ${writer.prompt.slice(0, 300)} »` : ''}.`
    : 'Tu es NEXUS, le coordinateur de l\'équipe d\'agents.'
  const synthesisSystem = [
    `${identity} Tu réponds en français, tutoies l'utilisateur.`,
    `L'équipe vient de délibérer (${source}) à la demande de l'utilisateur. Notes de chaque agent :\n${transcript}`,
    writer
      ? 'REPENDS les idées des autres agents, fusionne-les avec les tiennes et rédige TA réponse finale — c\'est toi, le rédacteur, qui écris ce que l\'utilisateur lira.'
      : 'Rédige MAINTENANT la réponse finale en markdown (6 à 10 lignes COMPLÈTES) :',
    'Structure attendue (6 à 12 lignes COMPLÈTES) :',
    '1. Une phrase qui fusionne le meilleur des contributions (cite les agents avec leur emoji si pertinent).',
    '2. La recommandation concrète de l\'équipe — tranche, ne reste pas vague, réponds VRAIMENT à la demande (avec du contenu : plan, étapes, arguments).',
    '3. La prochaine action proposée à l\'utilisateur (une seule, précise).',
    'Sans JSON, sans remercier, sans répétition mot à mot des contributions. Termine toujours tes phrases.',
  ].join('\n\n')

  const streamed = await llmStream(
    [
      { role: 'system', content: synthesisSystem },
      { role: 'user', content: cleanContext(requestText).slice(0, 1600) },
    ],
    (chunk) => send({ type: 'token', content: chunk }),
    { timeoutMs: 45_000, maxTokens: 1200 }
  )

  if (!streamed || !streamed.trim()) {
    // Synthèse locale : fusionner les premières phrases de chaque contribution
    // (texte riche : 2 phrases par agent, pas de coupure artificielle)
    const bullets = contributions
      .map((c) => {
        const sentences = c.text.split(/(?<=[.!?])\s/).slice(0, 2).join(' ')
        return `- **${c.emoji} ${c.name}** : ${sentences}`
      })
      .join('\n')
    const author = writer ? `${writer.emoji} ${writer.name}` : 'NEXUS'
    const synthesis = `**Synthèse de l'équipe** (rédigée par ${author}) — voici l'essentiel à retenir :\n\n${bullets}\n\n**Prochaine action :** dis-moi quelle piste tu veux creuser et je la lance immédiatement (recherche web, mission Task, code, image…).`
    await replayText(synthesis, send)
    return
  }
  // Le LLM a déjà streamé en direct : on ne peut pas raboter rétroactivement,
  // mais le quota large (1200) rend les coupures rares.
}

/** Point d'entrée : lance le collectif selon le mode choisi. */
export async function runEnsemble(
  input: EnsembleInput,
  mode: 'table' | 'bureau' = 'table'
): Promise<void> {
  if (input.agents.length === 0) {
    input.send({ type: 'token', content: 'Aucun agent actif dans cette cible — recrute des agents dans le panneau **Équipe**, puis redemande !' })
    return
  }
  if (mode === 'bureau') await runBureau(input)
  else await runTableRonde(input)
}

function speakerOf(agent: NexusAgent): { id: string; name: string; emoji: string; color: string } {
  return { id: agent.id, name: agent.name, emoji: agent.emoji, color: agent.color }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function loadMemoryLines(): Promise<string[]> {
  try {
    const { db } = await import('@/lib/db')
    const rows = await db.memory.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { content: true } })
    return rows.map((r) => r.content)
  } catch {
    return []
  }
}
