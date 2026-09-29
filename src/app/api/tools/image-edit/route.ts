// ─── NEXUS — Retouche image IA : mode local honnête ───────────────────────────
// La retouche IA par prompt exige un modèle distant. NEXUS est 100 % local :
// cette route l'explique et redirige vers les filtres 100 % locaux du Studio
// Image (luminosité, contraste, saturation, recadrage, pinceau, texte…).

import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

const MESSAGE =
  'La retouche IA par texte nécessite un modèle distant. NEXUS est en mode 100 % local : utilise les outils du Studio Image qui sont eux 100 % locaux — filtres (luminosité, contraste, saturation, flou, nuance), recadrage, pinceau, texte et export.'

export async function POST() {
  return Response.json({ error: MESSAGE, localMode: true }, { status: 503 })
}
