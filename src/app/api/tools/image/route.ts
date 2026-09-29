// ─── NEXUS — Génération d'images 100 % locale ────────────────────────────────
// L'art procédural du cerveau local remplace l'API : composition algorithmique
// par graine déterministe (même prompt = même image), rastérisation PNG locale.
// Utilisé par le Studio Image (« Générer par IA ») comme par l'agent.

import { NextRequest } from 'next/server'
import { generateArt } from '@/lib/brain/artgen'
import { rasterizeSvg } from '@/lib/screenshot'

export const runtime = 'nodejs'
export const maxDuration = 60

const IMG_SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440']

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const prompt = String(body?.prompt ?? '').trim().slice(0, 1000)
    const size = IMG_SIZES.includes(String(body?.size)) ? String(body?.size) : '1024x1024'
    const variant = Math.max(0, Math.min(20, Number(body?.variant) || 0))

    if (!prompt) {
      return Response.json({ error: 'Un prompt est requis' }, { status: 400 })
    }

    // Format : garde paysage/portrait/carré selon la demande
    const hint = size === '1344x768' || size === '1152x864' || size === '1440x720' ? '1344x768' : size === '768x1344' || size === '864x1152' || size === '720x1440' ? '768x1344' : '1024x1024'

    const art = generateArt(prompt, hint as '1024x1024', variant)
    const png = await rasterizeSvg(art.svg, art.width, art.height)
    const dataUrl = png ?? `data:image/svg+xml;base64,${Buffer.from(art.svg, 'utf8').toString('base64')}`

    return Response.json({ dataUrl, prompt, size: `${art.width}x${art.height}`, style: art.style, seed: art.seed })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la génération de l’image' },
      { status: 500 }
    )
  }
}
