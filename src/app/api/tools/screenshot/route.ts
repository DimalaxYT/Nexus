import { NextRequest } from 'next/server'
import { captureScreenshot } from '@/lib/screenshot'
import { validateSafeExternalUrl } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET ?url=… — capture d'écran réelle d'une page web (le « regard » de NEXUS).
 * → { dataUrl, title } ou { error }
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawUrl = String(searchParams.get('url') ?? '').trim().slice(0, 800)
  const safe = await validateSafeExternalUrl(rawUrl)
  if (!safe.ok || !safe.url) {
    return Response.json({ error: safe.reason || 'URL invalide ou non autorisée' }, { status: 400 })
  }
  const url = safe.url
  const shot = await captureScreenshot(url)
  if (!shot) {
    return Response.json({ error: 'Capture impossible (site inaccessible ou trop lent)' }, { status: 502 })
  }
  return Response.json({ dataUrl: shot.dataUrl, title: shot.title, url })
}
