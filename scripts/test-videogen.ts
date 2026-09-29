// Test réel du moteur vidéo procédural : rend 4 thèmes + mesure du temps
import { renderVideo } from '../src/lib/brain/videogen'
import { stat } from 'fs/promises'

const PROMPTS = [
  'un vol de drone au-dessus de montagnes au crépuscule',
  'une tempête de pluie sur les collines',
  'traverse la ville cyberpunk la nuit',
  'voyage dans l\'espace vers une planète lointaine',
  'aurore boréale au-dessus du lac gelé',
  'vagues sur l\'océan au coucher du soleil',
]

async function main() {
  const t0 = Date.now()
  const only = process.argv[2]
  for (const p of PROMPTS) {
    if (only && !p.includes(only)) continue
    try {
      const res = await renderVideo(p, { duration: 5, quality: 'speed' })
      const s = await stat(res.filePath)
      console.log(`OK « ${p} » → ${res.fileName} ${(s.size / 1024).toFixed(0)} Ko en ${res.ms} ms (${res.theme})`)
    } catch (e) {
      console.error(`ÉCHEC « ${p} » :`, e instanceof Error ? e.message : e)
      process.exitCode = 1
    }
  }
  console.log(`Total : ${Date.now() - t0} ms`)
}
main()
