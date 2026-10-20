// ─── NEXUS — Application des correctifs ──────────────────────────────────────
// Module partagé par la route `/api/dev/patches`, l'agent Dev et le dashboard.
// Une seule règle : on sauvegarde AVANT d'écrire, et on refuse plutôt que
// d'écrire au mauvais endroit (ancre disparue, ancre multiple, fichier absent).

import fs from 'fs'
import { DevFsError, safePath, writeGuarded } from './devfs'
import { db } from './db'

export interface PatchRowLike {
  id?: unknown
  title?: unknown
  filePath?: unknown
  before?: unknown
  after?: unknown
  rationale?: unknown
  status?: unknown
  origin?: unknown
  createdAt?: unknown
  appliedAt?: unknown
}

export interface PatchView {
  id: string
  title: string
  filePath: string
  before: string
  after: string
  rationale: string
  status: string
  origin: string
  createdAt: unknown
  appliedAt: unknown
  /** Tailles réelles, même quand le contenu n'est pas renvoyé (liste légère). */
  beforeBytes: number
  afterBytes: number
  hasContent: boolean
}

export interface ApplyOutcome {
  id: string
  title: string
  filePath: string
  ok: boolean
  backup?: string
  bytes?: number
  created?: boolean
  error?: string
}

/** Forme publique d'une ligne de correctif. `light` omet les gros contenus. */
export function shapePatch(row: PatchRowLike, opts: { light?: boolean } = {}): PatchView {
  const before = String(row?.before ?? '')
  const after = String(row?.after ?? '')
  const hasContent = Boolean(before.length || after.length)
  return {
    id: String(row?.id ?? ''),
    title: String(row?.title ?? ''),
    filePath: String(row?.filePath ?? ''),
    before: opts.light ? '' : before,
    after: opts.light ? '' : after,
    rationale: String(row?.rationale ?? ''),
    status: String(row?.status ?? 'propose'),
    origin: String(row?.origin ?? 'agent'),
    createdAt: row?.createdAt,
    appliedAt: row?.appliedAt ?? null,
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
    hasContent,
  }
}

const KNOWLEDGE_BANK_PATH = 'src/lib/brain/knowledge-bank.ts'
const KNOWLEDGE_MARKER = 'export const NEXUS_KNOWLEDGE: KnowledgeEntry[] = ['

/**
 * Rattrapage des correctifs de connaissance créés AVANT le changement d'ancre :
 * leur ancre (fin de tableau) a pu disparaître après l'application d'un autre
 * correctif. On retrouve l'entrée ajoutée à la fin de `after` et on l'insère
 * après la ligne de déclaration du tableau, qui est stable.
 */
function salvageKnowledgePatch(filePath: string, current: string, after: string): string | null {
  if (filePath !== KNOWLEDGE_BANK_PATH) return null
  if (!current.includes(KNOWLEDGE_MARKER)) return null
  const tail = after.replace(/\s*\]\s*$/, '')
  const index = tail.lastIndexOf('\n  {')
  if (index < 0) return null
  const entry = tail.slice(index + 1).trimEnd()
  if (!entry.trimStart().startsWith('{') || !entry.endsWith('},')) return null
  const questionLine = entry
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('question:')) ?? ''
  if (questionLine && current.includes(questionLine)) return current
  return current.replace(KNOWLEDGE_MARKER, `${KNOWLEDGE_MARKER}\n${entry}`)
}

/**
 * Applique un correctif au disque (sans toucher à la base).
 * - `before` renseigné → remplacement d'une ancre unique ;
 * - `before` vide + fichier absent → création ;
 * - `before` vide + fichier présent → ajout en fin de fichier (rétro-compatibilité).
 */
export function applyPatchToDisk(patch: { filePath?: unknown; before?: unknown; after?: unknown; title?: unknown }): {
  backup: string
  bytes: number
  created: boolean
} {
  const filePath = String(patch?.filePath ?? '')
  const before = String(patch?.before ?? '')
  const after = String(patch?.after ?? '')
  if (!filePath) throw new DevFsError('Correctif sans fichier cible.')
  if (!after && !before) throw new DevFsError('Correctif vide : rien à appliquer.')

  const abs = safePath(filePath)
  const exists = fs.existsSync(abs)

  if (!exists) {
    if (before.trim()) {
      throw new DevFsError(`Le fichier ${filePath} n'existe pas : l'ancre ne peut pas être remplacée.`)
    }
    const content = after.endsWith('\n') ? after : `${after}\n`
    const result = writeGuarded(filePath, content)
    return { ...result, created: true }
  }

  if (!fs.statSync(abs).isFile()) throw new DevFsError(`${filePath} n'est pas un fichier.`)
  const current = fs.readFileSync(abs, 'utf8')

  // Un correctif de CRÉATION ne doit jamais s'ajouter en fin d'un fichier qui
  // est apparu entre-temps : ce serait une écriture au mauvais endroit.
  const isCreate = /^\s*cr[ée]er\b/i.test(String(patch?.title ?? ''))
  if (isCreate && !before.trim() && current.trim()) {
    throw new DevFsError(`${filePath} existe déjà : création annulée plutôt qu’un ajout en fin de fichier.`)
  }

  let next: string
  if (before.trim()) {
    const occurrences = current.split(before).length - 1
    if (occurrences === 0) {
      const salvaged = salvageKnowledgePatch(filePath, current, after)
      if (salvaged === current) {
        throw new DevFsError('Cette entrée de connaissance est déjà présente dans la banque intégrée.')
      }
      if (!salvaged) {
        throw new DevFsError('L’ancre n’existe plus dans le fichier : le code a changé depuis la proposition.')
      }
      next = salvaged
    } else if (occurrences > 1) {
      throw new DevFsError(`L’ancre apparaît ${occurrences} fois : application refusée par prudence.`)
    } else {
      // Fonction de remplacement : évite toute interprétation des motifs `$&`.
      next = current.replace(before, () => after)
    }
  } else {
    next = `${current.replace(/\s*$/, '')}\n\n${after.replace(/\s*$/, '')}\n`
  }

  if (next === current) throw new DevFsError('Le correctif ne change rien : contenu identique après application.')
  const result = writeGuarded(filePath, next)
  return { ...result, created: false }
}

/**
 * Après une écriture réussie, les autres correctifs en attente sur le MÊME
 * fichier dont l'ancre a disparu ne sont plus applicables : on les marque
 * « obsolete » pour qu'ils ne polluent plus la file ni « Tout appliquer ».
 */
async function markObsoleteSiblings(appliedId: string, filePath: string): Promise<void> {
  if (!filePath) return
  let next = ''
  try {
    next = fs.readFileSync(safePath(filePath), 'utf8')
  } catch {
    return
  }
  const rows = (await db.devPatch
    .findMany({ where: { filePath, status: 'propose' }, take: 80 })
    .catch(() => [])) as PatchRowLike[]
  for (const row of rows ?? []) {
    const id = String(row.id ?? '')
    if (!id || id === appliedId) continue
    const before = String(row.before ?? '')
    if (!before.trim()) continue
    if (next.includes(before)) continue
    await db.devPatch.update({ where: { id }, data: { status: 'obsolete' } }).catch(() => null)
  }
}

/**
 * Applique une liste de correctifs dans l'ordre fourni. Chaque échec est
 * consigné et n'empêche pas les suivants : on veut un rapport complet.
 */
export async function applyPatchIds(ids: string[]): Promise<ApplyOutcome[]> {
  const outcomes: ApplyOutcome[] = []
  const seen = new Set<string>()

  for (const rawId of ids ?? []) {
    const id = String(rawId ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    const row = (await db.devPatch.findUnique({ where: { id } }).catch(() => null)) as PatchRowLike | null
    if (!row) {
      outcomes.push({ id, title: id, filePath: '', ok: false, error: 'Correctif introuvable.' })
      continue
    }
    const title = String(row.title ?? '')
    const filePath = String(row.filePath ?? '')

    const status = String(row.status ?? 'propose')
    if (status === 'applique') {
      outcomes.push({ id, title, filePath, ok: false, error: 'Correctif déjà appliqué.' })
      continue
    }
    if (status === 'refuse') {
      outcomes.push({ id, title, filePath, ok: false, error: 'Correctif refusé : restaure-le avant de l’appliquer.' })
      continue
    }

    try {
      const result = applyPatchToDisk(row)
      // Le fichier est écrit : une erreur de journalisation ne doit pas faire
      // croire que l'opération a échoué.
      await db.devPatch
        .update({ where: { id }, data: { status: 'applique', appliedAt: new Date() } })
        .catch(() => null)
      await markObsoleteSiblings(id, filePath)
      outcomes.push({
        id,
        title,
        filePath,
        ok: true,
        backup: result.backup,
        bytes: result.bytes,
        created: result.created,
      })
    } catch (err) {
      outcomes.push({
        id,
        title,
        filePath,
        ok: false,
        error: err instanceof DevFsError ? err.message : err instanceof Error ? err.message : 'Application impossible.',
      })
    }
  }

  return outcomes
}

/** Applique tous les correctifs en attente (ordre de création). */
export async function applyAllProposed(opts: { limit?: number } = {}): Promise<{
  outcomes: ApplyOutcome[]
  total: number
}> {
  const limit = Math.min(Math.max(opts.limit ?? 80, 1), 200)
  const rows = (await db.devPatch.findMany({
    where: { status: 'propose' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })) as PatchRowLike[]
  const outcomes = await applyPatchIds((rows ?? []).map((r) => String(r.id ?? '')))
  return { outcomes, total: rows?.length ?? 0 }
}
