// ─── NEXUS — Décisions des confirmations (Accepter / Refuser) ───────────────
// Une confirmation porte sur une action réelle :
//   • patch → appliquer (ou écarter) un correctif de code ;
//   • item  → valider (ou rejeter) un savoir produit par l'entraînement ;
//   • task  → marquer une amélioration comme faite (ou refusée).
// Le même code sert au dashboard et aux liens signés du webhook, pour que les
// deux chemins aient exactement les mêmes garde-fous.

import { db } from './db'
import { applyPatchIds } from './devpatch'
import { getApprovalByToken, markApproval, publicWebhook, type ApprovalView } from './devwebhook'

export interface DecisionResult {
  ok: boolean
  error?: string
  message: string
  approval?: ApprovalView
}

async function findApproval(idOrToken: string, byToken: boolean): Promise<Record<string, unknown> | null> {
  if (byToken) {
    const view = await getApprovalByToken(idOrToken)
    if (!view) return null
    return (await db.devApproval.findUnique({ where: { id: view.id } }).catch(() => null)) as Record<string, unknown> | null
  }
  return (await db.devApproval.findUnique({ where: { id: idOrToken } }).catch(() => null)) as Record<string, unknown> | null
}

async function execute(action: 'accept' | 'refuse', kind: string, refId: string, decidedBy: string): Promise<{ ok: boolean; error?: string; message: string }> {
  if (kind === 'patch') {
    if (action === 'refuse') {
      const row = (await db.devPatch.findUnique({ where: { id: refId } }).catch(() => null)) as Record<string, unknown> | null
      if (!row) return { ok: false, error: 'Correctif introuvable.', message: 'Correctif introuvable.' }
      if (String(row.status) === 'applique') {
        return { ok: false, error: 'Ce correctif est déjà appliqué.', message: 'Déjà appliqué.' }
      }
      await db.devPatch.update({ where: { id: refId }, data: { status: 'refuse' } })
      return { ok: true, message: 'Correctif refusé : il ne sera pas appliqué.' }
    }
    const outcomes = await applyPatchIds([refId], { decidedBy })
    const result = outcomes[0]
    if (!result) return { ok: false, error: 'Correctif introuvable.', message: 'Correctif introuvable.' }
    if (!result.ok) return { ok: false, error: result.error ?? 'Application impossible.', message: result.error ?? 'Application impossible.' }
    return {
      ok: true,
      message: `Correctif appliqué à ${result.filePath}${result.backup ? ` (sauvegarde : ${result.backup})` : ''}.`,
    }
  }

  if (kind === 'item') {
    const row = (await db.trainingItem.findUnique({ where: { id: refId } }).catch(() => null)) as Record<string, unknown> | null
    if (!row) return { ok: false, error: 'Savoir introuvable.', message: 'Savoir introuvable.' }
    await db.trainingItem.update({
      where: { id: refId },
      data: action === 'accept'
        ? { status: 'valide', appliedAt: new Date() }
        : { status: 'rejete' },
    })
    return {
      ok: true,
      message: action === 'accept'
        ? 'Savoir validé : NEXUS peut l’utiliser dans ses réponses.'
        : 'Savoir rejeté : il ne sera pas utilisé.',
    }
  }

  if (kind === 'task') {
    const row = (await db.devTask.findUnique({ where: { id: refId } }).catch(() => null)) as Record<string, unknown> | null
    if (!row) return { ok: false, error: 'Amélioration introuvable.', message: 'Amélioration introuvable.' }
    await db.devTask.update({ where: { id: refId }, data: { status: action === 'accept' ? 'fait' : 'refuse' } })
    return { ok: true, message: action === 'accept' ? 'Amélioration marquée comme faite.' : 'Amélioration refusée.' }
  }

  return { ok: false, error: 'Type de confirmation inconnu.', message: 'Type inconnu.' }
}

/** Applique la décision d'une confirmation, puis notifie les webhooks. */
export async function decideApproval(
  idOrToken: string,
  action: 'accept' | 'refuse',
  decidedBy: string,
  opts: { byToken?: boolean } = {}
): Promise<DecisionResult> {
  const row = await findApproval(idOrToken, Boolean(opts.byToken))
  if (!row) return { ok: false, error: 'Confirmation introuvable ou lien invalide.', message: 'Confirmation introuvable.' }

  const status = String(row.status ?? 'pending')
  if (status !== 'pending') {
    return {
      ok: false,
      error: `Cette confirmation a déjà été ${status === 'accepted' ? 'acceptée' : 'refusée'}.`,
      message: 'Déjà traitée.',
      approval: undefined,
    }
  }

  const kind = String(row.kind ?? '')
  const refId = String(row.refId ?? '')
  const outcome = await execute(action, kind, refId, decidedBy)
  if (!outcome.ok) return { ok: false, error: outcome.error ?? outcome.message, message: outcome.message }

  const approval = await markApproval(String(row.id), action === 'accept' ? 'accepted' : 'refused', decidedBy)
  return { ok: true, message: outcome.message, approval: approval ?? undefined }
}

/** Aperçu lisible d'un webhook (utilisé par le dashboard). */
export function webhookLabel(row: Record<string, unknown>): string {
  return publicWebhook(row).name
}

// Réexports pour les routes : un seul point d'entrée.
export { getApprovalByToken, listApprovals, markApproval, requestApproval, syncApprovalForRef } from './devwebhook'
