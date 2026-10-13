// ─── Dashboard Dev — correctifs proposés ─────────────────────────────────────
// GET    → liste des correctifs
// POST   → { action: 'apply', id }   applique un correctif (sauvegarde d'abord)
//          { action: 'create', ... } dépose un correctif à la main
// PATCH  → { id, status }            propose / applique / refuse
// DELETE → ?id=                      supprime

import fs from 'fs'
import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { DevFsError, safePath, writeGuarded } from '@/lib/devfs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function shape(row: any) {
  return {
    id: String(row?.id ?? ''),
    title: String(row?.title ?? ''),
    filePath: String(row?.filePath ?? ''),
    before: String(row?.before ?? ''),
    after: String(row?.after ?? ''),
    rationale: String(row?.rationale ?? ''),
    status: String(row?.status ?? 'propose'),
    origin: String(row?.origin ?? 'agent'),
    createdAt: row?.createdAt,
    appliedAt: row?.appliedAt ?? null,
  }
}

/** Remplace l'ancre par son nouveau contenu, après sauvegarde. */
async function applyPatch(patch: any): Promise<{ backup: string; bytes: number }> {
  const filePath = String(patch?.filePath ?? '')
  const before = String(patch?.before ?? '')
  const after = String(patch?.after ?? '')
  if (!filePath) throw new DevFsError('Correctif sans fichier cible.')

  const abs = safePath(filePath)
  if (!fs.existsSync(abs)) throw new DevFsError(`Le fichier ${filePath} n'existe pas.`)
  const current = fs.readFileSync(abs, 'utf8')

  let next: string
  if (before.trim()) {
    const occurrences = current.split(before).length - 1
    if (occurrences === 0) {
      throw new DevFsError('L’ancre n’existe plus dans le fichier : le code a changé depuis la proposition.')
    }
    if (occurrences > 1) {
      throw new DevFsError(`L’ancre apparaît ${occurrences} fois : application refusée par prudence.`)
    }
    // Fonction de remplacement : évite toute interprétation des motifs `$&`.
    next = current.replace(before, () => after)
  } else {
    next = current.replace(/\s*$/, '') + '\n' + after + '\n'
  }

  return writeGuarded(filePath, next)
}

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const rows = await db.devPatch.findMany({ orderBy: { createdAt: 'desc' }, take: 60 })
  return Response.json({ patches: (rows ?? []).map(shape) })
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)

  if (body?.action === 'apply') {
    const id = String(body?.id ?? '')
    if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
    const patch = await db.devPatch.findUnique({ where: { id } })
    if (!patch) return Response.json({ error: 'Correctif introuvable.' }, { status: 404 })
    if (String(patch.status) === 'applique') {
      return Response.json({ error: 'Ce correctif a déjà été appliqué.' }, { status: 409 })
    }
    try {
      const { backup, bytes } = await applyPatch(patch)
      const updated = await db.devPatch.update({
        where: { id },
        data: { status: 'applique', appliedAt: new Date() },
      })
      return Response.json({ ok: true, patch: shape(updated), backup, bytes })
    } catch (err) {
      const message = err instanceof DevFsError ? err.message : err instanceof Error ? err.message : 'Application impossible'
      return Response.json({ error: message }, { status: 400 })
    }
  }

  if (body?.action === 'create') {
    const title = String(body?.title ?? '').trim().slice(0, 200)
    const filePath = String(body?.filePath ?? '').trim().slice(0, 300)
    if (!title || !filePath) {
      return Response.json({ error: 'Titre et fichier requis.' }, { status: 400 })
    }
    try {
      safePath(filePath) // refuse tout de suite un chemin interdit
    } catch (err) {
      return Response.json(
        { error: err instanceof DevFsError ? err.message : 'Chemin refusé.' },
        { status: 400 }
      )
    }
    const row = await db.devPatch.create({
      data: {
        userId: guard.userId,
        title,
        filePath,
        before: String(body?.before ?? '').slice(0, 200_000),
        after: String(body?.after ?? '').slice(0, 800_000),
        rationale: String(body?.rationale ?? '').slice(0, 2000),
        status: 'propose',
        origin: 'manuel',
        appliedAt: null,
      },
    })
    return Response.json({ ok: true, patch: shape(row) })
  }

  return Response.json({ error: 'Action inconnue.' }, { status: 400 })
}

export async function PATCH(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)
  const id = String(body?.id ?? '')
  const status = String(body?.status ?? '')
  if (!id || !['propose', 'applique', 'refuse'].includes(status)) {
    return Response.json({ error: 'Identifiant et statut valides requis.' }, { status: 400 })
  }
  const row = await db.devPatch.update({
    where: { id },
    data: { status, ...(status === 'applique' ? { appliedAt: new Date() } : {}) },
  })
  return Response.json({ ok: true, patch: shape(row) })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
  await db.devPatch.delete({ where: { id } })
  return Response.json({ ok: true })
}
