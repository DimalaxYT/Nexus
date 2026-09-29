// Test E2E de l'API vidéo : POST tâche → polling → GET fichier (Range)
const BASE = 'http://localhost:3000'

async function main() {
  const post = await fetch(`${BASE}/api/tools/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'un vol de drone au-dessus de montagnes au crépuscule', duration: 5, quality: 'speed' }),
  })
  const created = (await post.json()) as { taskId?: string; error?: string }
  if (!post.ok || !created.taskId) {
    console.error('POST KO :', created)
    process.exit(1)
  }
  console.log('POST OK → taskId', created.taskId)

  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const poll = await fetch(`${BASE}/api/tools/video?taskId=${created.taskId}`)
    const state = (await poll.json()) as { status: string; url?: string; error?: string; elapsed?: number }
    if (state.status === 'SUCCESS' && state.url) {
      console.log(`SUCCESS en ~${(i + 1) * 2}s → ${state.url}`)
      // Récupération du fichier (requête simple)
      const file = await fetch(`${BASE}${state.url}`)
      const size = Number(file.headers.get('content-length') ?? 0)
      const type = file.headers.get('content-type')
      console.log(`Fichier : ${type} ${(size / 1024).toFixed(0)} Ko, accept-ranges=${file.headers.get('accept-ranges')}`)
      // Requête Range (seek)
      const ranged = await fetch(`${BASE}${state.url}`, { headers: { Range: 'bytes=0-1023' } })
      console.log(`Range 0-1023 → HTTP ${ranged.status}, content-range=${ranged.headers.get('content-range')}`)
      // Téléchargement
      const dl = await fetch(`${BASE}${state.url}&download=1`)
      console.log(`Download → HTTP ${dl.status}, disposition=${dl.headers.get('content-disposition')}`)
      if (ranged.status !== 206 || !type?.includes('mp4')) process.exit(1)
      console.log('E2E VIDÉO OK ✔')
      return
    }
    if (state.status === 'FAIL') {
      console.error('FAIL :', state.error)
      process.exit(1)
    }
  }
  console.error('Timeout de polling')
  process.exit(1)
}
main()
