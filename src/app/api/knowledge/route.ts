import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { parseKnowledgeRow } from '@/lib/nexus-types'

export const runtime = 'nodejs'

/** GET /api/knowledge?q=mot&category=Programmation — liste + recherche plein texte */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()
  const category = (req.nextUrl.searchParams.get('category') ?? '').trim().toLowerCase()
  try {
    const rows = await db.knowledge.findMany({ orderBy: { updatedAt: 'desc' }, take: 300 })
    let items = rows.map(parseKnowledgeRow)
    if (q) {
      items = items.filter(
        (k) =>
          k.title.toLowerCase().includes(q) ||
          k.content.toLowerCase().includes(q) ||
          k.category.toLowerCase().includes(q) ||
          k.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    if (category) items = items.filter((k) => k.category.toLowerCase().startsWith(category))
    return Response.json({ items })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur de lecture de la base de connaissances' },
      { status: 500 }
    )
  }
}

/** POST /api/knowledge — création ou mise à jour (si id fourni) */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const title = String(body?.title ?? '').trim().slice(0, 160)
  const content = String(body?.content ?? '').trim().slice(0, 20000)
  if (!title || !content) {
    return Response.json({ error: 'Titre et contenu requis' }, { status: 400 })
  }
  const category = String(body?.category ?? 'Général').trim().slice(0, 120) || 'Général'
  const tags = Array.isArray(body?.tags)
    ? body.tags.map((t: unknown) => String(t).trim().slice(0, 40)).filter(Boolean).slice(0, 12)
    : []
  const links = Array.isArray(body?.links)
    ? body.links.map((l: unknown) => String(l).trim().slice(0, 160)).filter(Boolean).slice(0, 12)
    : []
  const source = body?.source === 'agent' ? 'agent' : 'manual'
  const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : null

  try {
    const row = id
      ? await db.knowledge.update({
          where: { id },
          data: { title, content, category, tags: JSON.stringify(tags), links: JSON.stringify(links) },
        })
      : await db.knowledge.create({
          data: { title, content, category, tags: JSON.stringify(tags), links: JSON.stringify(links), source },
        })
    return Response.json({ item: parseKnowledgeRow(row) })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur d’écriture dans la base de connaissances' },
      { status: 500 }
    )
  }
}

/** DELETE /api/knowledge?id=… | ?all=1 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const all = req.nextUrl.searchParams.get('all')
  try {
    if (all === '1') {
      await db.knowledge.deleteMany({})
      return Response.json({ ok: true, deleted: 'all' })
    }
    if (!id) return Response.json({ error: 'Paramètre id requis' }, { status: 400 })
    await db.knowledge.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur de suppression' },
      { status: 500 }
    )
  }
}
