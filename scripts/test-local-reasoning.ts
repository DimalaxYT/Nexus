// Vérifie le raisonnement de suivi et le RAG local sans accès réseau.
// Exécuter : npx tsx scripts/test-local-reasoning.ts
import assert from 'node:assert/strict'
import { deepReasonAndAnswer } from '../src/lib/brain/deep-reasoner'
import { resolveContextualRequest } from '../src/lib/brain/contextual-request'

async function main() {
  const previousUser = 'Explique comment créer un jeu Roblox.'
  const previousAssistant =
    'Roblox Studio permet de construire un jeu Roblox avec le langage Luau. Le serveur valide les actions importantes pour empêcher la triche côté client.'
  const followUp = 'et pourquoi ?'
  const contextual = resolveContextualRequest(followUp, [
    { role: 'user', content: previousUser },
    { role: 'assistant', content: previousAssistant },
    { role: 'user', content: followUp },
  ])

  assert.ok(contextual)
  assert.equal(contextual.intent, 'smalltalk')

  const events: { type: string; text?: string; tool?: string }[] = []
  const answer = await deepReasonAndAnswer({
    userText: contextual.requestText,
    topic: contextual.subject,
    memories: ['Le projet actuel est Galaxy Tycoon, un jeu Roblox en cours de développement.'],
    notes: [
      {
        title: 'Projet Galaxy Tycoon',
        content: 'Galaxy Tycoon est le projet Roblox en cours : le jeu combine gestion de ressources et progression par améliorations.',
        category: 'Projet',
      },
    ],
    previousAssistant,
    isClarificationFollowUp: true,
    send: (event) => events.push(event as { type: string; text?: string; tool?: string }),
  })

  assert.match(answer, /Lien avec ta question précédente/)
  assert.match(answer, /Roblox Studio permet de construire un jeu Roblox/)
  assert.match(answer, /notes personnelles/i)
  assert.match(answer, /Galaxy Tycoon est le projet Roblox en cours/)
  assert.match(answer, /Informations retenues pertinentes/)
  assert.doesNotMatch(answer, /Plan d'architecture & de réalisation/)
  assert.ok(
    events.some((event) => event.type === 'thought' && event.text?.includes('deep_explanation')),
    'la clarification doit suivre le mode explication, pas le mode détecté depuis l’ancien sujet'
  )
  assert.ok(
    !events.some((event) => event.type === 'step' && event.tool === 'web_search'),
    'le test utilise une entrée couverte par la banque locale et ne doit pas contacter le Web'
  )

  const comparisonEvents: { type: string; text?: string; tool?: string }[] = []
  const comparison = await deepReasonAndAnswer({
    userText: 'DataStore vs Roblox',
    topic: 'DataStore vs Roblox',
    memories: ['Son jeu Roblox est en développement.'],
    notes: [],
    send: (event) => comparisonEvents.push(event as { type: string; text?: string; tool?: string }),
  })
  assert.match(comparison, /Comparaison : \*\*DataStore\*\* vs \*\*Roblox\*\*/)
  assert.match(comparison, /DataStore : sauvegarder les données joueur/)
  assert.match(comparison, /Comment créer un jeu Roblox/)
  assert.match(comparison, /Informations retenues pertinentes/)
  assert.doesNotMatch(comparison, /Philosophie principale/)
  assert.doesNotMatch(comparison, /Ma recommandation tranchée/)
  assert.ok(!comparisonEvents.some((event) => event.type === 'step' && event.tool === 'web_search'))

  console.log('✅ Suivi contextualisé et comparaison factuelle : contexte personnel repris, base locale utilisée sans recherche Web ni recommandations génériques.')
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
