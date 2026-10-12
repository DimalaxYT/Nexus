// Réglages explicites du raisonnement local NEXUS.
// Valeurs partagées entre l'interface persistée et le serveur, toujours validées.

export type BrainResponseDetail = 'concise' | 'balanced' | 'detailed'
export type BrainWebResearch = 'auto' | 'always' | 'never'

export interface BrainParameters {
  responseDetail: BrainResponseDetail
  webResearch: BrainWebResearch
  noteLimit: number
  usePersonalMemory: boolean
}

export const DEFAULT_BRAIN_PARAMETERS: BrainParameters = {
  responseDetail: 'balanced',
  webResearch: 'auto',
  noteLimit: 2,
  usePersonalMemory: true,
}

export const BRAIN_RESPONSE_DETAILS: { value: BrainResponseDetail; label: string; description: string }[] = [
  { value: 'concise', label: 'Synthétique', description: 'Va à l’essentiel et limite les extraits.' },
  { value: 'balanced', label: 'Équilibré', description: 'Réponse structurée avec un niveau de détail modéré.' },
  { value: 'detailed', label: 'Détaillé', description: 'Consulte plus de sources et conserve davantage de contexte.' },
]

export const BRAIN_WEB_RESEARCH_OPTIONS: { value: BrainWebResearch; label: string; description: string }[] = [
  { value: 'auto', label: 'Automatique', description: 'Cherche sur le Web si la base locale ne suffit pas.' },
  { value: 'always', label: 'Toujours', description: 'Ajoute une recherche Web aux réponses générales.' },
  { value: 'never', label: 'Jamais automatiquement', description: 'Reste sur les connaissances locales; une demande explicite de recherche fonctionne toujours.' },
]

/** Repère une demande explicite de recherche en ligne, à distinguer du mode auto. */
export function isExplicitWebSearchRequest(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’]/g, "'")
  const action = /\b(?:cherche(?:r|s)?|recherche(?:r|s)?|consulte(?:r|s)?|verifie(?:r|s)?|trouve(?:r|s)?|lance(?:r|s)?|effectue(?:r|s)?|fais(?:ons)?|search|look up|find|check)\b/
  const webTarget = /\b(?:sur\s+(?:(?:le|l')\s*)?(?:web|internet)|en\s+ligne|online|on\s+the\s+web|on\s+google|on\s+bing)\b/
  const requestedSources = /\b(?:cherche|recherche|trouve|donne|fournis|cite|search|find)\b[\s\S]{0,70}\b(?:sources?|liens?)\b/

  return (
    (action.test(normalized) && webTarget.test(normalized)) ||
    requestedSources.test(normalized)
  )
}

export function isExplicitSearchRequest(text: string): boolean {
  if (isExplicitWebSearchRequest(text)) return true
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[’]/g, "'")
    .trim()
  return /(?:^|[.!?]\s*|\b(?:peux-tu|peux tu|pourrais-tu|pourrais tu|tu peux|je veux que tu)\s+(?:me\s+)?)(?:cherche(?:r|s)?|recherche(?:r|s)?|trouve(?:r|s)?|consulte(?:r|s)?|renseigne-toi|googlise)\b/.test(normalized)
}

export function shouldSearchWebForReasoning(
  mode: BrainWebResearch,
  bestKnowledgeScore: number | undefined,
  requestText: string
): boolean {
  if (isExplicitSearchRequest(requestText) || mode === 'always') return true
  if (mode === 'never') return false
  return bestKnowledgeScore === undefined || bestKnowledgeScore < 0.88
}

export interface BrainReasoningLimits {
  knowledgeMatches: number
  webResults: number
  pagesToRead: number
  snippetSentences: number
  synthesizedSentencesPerPage: number
  synthesizedTotalSentences: number
  comparisonFacts: number
}

/** Limites effectives qui font varier la profondeur du raisonnement local. */
export function getBrainReasoningLimits(detail: BrainResponseDetail): BrainReasoningLimits {
  switch (detail) {
    case 'concise':
      return {
        knowledgeMatches: 1,
        webResults: 3,
        pagesToRead: 1,
        snippetSentences: 2,
        synthesizedSentencesPerPage: 2,
        synthesizedTotalSentences: 4,
        comparisonFacts: 1,
      }
    case 'detailed':
      return {
        knowledgeMatches: 4,
        webResults: 8,
        pagesToRead: 3,
        snippetSentences: 6,
        synthesizedSentencesPerPage: 4,
        synthesizedTotalSentences: 9,
        comparisonFacts: 5,
      }
    default:
      return {
        knowledgeMatches: 2,
        webResults: 6,
        pagesToRead: 2,
        snippetSentences: 4,
        synthesizedSentencesPerPage: 3,
        synthesizedTotalSentences: 6,
        comparisonFacts: 3,
      }
  }
}

/** Normalise les paramètres reçus du navigateur ou d'un ancien localStorage. */
export function normalizeBrainParameters(value: unknown): BrainParameters {
  const raw = value && typeof value === 'object' ? (value as Partial<BrainParameters>) : {}
  const responseDetail: BrainResponseDetail =
    raw.responseDetail === 'concise' || raw.responseDetail === 'detailed' || raw.responseDetail === 'balanced'
      ? raw.responseDetail
      : DEFAULT_BRAIN_PARAMETERS.responseDetail
  const webResearch: BrainWebResearch =
    raw.webResearch === 'auto' || raw.webResearch === 'always' || raw.webResearch === 'never'
      ? raw.webResearch
      : DEFAULT_BRAIN_PARAMETERS.webResearch
  const noteLimit = Number.isFinite(raw.noteLimit)
    ? Math.max(1, Math.min(5, Math.round(raw.noteLimit as number)))
    : DEFAULT_BRAIN_PARAMETERS.noteLimit

  return {
    responseDetail,
    webResearch,
    noteLimit,
    usePersonalMemory:
      typeof raw.usePersonalMemory === 'boolean'
        ? raw.usePersonalMemory
        : DEFAULT_BRAIN_PARAMETERS.usePersonalMemory,
  }
}
