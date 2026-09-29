/**
 * Vérifie la syntaxe du CONSOLE_SHIM généré : recrée le string exactement
 * comme le fait le template literal TS, puis le parse avec new Function.
 */
import { readFileSync } from 'fs'
import path from 'path'

const src = readFileSync(path.join(process.cwd(), 'src/components/nexus/studios/CodeStudio.tsx'), 'utf8')

// Extraire le contenu du template literal CONSOLE_SHIM brut (sans interpréter les échappements)
const match = src.match(/const CONSOLE_SHIM = `([\s\S]*?)<\\\/script>`/)
if (!match) {
  console.error('SHIM introuvable')
  process.exit(1)
}

// Interpréter les échappements comme le ferait un template literal TS/JS :
// \\ -> \, \` -> `
const raw = match[1]
const interpreted = raw.replace(/\\`/g, '`').replace(/\\\\/g, '\\')

// Retirer la balise <script> d'ouverture (le <\/script> de fermeture est hors capture)
const js = interpreted.replace(/^\s*<script>/, '')

try {
  new Function(js)
  console.log('✓ Syntaxe JS du shim VALIDE')
} catch (e) {
  console.error('✗ ERREUR DE SYNTAXE dans le shim :', e instanceof Error ? e.message : e)
  console.error('--- JS testé (500 premiers chars) ---')
  console.error(js.slice(0, 500))
}
