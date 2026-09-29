// Test du cerveau local NEXUS v2.0 — exécuter : bun scripts/test-brain.ts
import { classify, warmUpClassifier, extractTopic, overlap } from '../src/lib/brain/classifier'
import { evaluateMath } from '../src/lib/brain/math-engine'
import { generateCodeLocal } from '../src/lib/brain/codegen'
import { generateWebpageLocal } from '../src/lib/brain/webpagegen'
import { generateArt } from '../src/lib/brain/artgen'
import { generateSceneLocal } from '../src/lib/brain/scenegen'
import { extractMemories, extractExplicitRetention, autoTitle } from '../src/lib/brain/memory-rules'
import { searchKnowledgeBank } from '../src/lib/brain/knowledge-bank'
import { INTENTS } from '../src/lib/brain/dataset'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

const idx = (label: string) => INTENTS.indexOf(label as (typeof INTENTS)[number])

console.log('\n── 1. Réseau de neurones (entraînement + classification) ──')
const t0 = Date.now()
const accuracy = warmUpClassifier()
console.log(`  Entraînement : ${(Date.now() - t0).toFixed(0)} ms, précision train ${(accuracy * 100).toFixed(1)} %`)
check('précision d’entraînement > 0.93', accuracy > 0.93, `${(accuracy * 100).toFixed(1)}%`)

const cases: [string, string][] = [
  ['salut nexus', 'greeting'],
  ['bonjour comment ca va', 'howareyou'],
  ['au revoir a demain', 'farewell'],
  ['merci beaucoup pour tout', 'thanks'],
  ['ca va aujourd hui ?', 'howareyou'],
  ['qui es tu exactement', 'identity'],
  ['que sais tu faire ?', 'capabilities'],
  ['cherche le prix du bitcoin', 'search'],
  ['meteo a paris demain', 'search'],
  ['lis cette page https://example.com', 'readpage'],
  ['resume https://wikipedia.org', 'readpage'],
  ['ecris un script lua qui spawn des pieces', 'code'],
  ['fais moi un script python de tri', 'code'],
  ['genere une image de renard', 'image'],
  ['dessine un chateau medieval', 'image'],
  ['cree une scene 3d d une ville', 'scene3d'],
  ['modelise une ile flottante', 'scene3d'],
  ['cree une page web pour un cafe', 'webpage'],
  ['fais moi un site de portfolio', 'webpage'],
  ['genere une video de ville cyberpunk', 'video'],
  ['combien font 12 plus 45', 'math'],
  ['calcule 8 fois 7', 'math'],
  ['2+2*10', 'math'],
  ['avancement de la mission', 'task'],
  ['je te confie une mission de test', 'task'],
  ['retiens que mon jeu s appelle nexus', 'knowledge_save'],
  ['note ca dans ta base', 'knowledge_save'],
  ['que sais tu sur roblox', 'knowledge_query'],
  ['mes notes sur python', 'knowledge_query'],
  ['quelle heure est il', 'time'],
  ['comment je m appelle', 'about_user'],
  ['explique moi la gravite', 'smalltalk'],
  ['raconte moi une blague', 'smalltalk'],
]
for (const [text, expected] of cases) {
  const c = classify(text)
  check(`« ${text} » → ${expected}`, c.intent === expected, `obtenu ${c.intent} (${Math.round(c.confidence * 100)}%, ${c.source})`)
}

console.log('\n── 2. Moteur mathématique ──')
const m1 = evaluateMath('12 plus 45')
check('12 plus 45 = 57', m1?.result === '57', JSON.stringify(m1))
const m2 = evaluateMath('8 fois 7')
check('8 fois 7 = 56', m2?.result === '56', JSON.stringify(m2))
const m3 = evaluateMath('sqrt 144')
check('sqrt 144 = 12', m3?.result === '12', JSON.stringify(m3))
const m4 = evaluateMath('2^10')
check('2^10 = 1024', m4?.result === '1024', JSON.stringify(m4))
const m5 = evaluateMath('15% de 240')
check('15% de 240 = 36', m5?.result === '36', JSON.stringify(m5))
const m6 = evaluateMath('moyenne de 12 15 et 9')
check('moyenne 12,15,9 = 12', m6?.result === '12', JSON.stringify(m6))
const m7 = evaluateMath('(12+8)/4')
check('(12+8)/4 = 5', m7?.result === '5', JSON.stringify(m7))
const m8 = evaluateMath('100 divise par 8')
check('100 divisé par 8 = 12.5', m8?.result === '12.5', JSON.stringify(m8))
const m9 = evaluateMath('bonjour je veux un chat')
check('non-maths → null', m9 === null)

console.log('\n── 3. Générateur de code ──')
const g1 = generateCodeLocal('ecris un script roblox pour un systeme de pieces', { language: undefined as unknown as string, size: '1024x1024', numbers: [] } as never, 'systeme de pieces')
check('pièces → coin_spawner.lua', g1.filename === 'coin_spawner.lua', g1.filename)
check('code Lua complet (>1500 chars)', g1.code.length > 1500, `${g1.code.length} chars`)
const g2 = generateCodeLocal('fais moi un kill brick roblox', { language: undefined, size: '1024x1024', numbers: [] } as never, 'kill brick')
check('kill → kill_brick.lua', g2.filename === 'kill_brick.lua')
const g3 = generateCodeLocal('script de sauvegarde datastore roblox', { language: undefined, size: '1024x1024', numbers: [] } as never, 'datastore')
check('datastore → sauvegarde_datastore.lua', g3.filename === 'sauvegarde_datastore.lua')
const g4 = generateCodeLocal('ecrires un programme python qui liste les nombres premiers', { language: 'python', size: '1024x1024', numbers: [] } as never, 'nombres premiers')
check('premiers → nombres_premiers.py', g4.filename === 'nombres_premiers.py')
check('crible en python (sans API)', g4.code.includes('def crible'))
const g5 = generateCodeLocal('un script rust pour apprendre', { language: 'rust', size: '1024x1024', numbers: [] } as never, 'rust')
check('rust → main.rs', g5.filename === 'main.rs')

console.log('\n── 4. Pages web locales ──')
const w1 = generateWebpageLocal('cree une page todo liste', 'todo')
check('todo → app todo', w1.js.includes('todos'), w1.description)
const w2 = generateWebpageLocal('genere une landing page pour un cafe', 'cafe')
check('landing → hero + form', w2.html.includes('hero') && w2.html.includes('formContact'), w2.description)
check('css responsive (@media)', w2.css.includes('@media'))

console.log('\n── 5. Art procédural ──')
const a1 = generateArt('une image de ville cyberpunk neon')
check('art ville généré', a1.style === 'ville' || a1.style === 'paysage', a1.style)
check('SVG valide', a1.svg.startsWith('<svg') && a1.svg.includes('</svg>'))
const a2 = generateArt('une image de ville cyberpunk neon')
check('déterministe (même graine)', a2.svg === a1.svg)
const a3 = generateArt('logo pour ma chaine gaming')
check('logo → monogramme', a3.style === 'logo' && a3.svg.includes('<text'), a3.style)
const a4 = generateArt('paysage de montagne au coucher de soleil', '1344x768')
check('format paysage 1344×768', a4.width === 1344 && a4.height === 768)

console.log('\n── 6. Scènes 3D ──')
const s1 = generateSceneLocal('cree une scene 3d d une ville neon')
check('scène ville (≥8 objets)', s1.objects.length >= 8, `${s1.objects.length} objets`)
check('éclairage néon', s1.lighting === 'neon')
const s2 = generateSceneLocal('baseplate roblox')
check('baseplate → template officiel', s2.name === 'Baseplate Roblox')
const s3 = generateSceneLocal('une ile flottante avec une maison')
check('île flottante chargée', s3.objects.length >= 10, `${s3.objects.length} objets`)
check('ids uniques', new Set(s3.objects.map((o) => o.id)).size === s3.objects.length)

console.log('\n── 7. Mémoire par règles ──')
const mem1 = extractMemories("Salut ! Je m'appelle Thomas et j'habite à Lyon")
check('nom détecté', mem1.some((m) => m.content.includes('Thomas')), JSON.stringify(mem1))
check('ville détectée', mem1.some((m) => m.content.includes('Lyon')))
const mem2 = extractMemories('mon jeu s appelle Galaxy Tycoon et j aime le lua')
check('projet détecté', mem2.some((m) => m.kind === 'project'), JSON.stringify(mem2))
check('préférence détectée', mem2.some((m) => m.kind === 'preference'))
const mem3 = extractExplicitRetention('retiens que ma reunion est a 15h jeudi')
check('rétention explicite', mem3 !== null && mem3.content.includes('reunion'), mem3?.content)
check('titre auto', autoTitle('salut, peux-tu ecrire un script de pieces roblox').length > 3, autoTitle('salut, peux-tu ecrire un script de pieces roblox'))

console.log('\n── 8. Banque de connaissances ──')
const k1 = searchKnowledgeBank('explique moi comment fonctionne un datastore roblox', 1)[0]
check('datastore trouvé', k1 !== undefined && k1.entry.keywords.includes('datastore'), k1?.entry.question)
const k2 = searchKnowledgeBank('pourquoi le ciel est bleu', 1)[0]
check('ciel bleu trouvé', k2 !== undefined && k2.entry.question.includes('bleu'), k2?.entry.question)

console.log('\n── 9. Sujets & recouvrement ──')
const t1 = extractTopic('salut nexus, peux-tu ecrire un script de pieces roblox pour moi stp')
check('sujet nettoyé', !t1.includes('stp') && !/salut/i.test(t1) && t1.length > 3, t1)
check('overlap', overlap('j aime le lua roblox', 'le lua de roblox') > 0.5)

console.log(`\n═══ RÉSULTAT : ${pass} passés, ${fail} échoués ═══`)
process.exit(fail > 0 ? 1 : 0)
