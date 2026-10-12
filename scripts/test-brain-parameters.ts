// Vérifie les réglages persistables et leur effet sur le raisonnement local.
// Exécuter : npx tsx scripts/test-brain-parameters.ts
import assert from 'node:assert/strict'
import { deepReasonAndAnswer } from '../src/lib/brain/deep-reasoner'
import {
  DEFAULT_BRAIN_PARAMETERS,
  getBrainReasoningLimits,
  isExplicitSearchRequest,
  isExplicitWebSearchRequest,
  normalizeBrainParameters,
  shouldSearchWebForReasoning,
} from '../src/lib/brain/parameters'

async function main() {
  assert.deepEqual(normalizeBrainParameters(null), DEFAULT_BRAIN_PARAMETERS)
  assert.deepEqual(
    normalizeBrainParameters({ responseDetail: 'detailed', webResearch: 'never', noteLimit: 99, usePersonalMemory: false }),
    { responseDetail: 'detailed', webResearch: 'never', noteLimit: 5, usePersonalMemory: false }
  )
  assert.equal(normalizeBrainParameters({ noteLimit: -4 }).noteLimit, 1)
  assert.equal(normalizeBrainParameters({ noteLimit: 2.6 }).noteLimit, 3)
  assert.equal(normalizeBrainParameters({ responseDetail: 'verbose' }).responseDetail, 'balanced')

  assert.deepEqual(getBrainReasoningLimits('concise'), {
    knowledgeMatches: 1,
    webResults: 3,
    pagesToRead: 1,
    snippetSentences: 2,
    synthesizedSentencesPerPage: 2,
    synthesizedTotalSentences: 4,
    comparisonFacts: 1,
  })
  assert.ok(getBrainReasoningLimits('balanced').webResults < getBrainReasoningLimits('detailed').webResults)
  assert.ok(getBrainReasoningLimits('concise').pagesToRead < getBrainReasoningLimits('balanced').pagesToRead)
  assert.ok(getBrainReasoningLimits('concise').knowledgeMatches < getBrainReasoningLimits('detailed').knowledgeMatches)

  assert.equal(isExplicitWebSearchRequest('Cherche sur le Web les dernières nouveautés Roblox.'), true)
  assert.equal(isExplicitWebSearchRequest('Search for current Roblox news online.'), true)
  assert.equal(isExplicitWebSearchRequest('Donne-moi des sources fiables sur ce sujet.'), true)
  assert.equal(isExplicitWebSearchRequest('Explique ce qu’est la recherche Web.'), false)
  assert.equal(isExplicitSearchRequest('Cherche le prix du Bitcoin.'), true)
  assert.equal(isExplicitSearchRequest('Peux-tu chercher le prix du Bitcoin ?'), true)
  assert.equal(isExplicitSearchRequest('Peux-tu me chercher le prix du Bitcoin ?'), true)
  assert.equal(isExplicitSearchRequest('Je veux que tu recherches le prix du Bitcoin.'), true)
  assert.equal(isExplicitSearchRequest('Quelle est la météo à Paris demain ?'), false)
  assert.equal(shouldSearchWebForReasoning('never', undefined, 'Explique un concept.'), false)
  assert.equal(shouldSearchWebForReasoning('never', 0.4, 'Cherche sur le Web ce sujet.'), true)
  assert.equal(shouldSearchWebForReasoning('never', undefined, 'Cherche le prix du Bitcoin.'), true)
  assert.equal(shouldSearchWebForReasoning('never', undefined, 'Quelle est la météo à Paris demain ?'), false)
  assert.equal(shouldSearchWebForReasoning('always', 1, 'Explique un concept.'), true)
  assert.equal(shouldSearchWebForReasoning('auto', 0.9, 'Explique un concept.'), false)
  assert.equal(shouldSearchWebForReasoning('auto', undefined, 'Explique un concept.'), true)

  const notes = Array.from({ length: 5 }, (_, index) => ({
    title: `Note test ${index + 1}`,
    content: `Contenu personnel de la note ${index + 1}. `.repeat(20),
    category: 'Test',
  }))
  const memories = ['Souvenir personnel unique à ne pas afficher lorsque la mémoire est désactivée.']
  const conciseEvents: { type: string; tool?: string }[] = []
  const concise = await deepReasonAndAnswer({
    userText: 'Comment créer un jeu Roblox ?',
    topic: 'Comment créer un jeu Roblox',
    notes,
    memories,
    brainParameters: {
      responseDetail: 'concise',
      webResearch: 'never',
      noteLimit: 2,
      usePersonalMemory: false,
    },
    send: (event) => conciseEvents.push(event as { type: string; tool?: string }),
  })
  assert.match(concise, /Note test 1/)
  assert.match(concise, /Note test 2/)
  assert.doesNotMatch(concise, /Note test 3/)
  assert.doesNotMatch(concise, /Souvenir personnel unique|Informations retenues pertinentes/)
  assert.ok(!conciseEvents.some((event) => event.type === 'step' && event.tool === 'web_search'))

  const detailed = await deepReasonAndAnswer({
    userText: 'Comment créer un jeu Roblox ?',
    topic: 'Comment créer un jeu Roblox',
    notes,
    memories,
    brainParameters: {
      responseDetail: 'detailed',
      webResearch: 'never',
      noteLimit: 2,
      usePersonalMemory: false,
    },
    send: () => undefined,
  })
  assert.ok(detailed.length > concise.length, 'le niveau détaillé doit fournir davantage de contenu local')
  assert.match(detailed, /Note test 2/)
  assert.doesNotMatch(detailed, /Souvenir personnel unique|Informations retenues pertinentes/)

  const answerAtDetail = (userText: string, responseDetail: 'concise' | 'balanced' | 'detailed') =>
    deepReasonAndAnswer({
      userText,
      topic: userText,
      notes: [],
      memories: [],
      brainParameters: { ...DEFAULT_BRAIN_PARAMETERS, responseDetail, webResearch: 'never' },
      send: () => undefined,
    })
  const conciseTroubleshooting = await answerAtDetail('Mon jeu plante : comment corriger cette erreur ?', 'concise')
  const detailedTroubleshooting = await answerAtDetail('Mon jeu plante : comment corriger cette erreur ?', 'detailed')
  assert.match(conciseTroubleshooting, /Vérifications rapides/)
  assert.match(detailedTroubleshooting, /Diagnostic approfondi/)
  assert.match(detailedTroubleshooting, /test de régression/)

  const conciseArchitecture = await answerAtDetail('Comment créer un plan pour un jeu Roblox ?', 'concise')
  const detailedArchitecture = await answerAtDetail('Comment créer un plan pour un jeu Roblox ?', 'detailed')
  assert.match(conciseArchitecture, /Deux jalons/)
  assert.match(detailedArchitecture, /Jalons de réalisation/)
  assert.match(detailedArchitecture, /observabilité/)

  const weatherEvents: { type: string; tool?: string }[] = []
  const weatherAnswer = await deepReasonAndAnswer({
    userText: 'Quelle est la météo à Paris demain ?',
    topic: 'météo à Paris demain',
    notes: [],
    memories: [],
    brainParameters: { ...DEFAULT_BRAIN_PARAMETERS, webResearch: 'never' },
    send: (event) => weatherEvents.push(event as { type: string; tool?: string }),
  })
  assert.match(weatherAnswer, /recherche Web automatique est désactivée/i)
  assert.ok(!weatherEvents.some((event) => event.type === 'step' && event.tool === 'web_search'))

  const selfCodeEvents: { type: string; tool?: string }[] = []
  const selfCodeAnswer = await deepReasonAndAnswer({
    userText: 'quesque qui a été changé dans ton code ?',
    topic: 'quesque qui a été changé dans ton code',
    previousAssistant: 'Le script programme.py est prêt et ouvert dans le Studio Code. Programme Python structuré.',
    notes: [],
    memories: [],
    brainParameters: { ...DEFAULT_BRAIN_PARAMETERS, webResearch: 'always' },
    send: (event) => selfCodeEvents.push(event as { type: string; tool?: string }),
  })
  assert.match(selfCodeAnswer, /mal interprété ta question/i)
  assert.match(selfCodeAnswer, /programme\.py/)
  assert.match(selfCodeAnswer, /n'a pas modifié mon propre code/)
  assert.ok(!selfCodeEvents.some((event) => event.type === 'step' && event.tool === 'web_search'))

  console.log('✅ Paramètres du cerveau : normalisation, profondeur, notes, mémoire personnelle et politique de recherche Web.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
