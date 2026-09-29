// ─── NEXUS — Service du fichier vidéo généré (MP4 local) ─────────────────────
// GET ?id=vid-… → stream du MP4 avec support Range (lecture + seek fluides).
// &download=1 → téléchargement (Content-Disposition attachement).

import { NextRequest } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'

export const runtime = 'nodejs'

const VIDEO_DIR = path.join(process.cwd(), 'public', 'generated', 'videos')

function safeName(id: string): string | null {
  // Accepte « vid-xxxx » comme « vid-xxxx.mp4 » (jamais de chemin ni de points suspects)
  if (!/^[a-z0-9-]+$/i.test(id)) return null
  return id.toLowerCase().endsWith('.mp4') ? id : `${id}.mp4`
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim() ?? ''
  const name = safeName(id)
  if (!name) return Response.json({ error: 'Identifiant de vidéo invalide' }, { status: 400 })
  const filePath = path.join(VIDEO_DIR, name)

  let fileStat
  try {
    fileStat = await stat(filePath)
  } catch {
    return Response.json({ error: 'Vidéo introuvable (expirée ?)' }, { status: 404 })
  }

  const size = fileStat.size
  const download = req.nextUrl.searchParams.get('download') === '1'
  const headers = new Headers({
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  })
  if (download) headers.set('Content-Disposition', `attachment; filename="${name}"`)

  const range = req.headers.get('range')
  const match = range?.match(/bytes=(\d*)-(\d*)/)
  if (match) {
    const start = match[1] ? parseInt(match[1], 10) : 0
    const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    }
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
    headers.set('Content-Length', String(end - start + 1))
    const stream = createReadStream(filePath, { start, end }) as unknown as ReadableStream
    return new Response(stream, { status: 206, headers })
  }

  headers.set('Content-Length', String(size))
  const stream = createReadStream(filePath) as unknown as ReadableStream
  return new Response(stream, { status: 200, headers })
}
