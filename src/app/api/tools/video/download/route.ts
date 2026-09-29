import { NextRequest } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * GET ?url=… — relais de téléchargement pour les vidéos générées :
 * le CDN n'envoie pas d'en-têtes CORS, le navigateur ne peut donc pas
 * récupérer le fichier en blob. Ce proxy rend le fichier same-origin
 * (chargement dans le Studio Vidéo + export webm possibles).
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')?.trim() ?? ''
  if (!/^https:\/\//i.test(url)) {
    return Response.json({ error: 'URL invalide' }, { status: 400 })
  }
  // Autorise uniquement les CDN de fichiers vidéo connus (anti-SSRF minimal)
  if (!/aigc-files\.bigmodel\.cn|bigmodel\.cn|z\.ai/i.test(new URL(url).hostname)) {
    return Response.json({ error: 'Domaine non autorisé' }, { status: 403 })
  }

  try {
    const upstream = await fetch(url, { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: 'Téléchargement impossible' }, { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return Response.json({ error: 'Téléchargement impossible' }, { status: 502 })
  }
}
