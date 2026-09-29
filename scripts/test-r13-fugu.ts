// Test du flux « regarde la dernière vidéo de fugu » (round 13)
import { searchYouTubeNative, readYouTubeVideo, formatDuration } from '../src/lib/brain/youtube'

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Extrait le sujet (chaîne) d'une demande « regarde la dernière vidéo de X ». */
function extractVideoSubject(text: string): string {
  const cleaned = text
    .replace(/[?!.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // après « de/du/d' » le plus proche de « vidéo(…)? »
  const m = cleaned.match(/(?:vid[ée]o|chaine|chaîne|youtube)\s*(?:youtube\s*)?(?:de|du|d'|sur)\s+([\p{L}\d'-]+(?:\s+[\p{L}\d'-]+)?)/iu)
  if (m) return m[1].trim()
  const m2 = cleaned.match(/(?:de|du|d')\s+([\p{L}\d'-]+)\s*(?:et|pour|me)?\s*(?:me\s*)?(?:dire|dis|parle)/iu)
  if (m2) return m2[1].trim()
  return ''
}

async function main() {
  const user = 'Peux tu regarder la dernière vidéo youtube de fugu et me dire de quoi elle parle?'
  const subject = extractVideoSubject(user)
  console.log('sujet extrait:', JSON.stringify(subject))
  const subjNorm = normalize(subject)

  const variants = [subject ? `dernière vidéo ${subject}` : '', subject, 'fugu'].filter(Boolean)
  const seen = new Set<string>()
  let all: Awaited<ReturnType<typeof searchYouTubeNative>> = []
  for (const q of variants) {
    const hits = await searchYouTubeNative(q, 8)
    console.log(`\nquery « ${q} » → ${hits.length} hits`)
    for (const h of hits) {
      if (seen.has(h.videoId)) continue
      seen.add(h.videoId)
      all.push(h)
    }
    if (all.length >= 8) break
  }

  // Tri : chaîne qui contient le sujet en priorité
  const channelMatch = all.filter((h) => subjNorm && normalize(h.channel).includes(subjNorm))
  console.log(`\ntotal unique: ${all.length} — correspondances de chaîne: ${channelMatch.length}`)
  for (const h of all.slice(0, 8)) {
    console.log(`  ${channelMatch.includes(h) ? '🎯' : '  '} « ${h.title.slice(0, 70)} » — ${h.channel} ${h.duration}`)
  }

  // Lire la meilleure vidéo (description)
  const best = channelMatch[0] ?? all[0]
  if (best) {
    console.log(`\n→ lecture de « ${best.title} » (${best.url})`)
    const video = await readYouTubeVideo(best.url)
    if (video) {
      console.log(`titre: ${video.title}\nauteur: ${video.author}\ndurée: ${formatDuration(video.durationSec)}\nsource: ${video.source}\ndescription (${video.description.length} car): ${video.description.slice(0, 300)}`)
      console.log(`transcript: ${video.transcript ? `${video.transcript.split(/\s+/).length} mots : ${video.transcript.slice(0, 200)}…` : 'bloqué'}`)
    } else {
      console.log('lecture impossible — on utilisera le snippet de recherche')
    }
  }
}

main()
