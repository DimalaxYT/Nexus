// ─── Agent Dev — moteur local ────────────────────────────────────────────────
// Lit le code réel du projet, diagnostique, et fabrique des correctifs à
// valider. Aucun appel externe : tout sort du disque et de la base SQLite.

import { devGuard } from '@/lib/auth'
import { runDevTurn } from '@/lib/devbrain'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: Request) {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  const body = await req.json().catch(() => null)
  const message = String(body?.message ?? '').trim().slice(0, 4000)
  if (!message) return Response.json({ error: 'Message requis.' }, { status: 400 })

  const history: ApiMessage[] = Array.isArray(body?.history)
    ? (body.history as ApiMessage[])
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-12)
    : []

  try {
    const result = await runDevTurn(message, history, guard.userId)

    // L'agent Dev est un agent du compte : on garde trace de l'échange dans la
    // banque du compte Dev pour qu'il se souvienne des demandes précédentes.
    if (result.intent === 'apprendre') {
      await db.knowledge.create({
        data: {
          userId: guard.userId,
          title: `Demande Dev — ${new Date().toLocaleDateString('fr-FR')}`,
          content: message.slice(0, 2000),
          category: 'Dev',
          tags: JSON.stringify(['dev', result.intent]),
          links: '[]',
          source: 'dev-agent',
        },
      }).catch(() => {})
    }

    return Response.json({ ok: true, ...result })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Analyse impossible' },
      { status: 500 }
    )
  }
}
