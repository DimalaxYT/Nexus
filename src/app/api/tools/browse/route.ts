// ─── NEXUS — Lecture de page 100 % locale (le « navigateur de NEXUS ») ────────
// Plus aucun SDK : fetch direct + extraction de texte locale + capture
// d'écran réelle via Chromium local. L'utilisateur voit exactement ce que
// NEXUS voit (image), pas seulement le texte.

import { NextRequest } from 'next/server'
import { captureScreenshot } from '@/lib/screenshot'
import { readWebpage } from '@/lib/brain/search'
import { validateSafeExternalUrl } from '@/lib/security'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * POST { url } — lit une page web côté serveur et renvoie { title, text, url,
 * screenshot? } : le texte extrait localement + la capture d'écran réelle.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const rawUrl = String(body?.url ?? '').trim().slice(0, 800)
  const safe = await validateSafeExternalUrl(rawUrl)
  if (!safe.ok || !safe.url) {
    return Response.json({ error: safe.reason || 'URL invalide ou non autorisée' }, { status: 400 })
  }
  const url = safe.url

  try {
    let title = url
    let text = ''
    try {
      const page = await readWebpage(url, 9000)
      if (page) {
        title = page.title
        text = page.text
      }
    } catch {
      // fetch direct impossible : la capture d'écran seule suffit
    }
    // Capture d'écran réelle (échec silencieux : le texte reste suffisant)
    const shot = await captureScreenshot(url)
    if (!text && !shot) {
      return Response.json({ error: 'Page illisible (lecture et capture impossibles — réseau ?)' }, { status: 502 })
    }
    if (shot && title === url) title = shot.title || url
    return Response.json({
      title,
      text: text || '(texte indisponible — visuel seulement)',
      url,
      ...(shot ? { screenshot: shot.dataUrl, shotTitle: shot.title } : {}),
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible' },
      { status: 500 }
    )
  }
}
