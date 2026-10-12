// ─── NEXUS Brain — compréhension des demandes de suivi ───────────────────────
// Résout les anaphores courantes (« code-le », « vas-y », « pourquoi ? ») à
// partir des derniers tours, sans envoyer l'historique à un service distant.

import { classify } from './classifier'
import type { IntentLabel } from './dataset'
import { normalize } from './text'

export interface ContextualRequest {
  /** Formulation explicite qui peut être routée par le cerveau local ou un LLM. */
  requestText: string
  /** Sujet originel, conservé séparément pour éviter de le diluer dans la directive. */
  subject: string
  /** Intention retenue lorsqu'un suivi apporte un signal plus fort que le classifieur. */
  intent: IntentLabel
  /** Langage explicitement choisi dans un suivi du type « et en Python ? ». */
  language?: string
  reason: string
}

const ACTION_INTENTS = new Set<IntentLabel>([
  'search',
  'readpage',
  'code',
  'image',
  'scene3d',
  'webpage',
  'video',
  'math',
  'task',
  'knowledge_save',
  'knowledge_query',
])

const SOCIAL_INTENTS = new Set<IntentLabel>(['greeting', 'farewell', 'thanks', 'howareyou'])
const PREFIX = '(?:(?:ok|alors|bon|ben|et)\s+)*'
const PRONOUN = '(?:le|la|les|ca|cela|ceci|tout|ça)'

function normalizeFollowUp(text: string): string {
  return normalize(text.replace(/c#/gi, 'csharp'))
}

/** Une phrase de suivi est volontairement courte : une demande complète ne passe jamais ici. */
function isFollowUp(text: string): boolean {
  if (text.length > 110) return false
  const t = normalizeFollowUp(text)
  return (
    new RegExp(`^${PREFIX}(?:vas[- ]?y|go|fais(?:[- ]${PRONOUN})?|realise(?:[- ]${PRONOUN})?|execute(?:[- ]${PRONOUN})?|implemente(?:[- ]${PRONOUN})?|lance(?:[- ]${PRONOUN})?|termine(?:[- ]${PRONOUN})?|continue|fonce|c[' ]est parti|maintenant)(?:\s+(?:stp|svp))?$`).test(t) ||
    new RegExp(`^${PREFIX}(?:code|ecris|programme|developpe|implemente|corrige|refactorise|optimise)(?:[- ]${PRONOUN})?$`).test(t) ||
    new RegExp(`^${PREFIX}(?:cherche|recherche|approfondis|verifie|lis|ouvre|resume|visite)(?:[- ]${PRONOUN})?$`).test(t) ||
    new RegExp(`^${PREFIX}(?:dessine|illustre|genere|cree|construis|modelise)(?:[- ]${PRONOUN})?$`).test(t) ||
    /^(?:et )?(?:pourquoi|comment|explique(?: moi)?|detaille|developpe(?: un peu)?)(?: ca| cela| le| la| les)?[.!? ]*$/.test(t) ||
    /^(?:une autre|une autre version|variante|refais(?: le| la| les| ca)?|encore une fois)[.!? ]*$/.test(t) ||
    /^(?:et )?(?:en|version) (?:python|lua|luau|javascript|typescript|csharp|c\+\+|java|rust|go|bash|sql)[.!? ]*$/.test(t)
  )
}

function detectExplicitAction(text: string, previousIntent: IntentLabel): IntentLabel | null {
  const t = normalize(text)
  if (/^(?:ok |alors )?(?:code|ecris|programme|developpe|implemente)(?:[- ](?:le|la|les|ca|cela|ceci))?$/.test(t)) return 'code'
  if (/^(?:ok |alors )?(?:cherche|recherche|approfondis|verifie)(?:[- ](?:le|la|les|ca|cela|ceci))?$/.test(t)) return 'search'
  if (/^(?:ok |alors )?(?:dessine|illustre)(?:[- ](?:le|la|les|ca|cela|ceci))?$/.test(t)) return 'image'
  if (/^(?:ok |alors )?(?:lis|ouvre|resume|visite)(?:[- ](?:le|la|les|ca|cela|ceci))?$/.test(t)) return 'readpage'

  // « génère-la » ou « crée-le » prend le sens du sujet précédent (vidéo, page,
  // image…), au lieu de choisir arbitrairement un type de création.
  if (/^(?:ok |alors )?(?:genere|cree|construis|modelise)(?:[- ](?:le|la|les|ca|cela|ceci))?$/.test(t)) {
    if (['image', 'scene3d', 'webpage', 'video', 'code'].includes(previousIntent)) return previousIntent
    if (/\b(?:construis|modelise)\b/.test(t)) return 'scene3d'
    return null
  }

  return null
}

function detectAssistantOffer(reply: string): IntentLabel | null {
  const tail = normalize(reply.slice(-1100))
  // N'accepter que des propositions explicites, pas la simple présence d'un
  // mot (« code », « image »…) dans une liste générale de capacités.
  if (/\b(?:code[- ]le|ecris[- ]le|programme[- ]le|implemente[- ]le|genere l implementation complete)\b/.test(tail)) return 'code'
  if (/\b(?:je te fais|je peux te faire|je te genere)\s+(?:un |le )?script\b/.test(tail)) return 'code'
  if (/\b(?:je te fais|je peux te faire|je te genere)\s+(?:une |la )?page (?:web|html)|\bcreer (?:un |le )?site\b/.test(tail)) return 'webpage'
  if (/\b(?:je te fais|je peux te faire|je te genere)\s+(?:une |la )?image\b/.test(tail)) return 'image'
  if (/\b(?:je te fais|je peux te faire|je te genere)\s+(?:une |la )?video\b/.test(tail)) return 'video'
  if (/\b(?:je te construis|je peux te construire|je te modelise)\s+(?:une |la )?scene(?: 3d)?\b/.test(tail)) return 'scene3d'
  if (/\b(?:je lance|je peux lancer|lance) (?:une )?recherche\b/.test(tail)) return 'search'
  return null
}

function isClarification(text: string): boolean {
  const t = normalize(text)
  return /^(?:et )?(?:pourquoi|comment|explique(?: moi)?|detaille|developpe(?: un peu)?)(?: ca| cela| le| la| les)?[.!? ]*$/.test(t)
}

function isVariation(text: string): boolean {
  const t = normalize(text)
  return /^(?:une autre|une autre version|variante|refais(?: le| la| les| ca)?|encore une fois)[.!? ]*$/.test(t)
}

function languageFromFollowUp(text: string): string | null {
  const m = normalizeFollowUp(text).match(/^(?:et )?(?:en|version) (python|lua|luau|javascript|typescript|csharp|c\+\+|java|rust|go|bash|sql)[.!? ]*$/)
  if (!m) return null
  if (m[1] === 'luau') return 'Luau'
  if (m[1] === 'csharp') return 'C#'
  return m[1].charAt(0).toUpperCase() + m[1].slice(1)
}

function actionableRequest(intent: IntentLabel, subject: string): string {
  const lead: Partial<Record<IntentLabel, string>> = {
    search: 'Recherche sur le web la demande suivante',
    readpage: 'Lis et résume la page demandée précédemment',
    code: 'Écris le code complet correspondant à la demande précédente',
    image: 'Génère une image correspondant à la demande précédente',
    scene3d: 'Crée une scène 3D correspondant à la demande précédente',
    webpage: 'Crée une page web correspondant à la demande précédente',
    video: 'Génère une vidéo correspondant à la demande précédente',
    math: 'Calcule de nouveau la demande précédente',
    task: 'Reprends la mission demandée précédemment',
    knowledge_save: 'Enregistre la demande précédente dans la base de connaissances',
    knowledge_query: 'Recherche dans la base de connaissances sur le sujet précédent',
  }
  return `${lead[intent] ?? 'Reprends la demande précédente'} : ${subject}`
}

/**
 * Résout les suivis courts en contexte. Retourne null pour une demande normale,
 * ou lorsqu'il n'existe aucun sujet précédent exploitable.
 */
export function resolveContextualRequest(
  current: string,
  messages: { role: 'user' | 'assistant'; content: string }[]
): ContextualRequest | null {
  if (!isFollowUp(current)) return null

  const currentIndex = [...messages].map((m) => m.role).lastIndexOf('user')
  const beforeCurrent = currentIndex >= 0 ? messages.slice(0, currentIndex) : messages
  const priorUserMessages = beforeCurrent.filter((m) => m.role === 'user')
  const priorAssistant = [...beforeCurrent].reverse().find((m) => m.role === 'assistant' && m.content.trim().length > 20)?.content ?? ''

  let previous: { content: string; intent: IntentLabel } | null = null
  for (const message of priorUserMessages.reverse()) {
    const content = message.content.trim()
    if (content.length < 8 || isFollowUp(content)) continue
    const result = classify(content)
    if (SOCIAL_INTENTS.has(result.intent)) continue
    previous = { content, intent: result.intent }
    break
  }
  if (!previous) return null

  const subject = previous.content.slice(0, 700)
  const language = languageFromFollowUp(current)
  if (language && previous.intent === 'code') {
    return {
      requestText: `Écris le code complet en ${language} correspondant à la demande précédente : ${subject}`,
      subject,
      intent: 'code',
      language: language.toLowerCase() === 'luau' ? 'lua' : language.toLowerCase() === 'c#' ? 'csharp' : language.toLowerCase(),
      reason: `le sujet précédent est du code et la langue demandée est ${language}`,
    }
  }

  if (isClarification(current)) {
    return {
      requestText: `Question de suivi (« ${current.trim()} ») sur cette demande : ${subject}`,
      subject,
      intent: 'smalltalk',
      reason: 'la question de suivi est rattachée au dernier sujet, sans relancer son outil',
    }
  }

  const explicit = detectExplicitAction(current, previous.intent)
  const offer = detectAssistantOffer(priorAssistant)
  if (explicit) {
    return {
      requestText: actionableRequest(explicit, subject),
      subject,
      intent: explicit,
      reason: `la commande « ${current.trim()} » reprend le sujet précédent`,
    }
  }

  if (isVariation(current) && ['image', 'scene3d', 'webpage', 'video', 'code'].includes(previous.intent)) {
    return {
      requestText: `${actionableRequest(previous.intent, subject)} — crée une nouvelle variante`,
      subject,
      intent: previous.intent,
      reason: 'la demande de variante reprend le type de création précédent',
    }
  }

  const inheritedIntent = ACTION_INTENTS.has(previous.intent) ? previous.intent : offer
  if (inheritedIntent) {
    // Conserver la formulation originale pour les outils qui en extraient un
    // détail structuré (expression mathématique, URL, MISSION:, visionnage YouTube).
    const preserveOriginal =
      inheritedIntent === previous.intent &&
      (['math', 'task', 'search', 'code', 'image', 'scene3d', 'webpage'].includes(previous.intent) ||
        (previous.intent === 'readpage' && /https?:\/\//i.test(subject)) ||
        (previous.intent === 'video' && /\b(regarde|visionne|youtube|derniere)\b/i.test(normalize(subject)) && !/\b(genere|fabrique|cree)\b/i.test(normalize(subject))))
    return {
      requestText: preserveOriginal ? subject : actionableRequest(inheritedIntent, subject),
      subject,
      intent: inheritedIntent,
      reason: offer === inheritedIntent && !ACTION_INTENTS.has(previous.intent)
        ? 'la réponse précédente proposait explicitement cette action'
        : 'le type de demande précédent est conservé',
    }
  }

  return {
    requestText: `Reprends la réponse précédente sur : ${subject}. Précision demandée : ${current.trim()}`,
    subject,
    intent: 'smalltalk',
    reason: 'le suivi est rattaché au dernier sujet de la conversation',
  }
}
