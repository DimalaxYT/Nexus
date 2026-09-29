import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isDuplicateMemory } from '@/lib/memory-utils'

export const runtime = 'nodejs'

const KINDS = ['fact', 'preference', 'project', 'person', 'other']
const MAX_MEMORIES = 100

/** Récupère les mémoires, les plus récentes d'abord. */
export async function GET() {
  try {
    const memories = await db.memory.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return Response.json({ memories })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}

/** Ajoute une mémoire (manuelle ou auto) avec déduplication par similarité de mots. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const content = String(body?.content ?? '').trim().slice(0, 400)
    if (!content) {
      return Response.json({ error: 'Contenu requis' }, { status: 400 })
    }
    const kind = KINDS.includes(String(body?.kind)) ? String(body.kind) : 'fact'
    const source = String(body?.source) === 'manual' ? 'manual' : 'auto'

    // Déduplication : rejet si très proche d'une mémoire existante
    const existing = await db.memory.findMany({ select: { id: true, content: true } })
    if (isDuplicateMemory(content, existing)) {
      return Response.json({ memory: null, duplicate: true })
    }

    const memory = await db.memory.create({ data: { content, kind, source } })

    // Purge des plus anciennes mémoires automatiques si le quota est dépassé
    const count = await db.memory.count()
    if (count > MAX_MEMORIES) {
      const old = await db.memory.findMany({
        where: { source: 'auto' },
        orderBy: { createdAt: 'asc' },
        take: count - MAX_MEMORIES,
        select: { id: true },
      })
      if (old.length > 0) {
        await db.memory.deleteMany({ where: { id: { in: old.map((m) => m.id) } } })
      }
    }

    return Response.json({ memory, duplicate: false })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}

/** Supprime une mémoire (?id=) ou tout effacer (?all=1). */
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    const all = req.nextUrl.searchParams.get('all')
    if (all === '1') {
      await db.memory.deleteMany({})
      return Response.json({ ok: true })
    }
    if (!id) {
      return Response.json({ error: 'id requis' }, { status: 400 })
    }
    await db.memory.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Erreur base de données' },
      { status: 500 }
    )
  }
}
