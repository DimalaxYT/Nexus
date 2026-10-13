// ─── Dashboard Dev — explorateur de code (lecture seule) ─────────────────────
// ?action=tree   → arborescence
// ?action=read   → contenu d'un fichier (+ fenêtre de lignes)
// ?action=search → recherche texte dans tout le projet
// ?action=analyze→ analyse statique d'un fichier

import { devGuard } from '@/lib/auth'
import { DevFsError, analyzeFile, listTree, readFile, searchCode } from '@/lib/devfs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const action = url.searchParams.get('action') ?? 'tree'

  try {
    if (action === 'tree') {
      const rel = url.searchParams.get('path') ?? ''
      const depth = Math.min(Number(url.searchParams.get('depth') ?? 2) || 2, 6)
      return Response.json({ entries: listTree(rel, depth) })
    }

    if (action === 'read') {
      const rel = url.searchParams.get('path')
      if (!rel) return Response.json({ error: 'Paramètre `path` requis.' }, { status: 400 })
      const from = Number(url.searchParams.get('from') ?? 0) || undefined
      const to = Number(url.searchParams.get('to') ?? 0) || undefined
      return Response.json({ file: readFile(rel, from, to) })
    }

    if (action === 'search') {
      const q = url.searchParams.get('q') ?? ''
      const regex = url.searchParams.get('regex') === '1'
      const max = Math.min(Number(url.searchParams.get('max') ?? 60) || 60, 200)
      return Response.json({ hits: searchCode(q, { regex, max }) })
    }

    if (action === 'analyze') {
      const rel = url.searchParams.get('path')
      if (!rel) return Response.json({ error: 'Paramètre `path` requis.' }, { status: 400 })
      return Response.json({ analysis: analyzeFile(rel) })
    }

    return Response.json({ error: 'Action inconnue.' }, { status: 400 })
  } catch (err) {
    const message = err instanceof DevFsError ? err.message : err instanceof Error ? err.message : 'Lecture impossible'
    return Response.json({ error: message }, { status: 400 })
  }
}
