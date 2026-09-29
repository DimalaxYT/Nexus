import { NextRequest } from 'next/server'
import { captureScreenshot } from '@/lib/screenshot'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET ?url=… — capture d'écran réelle d'une page web (le « regard » de NEXUS).
 * → { dataUrl, title } ou { error }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const url = String(searchParams.get('url') ?? '').trim().slice(0, 800)
  if (!/^https?:\/\/.+/i.test(url)) {
    return Response.json({ error: 'URL invalide' }, { status: 400 })
  }
  const shot = await captureScreenshot(url)
  if (!shot) {
    return Response.json({ error: 'Capture impossible (site inaccessible ou trop lent)' }, { status: 502 })
  }
  return Response.json({ dataUrl: shot.dataUrl, title: shot.title, url })
}
