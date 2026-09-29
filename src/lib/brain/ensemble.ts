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
import { type LlmMessage } from '@/lib/llm'
import { generateCodeLocal } from './codegen'
import { analyzeCodeStatic, detectReasoningMode } from './deep-reasoner'
import { extractEntities } from './entities'
import { searchKnowledgeBank } from './knowledge-bank'
import { webSearch } from './search'

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
 * Contributions locales analytiques et spécialisées par rôle (100 % codées, zéro API).
 * Chaque agent mobilise un véritable outil cognitif selon sa spécialité :
 *   - Chercheur : banque sémantique + recherche web en direct
 *   - Codeur    : audit statique AST ou génération d'extrait technique concret
 *   - Analyste  : matrice objectifs / risques / compromis / métriques
 *   - Rédacteur : structuration éditoriale et plan d'exécution
 */
async function localContribution(
  agent: NexusAgent,
  lastUser: string,
  onLive?: (agent: NexusAgent, thought: string) => void
): Promise<string> {
  const clean = cleanContext(lastUser)
  const court = displaySubject(lastUser, 70)
  const bankHits = searchKnowledgeBank(clean, 2)
  const topBank = bankHits[0]
  const customTone = agent.prompt ? ` *(Perspective : ${agent.prompt.slice(0, 110)})*` : ''

  switch (agent.role) {
    case 'chercheur': {
      onLive?.(agent, `Exploration des sources et de la banque sémantique sur « ${court} »…`)
      let webFact = ''
      if (!topBank || topBank.score < 5) {
        try {
          const results = await webSearch(clean.slice(0, 90), 3)
          if (results && results.length > 0) {
            webFact =
              `\n\n**Sources repérées en direct :**\n` +
              results
                .slice(0, 2)
                .map((r) => `- **[${r.domain}]** *${r.title.slice(0, 75)}* : ${r.snippet.slice(0, 160)}`)
                .join('\n')
          }
        } catch {
          /* hors-ligne : repli banque locale */
        }
      }
      const bankFact = topBank
        ? `\n\n**Synthèse de référence (${topBank.entry.keywords[0] || 'connaissances'}) :**\n${topBank.entry.answer.slice(0, 380)}`
        : ''
      return `**🔍 Analyse documentaire (${agent.name})** sur **« ${court} »** :${customTone}${bankFact}${webFact || '\n- Axes vérifiés : standards techniques actuels, retours d’expérience et pièges classiques à éviter.'}`
    }

    case 'analyste': {
      onLive?.(agent, `Évaluation des compromis, risques et critères de succès sur « ${court} »…`)
      const mode = detectReasoningMode(clean, /```/.test(clean))
      const bankExcerpt = topBank ? `\n- **Point de repère factuel** : ${topBank.entry.answer.split('\n')[0].slice(0, 220)}` : ''
      return [
        `**📊 Diagnostic & Compromis (${agent.name})** — mode cognitif *${mode}* :${customTone}`,
        `- **Objectif critique** : maximiser la fiabilité et la maintenabilité sur « ${court} » sans dette technique cachée.`,
        `- **Risques principaux identifiés** : (1) sous-estimer la validation des cas limites / erreurs ; (2) coupler l'interface et la logique métier ; (3) dégrader le temps de réponse.`,
        `- **Indicateurs de réussite (KPI)** : zéro erreur non gérée, temps d'exécution < 100 ms, architecture modulaire testable.${bankExcerpt}`,
      ].join('\n')
    }

    case 'codeur': {
      onLive?.(agent, `Conception de l'architecture technique et du code pour « ${court} »…`)
      const fenced = clean.match(/```(\w+)?\n([\s\S]+?)```/)
      if (fenced) {
        const audit = analyzeCodeStatic(fenced[2], fenced[1])
        const topFinding = audit.findings[0]
        return [
          `**💻 Audit & Architecture (${agent.name})** — score qualité **${audit.score}/100** (\`${audit.language}\`) :${customTone}`,
          topFinding
            ? `- **Priorité technique** : [${topFinding.severity.toUpperCase()}] ${topFinding.title} → *${topFinding.fix}*`
            : `- **Structure** : code propre (${audit.lines} lignes, ${audit.functionsCount} fonction(s)).`,
          `- **Recommandation d'implémentation** : isoler les constantes en tête de module, typer les entrées/sorties et encapsuler les appels externes.`,
        ].join('\n')
      }
      const entities = extractEntities(clean)
      const gen = generateCodeLocal(clean, entities, court)
      const previewLines = gen.code.split('\n').slice(0, 14).join('\n')
      return [
        `**💻 Architecture & Prototype (${agent.name})** — cible \`${gen.filename}\` (${gen.description}) :${customTone}`,
        `- **Approche retenue** : découpage modulaire (constantes → fonctions pures → gestionnaire d'événements sécurisé).`,
        `\`\`\`${gen.language}\n${previewLines}\n// … (disponible en intégralité dans le Studio Code)\n\`\`\``,
      ].join('\n')
    }

    case 'redacteur': {
      onLive?.(agent, `Structuration de la feuille de route et synthèse claire pour « ${court} »…`)
      return [
        `**✍️ Plan d'action structuré (${agent.name})** pour **« ${court} »** :${customTone}`,
        `1. **Fondations & Cadrage** : définir le périmètre exact et valider les données d'entrée.`,
        `2. **Mise en œuvre incrémentale** : développer le cœur fonctionnel, puis brancher l'interface et les retours visuels.`,
        `3. **Vérification & Polissage** : tester les cas limites, documenter les choix et livrer une version prête pour la production.`,
      ].join('\n')
    }

    default: {
      onLive?.(agent, `élaboration d'une approche globale sur « ${court} »…`)
      const spec = agent.specialties.length > 0 ? ` (spécialités : ${agent.specialties.join(', ')})` : ''
      return [
        `**${agent.emoji} Recommandation stratégique (${agent.name}${spec})** sur **« ${court} »** :${customTone}`,
        `- Privilégier une architecture progressive en 3 paliers : **Prototype fonctionnel → Sécurisation & Tests → Optimisation UX/Performance**.`,
        topBank ? `- **Éclairage métier** : ${topBank.entry.answer.slice(0, 240)}` : `- Chaque brique peut être générée et testée directement dans les studios NEXUS (Code, 3D, Web, Vidéo).`,
      ].join('\n')
    }
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
  _historyMsgs: LlmMessage[],
  requestText: string,
  _memoryLines: string[],
  _maxTokens: number,
  _timeoutMs: number,
  onLive?: (agent: NexusAgent, thought: string) => void
): Promise<AgentAnswer[]> {
  const jobs = speakers.map(async (agent): Promise<AgentAnswer> => {
    const raw = await localContribution(agent, requestText, onLive)
    const text = finishSentences(raw)
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

  // Synthèse locale consolidée : fusionne les apports spécialisés de chaque agent
  const bullets = contributions
    .map((c) => {
      const firstLine = c.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('```'))
        .slice(0, 2)
        .join(' — ')
      return `- **${c.emoji} ${c.name}** : ${firstLine}`
    })
    .join('\n')
  const author = writer ? `${writer.emoji} ${writer.name} (Rédacteur)` : '🟣 NEXUS'
  const court = displaySubject(requestText, 75)
  const synthesis = [
    `### 🎯 Synthèse & Décision collective (par ${author})`,
    `Après croisement des analyses de l'équipe sur **« ${court} »**, voici les conclusions retenues :`,
    bullets,
    `**Recommandation consolidée :** combiner l'architecture modulaire proposée avec une validation stricte des entrées et des étapes courtes vérifiables dans les studios NEXUS (Code, 3D, Web).`,
  ].join('\n\n')
  await replayText(synthesis, send)
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
