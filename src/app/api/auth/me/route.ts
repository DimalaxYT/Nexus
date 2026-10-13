// Session courante : qui suis-je ? (et combien de comptes existent)

import { countUsers, getCurrentUser } from '@/lib/auth'
import { ensureDevBootstrap } from '@/lib/dev-seed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [user, accounts] = await Promise.all([getCurrentUser(), countUsers()])
    // Amorçage du compte Dev (une fois par processus) dès qu'un compte existe.
    if (accounts > 0) await ensureDevBootstrap()
    return Response.json({ user, accountsExist: accounts > 0, accounts })
  } catch {
    return Response.json({ user: null, accountsExist: false, accounts: 0 })
  }
}
