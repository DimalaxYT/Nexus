// Test rapide du classifieur Round 15 : les messages qui étaient mal routés
import { classify } from '../src/lib/brain/classifier'

const cases: [string, string][] = [
  ['quels est ta dernière mise a jour?', 'capabilities'],
  ['non mais globalement quels fonctions en plus tu as?', 'capabilities'],
  ['quelles fonctions tu as ?', 'capabilities'],
  ["qu'est-ce que tu as comme mises à jour ?", 'capabilities'],
  ['tu as quoi comme outils ?', 'capabilities'],
  ['c est quoi tes nouveautes ?', 'capabilities'],
  ['ta dernière maj ?', 'capabilities'],
  // Non-régression : les vraies intentions doivent rester stables
  ['cherche des infos sur les voitures electriques', 'search'],
  ['retiens que mon jeu s appelle nexus quest', 'knowledge_save'],
  ['que sais tu sur roblox', 'knowledge_query'],
  ['lis https://create.roblox.com/docs', 'readpage'],
  ['ecris un script python pour trier des fichiers', 'code'],
  ['genere une image de dragon', 'image'],
  ['genere une video de vague sur la mer', 'video'],
  ['combien font 12 plus 45', 'math'],
  ['quelle heure est il', 'time'],
  ['je m appelle max', 'about_user'],
  ['quel est le capital du japon', 'smalltalk'],
  ['cree une scene 3d de ville futuriste', 'scene3d'],
  ['cree un site web pour ma pizzeria', 'webpage'],
  ['cherche la mise a jour de python', 'search'],
  ['comment ca va', 'howareyou'],
  ['bonjour', 'greeting'],
  ['merci beaucoup', 'thanks'],
  ['realise-le', 'smalltalk'],
]

let fail = 0
for (const [msg, expected] of cases) {
  const c = classify(msg)
  const ok = c.intent === expected
  if (!ok) fail++
  console.log(`${ok ? '✅' : '❌'} [${c.intent} ${Math.round(c.confidence * 100)}% ${c.source}] ← « ${msg} » (attendu : ${expected})`)
}
console.log(fail === 0 ? '\n🎉 TOUS OK' : `\n⚠️ ${fail} échec(s)`)
process.exit(fail === 0 ? 0 : 1)
