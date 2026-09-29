// ─── NEXUS — Génération de code 100 % locale (Studio Code) ───────────────────
// Le générateur local du cerveau produit des pages HTML/CSS/JS complètes
// depuis des templates paramétrés. Aucune API.

import { NextRequest } from 'next/server'
import { generateWebpageLocal } from '@/lib/brain/webpagegen'
import { generateCodeLocal } from '@/lib/brain/codegen'
import { extractEntities } from '@/lib/brain/entities'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const prompt = String(body?.prompt ?? '').trim().slice(0, 1200)
    if (!prompt) {
      return Response.json({ error: 'Un prompt est requis' }, { status: 400 })
    }

    // Demande de script (langage précis) → mode script ; sinon page web interactive
    const entities = extractEntities(prompt)
    const wantsScript = /\b(script|programme|fonction|algorithme|fichier)\b/i.test(prompt) || Boolean(entities.language && entities.language !== 'html')

    if (wantsScript && !/\b(page|site|web|html)\b/i.test(prompt)) {
      const gen = generateCodeLocal(prompt, entities, prompt)
      // Le Studio Code affiche html/css/js : un script part en `js` (éditeur + téléchargement)
      return Response.json({
        files: { html: '', css: '', js: gen.code, language: gen.language, filename: gen.filename },
      })
    }

    const page = generateWebpageLocal(prompt, prompt)
    return Response.json({ files: { html: page.html, css: page.css, js: page.js } })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur lors de la génération du code' },
      { status: 500 }
    )
  }
}
