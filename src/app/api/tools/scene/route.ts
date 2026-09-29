// ─── NEXUS — Génération de scène 3D 100 % locale ─────────────────────────────
// Composition procédurale du cerveau local : thème détecté, placement
// déterministe des objets, éclairage cohérent. Aucune API.

import { NextRequest } from 'next/server'
import { generateSceneLocal } from '@/lib/brain/scenegen'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const brief = String(body?.brief ?? '').trim().slice(0, 900)
    const mode = String(body?.mode ?? 'create')
    if (!brief) {
      return Response.json({ error: 'Un brief est requis' }, { status: 400 })
    }
    const scene = generateSceneLocal(brief)
    return Response.json({ scene, mode })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la génération de la scène' },
      { status: 500 }
    )
  }
}
