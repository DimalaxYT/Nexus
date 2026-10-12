export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json(
    { ok: true, service: 'nexus' },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
