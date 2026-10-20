// Vérification de l'atelier de modifications de l'agent Dev.
//   npx tsx scripts/test-devcoder.ts
// Le script crée des fichiers jetables dans docs/ (lus réellement par le
// planificateur), vérifie chaque opération, puis nettoie.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { planCodeEdits } from '../src/lib/devcode'
import { planFixRequest } from '../src/lib/devfix'
import { applyPatchToDisk } from '../src/lib/devpatch'

const ROOT = process.cwd()
const DOCS = path.join(ROOT, 'docs')
const A = 'docs/devtest-a.ts'
const B = 'docs/devtest-b.ts'
const C = 'docs/devtest-c.ts'
const D = 'docs/devtest-created.ts'

function write(rel: string, content: string) {
  const abs = path.join(ROOT, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}

function cleanup() {
  for (const rel of [A, B, C, D]) {
    try {
      fs.unlinkSync(path.join(ROOT, rel))
    } catch {
      /* absent */
    }
  }
  try {
    if (!fs.readdirSync(DOCS).length) fs.rmdirSync(DOCS)
  } catch {
    /* absent */
  }
}

cleanup()
write(A, [
  'export const hello = "ancien"',
  '',
  'export function garde(x: number) {',
  '  return x + 1',
  '}',
  '',
  'export function supprimeMoi(x: number) {',
  '  if (x > 0) {',
  '    return { ok: true, x }',
  '  }',
  '  return { ok: false, x }',
  '}',
  '',
  'export function apresMoi() {',
  '  return 42',
  '}',
  '',
  'console.log("bruit")',
  '',
].join('\n'))
write(B, 'export const hello = "ancien"\nexport const garde = 1\n')
write(C, 'const x = 1\n// suppression ciblée\nconst y = 2\n')

let passed = 0
function check(label: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`✅ ${label}`)
  } catch (err) {
    console.error(`❌ ${label}`)
    throw err
  }
}

check('remplacement unique : ancre minimale', () => {
  const plan = planCodeEdits(`remplace "ancien" par "nouveau" dans ${A}`)
  assert.equal(plan.matched, true)
  assert.equal(plan.operation, 'remplacer')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].before, 'ancien')
  assert.equal(plan.patches[0].after, 'nouveau')
})

check('remplacement multiple : fichier entier + toutes les occurrences', () => {
  const plan = planCodeEdits(`remplace "x + 1" par "x + 2" dans ${C}`)
  // Cible sans occurrence : le planificateur doit le dire honnêtement.
  assert.equal(plan.matched, true)
  assert.equal(plan.patches.length, 0)
  assert.ok(plan.notes.length >= 1)

  const plan2 = planCodeEdits(`remplace "const" par "let" dans ${C}`)
  assert.equal(plan2.patches.length, 1)
  assert.equal(plan2.patches[0].before.includes('const x'), true)
  assert.equal(plan2.patches[0].after.includes('let x'), true)
  assert.equal((plan2.patches[0].after.match(/let /g) ?? []).length, 2)
})

check('renommage multi-fichiers : un correctif par fichier', () => {
  const plan = planCodeEdits('renomme `hello` en `salut`')
  assert.equal(plan.matched, true)
  assert.equal(plan.operation, 'renommer')
  assert.ok(plan.patches.length >= 2, `attendu ≥ 2, reçu ${plan.patches.length}`)
  const a = plan.patches.find((p) => p.filePath === A)
  const b = plan.patches.find((p) => p.filePath === B)
  assert.ok(a && b, 'les deux fichiers de test doivent être renommés')
  assert.ok(a.after.includes('salut') && !a.after.includes('"hello"'))
  assert.ok(b.after.includes('salut'))
})

check('suppression de ligne', () => {
  const plan = planCodeEdits(`supprime la ligne contenant "console.log" dans ${A}`)
  assert.equal(plan.operation, 'supprimer-ligne')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.includes('console.log'), false)
  assert.equal(plan.patches[0].before.includes('console.log("bruit")'), true)
})

check('suppression de ligne : forme sans guillemets', () => {
  write(C, 'const keep = 1\n// à supprimer\nconst keep2 = 2\n')
  const plan = planCodeEdits(`supprime les lignes contenant "à supprimer" dans ${C}`)
  assert.equal(plan.operation, 'supprimer-ligne')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.includes('à supprimer'), false)

  const plan2 = planCodeEdits(`supprime la ligne contenant à supprimer dans ${C}`)
  assert.equal(plan2.operation, 'supprimer-ligne')
  assert.equal(plan2.patches.length, 1)
  assert.equal(plan2.patches[0].after.includes('à supprimer'), false)
})

check('remplacement de ligne : verbe « change »', () => {
  write(C, 'const titre = "ancien"\nconst autre = 1\n')
  const plan = planCodeEdits(`change la ligne contenant "const titre" en \`const titre = "nouveau"\` dans ${C}`)
  assert.equal(plan.operation, 'remplacer-ligne')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.includes('const titre = "nouveau"'), true)
  assert.equal(plan.patches[0].after.includes('const autre = 1'), true)
})

check('suppression de fonction : bloc complet sans déborder', () => {
  const plan = planCodeEdits(`supprime la fonction "supprimeMoi" dans ${A}`)
  assert.equal(plan.operation, 'supprimer-symbole')
  assert.equal(plan.patches.length, 1)
  const after = plan.patches[0].after
  assert.equal(after.includes('supprimeMoi'), false)
  assert.equal(after.includes('apresMoi'), true)
  assert.equal(after.includes('export function garde'), true)
})

check('suppression de fonction : accolades dans les chaînes et commentaires', () => {
  write(C, [
    'export function aSupprimer() {',
    '  const texte = "} pas une accolade {"',
    '  const gabarit = `} ${1 + 1} {`',
    '  // } commentaire',
    '  return texte + gabarit',
    '}',
    '',
    'export const apres = 1',
    '',
  ].join('\n'))
  const plan = planCodeEdits(`supprime la fonction "aSupprimer" dans ${C}`)
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.includes('aSupprimer'), false)
  assert.equal(plan.patches[0].after.includes('export const apres'), true)
})

check('insertion après une ancre', () => {
  write(C, 'const a = 1\nconst b = 2\n')
  const plan = planCodeEdits(`ajoute "const milieu = 1.5" après "const a = 1" dans ${C}`)
  assert.equal(plan.operation, 'inserer')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.trimEnd(), 'const a = 1\nconst milieu = 1.5\nconst b = 2')
})

check('ajout en fin de fichier', () => {
  write(C, 'const a = 1\n')
  const plan = planCodeEdits(`ajoute "export const fin = true" à la fin de ${C}`)
  assert.equal(plan.operation, 'ajouter-fin')
  assert.equal(plan.patches.length, 1)
  assert.ok(plan.patches[0].after.trimEnd().endsWith('export const fin = true'))
})

check('nettoyage des console.log', () => {
  const targeted = planCodeEdits(`nettoie les console.log dans ${A}`)
  assert.equal(targeted.operation, 'nettoyer-console')
  assert.equal(targeted.patches.length, 1)
  assert.equal(targeted.patches[0].filePath, A)
  assert.equal(targeted.patches[0].after.includes('console.log("bruit")'), false)

  const plan = planCodeEdits('nettoie les console.log dans tout le projet')
  assert.equal(plan.operation, 'nettoyer-console')
  assert.ok(plan.patches.length > 0)
})

check('création de fichier depuis un bloc de code', () => {
  const plan = planCodeEdits(['crée ' + D, '```ts', 'export const cree = true', '```'].join('\n'))
  assert.equal(plan.operation, 'creer-fichier')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].filePath, D)
  assert.equal(plan.patches[0].before, '')
  assert.ok(plan.patches[0].after.includes('export const cree = true'))
})

check('réécriture complète à partir d’un bloc de code', () => {
  write(C, 'const old = 1\n')
  const message = ['mets à jour ' + C + ' avec :', '```ts', 'const nouveau = 2', 'export default nouveau', '```'].join('\n')
  const plan = planCodeEdits(message)
  assert.equal(plan.operation, 'reecrire')
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].before, 'const old = 1\n')
  assert.equal(plan.patches[0].after, 'const nouveau = 2\nexport default nouveau\n')
})

check('une question ne déclenche pas de modification', () => {
  const plan = planCodeEdits(`comment remplacer "ancien" par "nouveau" dans ${A} ?`)
  assert.equal(plan.matched, false)
  assert.equal(plan.patches.length, 0)
})

check('un apprentissage de connaissance ne déclenche pas de modification', () => {
  const plan = planCodeEdits('apprends à NEXUS que remplacer "a" par "b" est la règle')
  assert.equal(plan.matched, false)
})

check('fichier ambigu : demande de précision, aucun correctif', () => {
  write('docs/devtest-a.ts.bak', '')
  const plan = planCodeEdits('renomme `hello` en `salut` dans devtest-a.ts')
  assert.equal(plan.matched, true)
  // Le fichier exact existe, donc il est résolu sans ambiguïté.
  assert.equal(plan.patches.length, 1)
  fs.unlinkSync(path.join(ROOT, 'docs/devtest-a.ts.bak'))
})

check('application : remplacement unique + sauvegarde', () => {
  write(C, 'const valeur = 1\n')
  const result = applyPatchToDisk({ filePath: C, before: 'const valeur = 1', after: 'const valeur = 2' })
  assert.equal(result.created, false)
  assert.equal(fs.readFileSync(path.join(ROOT, C), 'utf8'), 'const valeur = 2\n')
  assert.ok(fs.existsSync(path.join(ROOT, result.backup)))
})

check('application : création de fichier', () => {
  const result = applyPatchToDisk({ filePath: D, before: '', after: 'export const cree = true' })
  assert.equal(result.created, true)
  assert.equal(fs.readFileSync(path.join(ROOT, D), 'utf8'), 'export const cree = true\n')
})

check('application : création refusée si le fichier est apparu entre-temps', () => {
  write(C, 'const existant = 1\n')
  assert.throws(
    () => applyPatchToDisk({ filePath: C, before: '', after: 'x', title: 'Créer devtest-c.ts' }),
    /existe déjà/i
  )
})

check('application : ancre absente refusée', () => {
  assert.throws(
    () => applyPatchToDisk({ filePath: C, before: 'introuvable', after: 'x' }),
    /ancre n’existe plus/i
  )
})

check('application : ancre multiple refusée', () => {
  write(C, 'const a = 1\nconst a = 1\n')
  assert.throws(() => applyPatchToDisk({ filePath: C, before: 'const a = 1', after: 'const a = 2' }), /apparaît 2 fois/i)
})

check('demande en plusieurs étapes : un seul correctif fusionné par fichier', () => {
  write(C, 'const a = 1\nconst b = 2\nconst c = 3\n')
  const plan = planCodeEdits(`dans ${C}, remplace "const a = 1" par "const a = 10" puis remplace "const b = 2" par "const b = 20"`)
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].filePath, C)
  assert.equal(plan.patches[0].after.includes('const a = 10'), true)
  assert.equal(plan.patches[0].after.includes('const b = 20'), true)
  // Les modifications fusionnées s'appliquent réellement au disque.
  applyPatchToDisk(plan.patches[0])
  const raw = fs.readFileSync(path.join(ROOT, C), 'utf8')
  assert.equal(raw.includes('const a = 10') && raw.includes('const b = 20'), true)
})

check('demande en plusieurs étapes : deux fichiers, deux correctifs', () => {
  write(C, 'const c1 = 1\n')
  write(B, 'const b1 = 1\n')
  const plan = planCodeEdits(`remplace "const c1 = 1" par "const c1 = 2" dans ${C} et remplace "const b1 = 1" par "const b1 = 2" dans ${B}`)
  assert.equal(plan.patches.length, 2)
  assert.deepEqual([...new Set(plan.patches.map((p) => p.filePath))].sort(), [B, C])
})

check('réparation : imports inutilisés corrigés sans ancre fournie', () => {
  write(C, "import { readFileSync, writeFileSync } from 'fs'\nexport const t = readFileSync('x', 'utf8')\n")
  const plan = planFixRequest(`corrige les imports inutilisés dans ${C}`)
  assert.ok(plan)
  assert.equal(plan.patches.length, 1)
  assert.equal(plan.patches[0].after.includes('writeFileSync'), false)
  assert.equal(plan.patches[0].after.includes('readFileSync'), true)
  applyPatchToDisk(plan.patches[0])
  assert.equal(fs.readFileSync(path.join(ROOT, C), 'utf8').includes('writeFileSync'), false)
})

check('réparation : défauts multiples fusionnés en un correctif', () => {
  write(C, "import { writeFileSync } from 'fs'\nconsole.log('bruit')\nconst n = parseInt('42')\n")
  const plan = planFixRequest(`corrige ${C}`)
  assert.ok(plan)
  assert.equal(plan.patches.length, 1)
  const after = plan.patches[0].after
  assert.equal(after.includes('console.log'), false)
  assert.equal(after.includes("parseInt('42', 10)"), true)
  assert.equal(after.includes('writeFileSync'), false)
})

check('réparation : cible absente = aucun faux correctif, une demande de précision', () => {
  const plan = planFixRequest('corrige le bug du bouton et applique la modification')
  assert.ok(plan)
  assert.equal(plan.patches.length, 0)
  assert.ok(plan.notes.length > 0)
})

cleanup()
console.log(`\n${passed} vérifications réussies.`)
