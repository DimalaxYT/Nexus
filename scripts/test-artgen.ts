// Test des nouveaux styles artgen : rend SVG → PNG (via sharp/librsvg)
import { generateArt } from '../src/lib/brain/artgen'
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'fs'
import path from 'path'

const PROMPTS = [
  'une aurore boréale au dessus des montagnes',
  'une cascade dans la forêt',
  'un voilier sur l océan au coucher du soleil',
  'un phare sur la côte avec des oiseaux',
]

async function main() {
  const outDir = path.join(process.cwd(), 'download')
  mkdirSync(outDir, { recursive: true })
  for (const p of PROMPTS) {
    const art = generateArt(p, '1344x768')
    const png = await sharp(Buffer.from(art.svg)).resize(672, 384).png().toBuffer()
    writeFileSync(path.join(outDir, `art-${art.style}-${art.seed % 10000}.png`), png)
    console.log(`OK ${art.style} → art-${art.style}-${art.seed % 10000}.png`)
  }
}
main()
