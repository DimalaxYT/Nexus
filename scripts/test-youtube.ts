// Test du lecteur YouTube : titre + description + transcription
import { readYouTubeVideo, extractVideoId } from '../src/lib/brain/youtube'

async function main() {
  const urls = [
    'https://www.youtube.com/watch?v=zjkBMFhNj_g', // « Intro to LLMs » (3Blue1Brown-like, subtitles FR)
    'https://youtu.be/aircAruvnKk', // 3Blue1Brown — But what is a neural network
    'https://www.youtube.com/results?search_query=test', // pas une vidéo
  ]
  for (const url of urls) {
    console.log('—', url, '→ id:', extractVideoId(url))
    const v = await readYouTubeVideo(url)
    if (!v) {
      console.log('  ✗ inaccessible (repli sur extraits prévu)')
      continue
    }
    console.log('  titre :', v.title.slice(0, 80))
    console.log('  auteur:', v.author, '| durée:', v.durationSec, 's')
    console.log('  descr :', v.description.slice(0, 120).replace(/\n/g, ' '))
    console.log('  transcription:', v.transcript ? `${v.transcript.split(/\s+/).length} mots — « ${v.transcript.slice(0, 150)}… »` : 'INDISPONIBLE')
  }
}
main()
