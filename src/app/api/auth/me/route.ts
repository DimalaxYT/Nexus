// Session courante : qui suis-je ? (et combien de comptes existent)

import { countUsers, getCurrentUser } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const [user, accounts] = await Promise.all([getCurrentUser(), countUsers()])
    return Response.json({ user, accountsExist: accounts > 0, accounts })
  } catch {
    return Response.json({ user: null, accountsExist: false, accounts: 0 })
  }
}
