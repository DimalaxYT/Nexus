// ─── Dashboard Dev — correctifs proposés ─────────────────────────────────────
// GET    → liste des correctifs. `?light=1` = résumés (sans le contenu),
//          `?id=…` = un correctif complet (utilisé pour afficher son diff).
// POST   → { action: 'apply', id }            applique un correctif (sauvegarde d'abord)
//          { action: 'apply', ids: [...] }     applique une sélection, dans l'ordre
//          { action: 'applyAll' }              applique tous les correctifs en attente
//          { action: 'create', ... }           dépose un correctif à la main
// PATCH  → { id, status }                       propose / applique / refuse
// DELETE → ?id=                                 supprime

import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { DevFsError, safePath } from '@/lib/devfs'
import { applyAllProposed, applyPatchIds, shapePatch } from '@/lib/devpatch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (id) {
    const row = await db.devPatch.findUnique({ where: { id } })
    if (!row) return Response.json({ error: 'Correctif introuvable.' }, { status: 404 })
    return Response.json({ patch: shapePatch(row) })
  }

  const light = ['1', 'true', 'light'].includes(String(url.searchParams.get('light') ?? ''))
  const rows = await db.devPatch.findMany({ orderBy: { createdAt: 'desc' }, take: 80 })
  return Response.json({ patches: (rows ?? []).map((row: Parameters<typeof shapePatch>[0]) => shapePatch(row, { light })) })
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const body = await req.json().catch(() => null)

  if (body?.action === 'apply') {
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.map((v: unknown) => String(v ?? '')).filter(Boolean)
      : body?.id
        ? [String(body.id)]
        : []
    if (!ids.length) return Response.json({ error: 'Identifiant(s) requis.' }, { status: 400 })

    const results = await applyPatchIds(ids)
    const applied = results.filter((r) => r.ok)
    const failed = results.filter((r) => !r.ok)

    // Compatibilité avec l'ancien contrat mono-correctif.
    if (ids.length === 1 && results[0]) {
      const only = results[0]
      if (!only.ok) return Response.json({ error: only.error ?? 'Application impossible' }, { status: 400 })
      const row = await db.devPatch.findUnique({ where: { id: only.id } }).catch(() => null)
      return Response.json({
        ok: true,
        patch: row ? shapePatch(row) : null,
        backup: only.backup,
        bytes: only.bytes,
        created: only.created,
      })
    }

    return Response.json({
      ok: failed.length === 0,
      applied: applied.length,
      failed: failed.length,
      results,
    })
  }

  if (body?.action === 'applyAll') {
    const { outcomes, total } = await applyAllProposed()
    const applied = outcomes.filter((r) => r.ok)
    const failed = outcomes.filter((r) => !r.ok)
    return Response.json({
      ok: failed.length === 0,
      total,
      applied: applied.length,
      failed: failed.length,
      results: outcomes,
    })
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
    return Response.json({ ok: true, patch: shapePatch(row) })
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
  return Response.json({ ok: true, patch: shapePatch(row) })
}

export async function DELETE(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return Response.json({ error: 'Identifiant requis.' }, { status: 400 })
  await db.devPatch.delete({ where: { id } })
  return Response.json({ ok: true })
}
