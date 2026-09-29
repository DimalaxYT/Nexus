// Test recherche de chaîne + dernière vidéo (round 13)
import { searchYouTubeChannels, latestChannelVideo, readYouTubeVideo, formatDuration } from '../src/lib/brain/youtube'

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

const SUBJECT_STOP = new Set(['et', 'ou', 'pour', 'me', 'moi', 'de', 'du', 'la', 'le', 'les', 'dis', 'dire', 'dit', 'parle', 'parler', 'quoi', 'elle', 'il', 'son', 'sa', 'ses', 'ces', 'cette', 'ce', 'qui', 'que', 'en', 'y', 'a', 'ensuite', 'apres', 'après', 'sur', 'veux', 'voudrais', 'peux', 'tu', 'te', 'toi'])

/** Extrait le sujet (chaîne) d'une demande « regarde la dernière vidéo de X ». */
function extractVideoSubject(text: string): string {
  const cleaned = text.replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim()
  const m =
    cleaned.match(/(?:vid[ée]os?|cha[îi]nes?|youtube)\s*(?:youtube\s*)?(?:de|du|d'|sur)\s+([\p{L}\d'’-]+(?:\s+[\p{L}\d'’-]+)?)/iu) ??
    cleaned.match(/(?:de|du|d')\s+([\p{L}\d'’-]+(?:\s+[\p{L}\d'’-]+)?)\s*(?:me\s*)?(?:dire|dis|parle)/iu)
  if (!m) return ''
  const kept: string[] = []
  for (const w of m[1].trim().split(/\s+/)) {
    if (SUBJECT_STOP.has(w.toLowerCase())) break
    kept.push(w)
  }
  return kept.join(' ').trim()
}

async function main() {
  const user = 'Peux tu regarder la dernière vidéo youtube de fugu et me dire de quoi elle parle?'
  const subject = extractVideoSubject(user)
  console.log('sujet extrait:', JSON.stringify(subject))
  const subjNorm = normalize(subject)

  // 1) Recherche de CHAÎNES
  const channels = await searchYouTubeChannels(subject, 6)
  console.log(`\nchaînes trouvées: ${channels.length}`)
  for (const c of channels) console.log(`  ${c.title} — ${c.handle || c.channelId}`)

  // 2) Sélection de la meilleure chaîne (match normalisé)
  const scored = channels
    .map((c) => {
      const t = normalize(c.title)
      let score = 0
      if (t === subjNorm) score += 3
      if (t.includes(subjNorm)) score += 2
      if (subjNorm.includes(t)) score += 1
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  if (!best || best.score <= 0) {
    console.log('aucune chaîne matchée !')
    return
  }
  console.log(`\nchaîne retenue: ${best.c.title} (score ${best.score})`)

  // 3) SA dernière vidéo
  const latest = await latestChannelVideo(best.c.channelId, best.c.handle)
  if (!latest) {
    console.log('onglet /videos illisible !')
    return
  }
  console.log(`dernière vidéo: « ${latest.title} » — ${latest.channel} ${latest.duration}`)
  console.log(`url: ${latest.url}`)
  console.log(`snippet: ${latest.snippet.slice(0, 200)}`)

  // 4) Enrichissement (description)
  const video = await readYouTubeVideo(latest.url)
  console.log(`\nenrichissement: source=${video?.source}, description=${video?.description.length ?? 0} car, auteur=${video?.author}, durée=${video ? formatDuration(video.durationSec) : ''}`)
  if (video?.description) console.log('description:', video.description.slice(0, 300))
}

main()
