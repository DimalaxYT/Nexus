// Tests unitaires du routage contextuel local : npx tsx scripts/test-contextual-request.ts
import assert from 'node:assert/strict'
import { resolveContextualRequest } from '../src/lib/brain/contextual-request'
import { classify } from '../src/lib/brain/classifier'
import { generateCodeLocal } from '../src/lib/brain/codegen'
import { extractEntities } from '../src/lib/brain/entities'

function resolve(current: string, previousUser: string, previousAssistant: string) {
  return resolveContextualRequest(current, [
    { role: 'user', content: previousUser },
    { role: 'assistant', content: previousAssistant },
    { role: 'user', content: current },
  ])
}

const codeAfterOffer = resolve(
  'code-le',
  'Explique comment créer un système de pièces dans Roblox.',
  'Je peux aussi te rédiger le script complet. Dis-moi « code-le » si tu veux.'
)
assert.equal(codeAfterOffer?.intent, 'code')
assert.match(codeAfterOffer?.requestText ?? '', /système de pièces dans Roblox/i)
assert.equal(classify(codeAfterOffer?.requestText ?? '').intent, 'code')

const ackAfterSearch = resolve(
  'vas-y',
  'Cherche les nouveautés Roblox de cette semaine',
  'J’ai trouvé quelques pistes. Veux-tu que je lance la recherche complète ?'
)
assert.equal(ackAfterSearch?.intent, 'search')
assert.equal(ackAfterSearch?.subject, 'Cherche les nouveautés Roblox de cette semaine')

const languageSwitch = resolve(
  'et en Python ?',
  'Écris un script Lua pour trier une liste de scores Roblox.',
  'Le script Lua est prêt.'
)
assert.equal(languageSwitch?.intent, 'code')
// Le résolveur fournit la langue choisie afin qu'elle remplace celle du sujet d'origine.
assert.equal(languageSwitch?.language, 'python')
const csharpSwitch = resolve(
  'et en C# ?',
  'Écris une fonction JavaScript qui additionne deux nombres.',
  'La fonction JavaScript est prête.'
)
assert.equal(csharpSwitch?.intent, 'code')
assert.equal(csharpSwitch?.language, 'csharp')

// Les langages explicitement choisis doivent remplacer celui du sujet (même Roblox).
for (const switched of [languageSwitch, csharpSwitch]) {
  assert.ok(switched)
  const entities = extractEntities([switched.requestText, switched.subject].join('\n'))
  if (switched.language) entities.language = switched.language
  assert.equal(
    generateCodeLocal(switched.requestText, entities, switched.subject).language,
    switched.language
  )
}

const clarification = resolve(
  'et pourquoi ?',
  'Pourquoi le ciel est-il bleu ?',
  'La lumière bleue est diffusée davantage par l’atmosphère.'
)
assert.equal(clarification?.intent, 'smalltalk')
assert.match(clarification?.requestText ?? '', /ciel est-il bleu/i)

const watchVideo = resolve(
  'vas-y',
  'Regarde la dernière vidéo YouTube de Fugu',
  'J’ai trouvé sa chaîne. Veux-tu que je la consulte ?'
)
assert.equal(watchVideo?.intent, 'video')
assert.match(watchVideo?.requestText ?? '', /^Regarde la dernière vidéo/i)

assert.equal(resolve('dessine-moi un chat', 'Salut', 'Bonjour !'), null, 'une nouvelle demande complète reste intacte')
assert.equal(resolve('vas-y', 'Merci beaucoup', 'Avec plaisir !'), null, 'un simple échange social ne devient pas un sujet')

console.log('✅ Résolution contextuelle : code-le, vas-y, changement de langage, clarification, YouTube et gardes non-régression.')
