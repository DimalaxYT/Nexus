// ─── Dashboard Dev — vue d'ensemble ──────────────────────────────────────────
// Compteurs de la base, poids du code, derniers appels d'API, sujets mal
// couverts et correctifs en attente. Tout est calculé localement.

import os from 'os'
import { devGuard } from '@/lib/auth'
import { db } from '@/lib/db'
import { findWeakSpots } from '@/lib/devbrain'
import { projectStats } from '@/lib/devfs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TABLES = [
  'user', 'session', 'conversation', 'memory', 'knowledge', 'task',
  'agentProfile', 'agentGroup', 'accountConnection', 'blueprint', 'apiKey', 'apiKeyLog',
] as const

export async function GET() {
  const guard = await devGuard()
  if (!guard.ok) return guard.response

  try {
    const counts: Record<string, number> = {}
    for (const t of TABLES) {
      try {
        counts[t] = await (db as unknown as Record<string, { count: () => Promise<number> }>)[t].count()
      } catch {
        counts[t] = 0
      }
    }

    const [logs, patches, tasks, keys] = await Promise.all([
      db.apiKeyLog.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }).catch(() => []),
      db.devPatch.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }).catch(() => []),
      db.devTask.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }).catch(() => []),
      db.apiKey.findMany({ take: 50 }).catch(() => []),
    ])

    const weakSpots = await findWeakSpots()

    // Appels des dernières 24 h
    const since = Date.now() - 24 * 60 * 60 * 1000
    const recent = (logs ?? []).filter((l) => {
      const at = new Date((l as { createdAt?: unknown }).createdAt as string | number | Date).getTime()
      return Number.isFinite(at) && at >= since
    })

    const stats = projectStats()

    return Response.json({
      counts,
      code: {
        files: stats.files,
        lines: stats.lines,
        bytes: stats.bytes,
        byFolder: stats.byFolder.slice(0, 8),
        biggest: stats.biggest.slice(0, 8),
      },
      weakSpots,
      patches: (patches ?? []).map((p) => ({
        id: String(p?.id ?? ''),
        title: String(p?.title ?? ''),
        filePath: String(p?.filePath ?? ''),
        status: String(p?.status ?? 'propose'),
        origin: String(p?.origin ?? 'agent'),
        createdAt: p?.createdAt,
        appliedAt: p?.appliedAt ?? null,
      })),
      tasks: (tasks ?? []).map((t) => ({
        id: String(t?.id ?? ''),
        title: String(t?.title ?? ''),
        detail: String(t?.detail ?? ''),
        category: String(t?.category ?? 'code'),
        priority: String(t?.priority ?? 'normale'),
        status: String(t?.status ?? 'a_faire'),
        createdAt: t?.createdAt,
      })),
      api: {
        calls24h: recent.length,
        keys: (keys ?? []).map((k) => ({
          id: String(k?.id ?? ''),
          name: String(k?.name ?? ''),
          enabled: Boolean(k?.enabled),
          totalCalls: Number(k?.totalCalls ?? 0),
          lastUsedAt: k?.lastUsedAt ?? null,
        })),
        lastCalls: (logs ?? []).slice(0, 10).map((l) => ({
          id: String(l?.id ?? ''),
          keyId: String(l?.keyId ?? ''),
          message: String(l?.message ?? '').slice(0, 160),
          reply: String(l?.reply ?? '').slice(0, 160),
          ms: Number(l?.ms ?? 0),
          ok: Boolean(l?.ok),
          createdAt: l?.createdAt,
        })),
      },
      system: {
        node: process.version,
        platform: process.platform,
        uptime: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        cpuCount: os.cpus()?.length ?? 0,
        loadAvg: os.loadavg().map((n) => Number(n.toFixed(2))),
        cwd: process.cwd(),
      },
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Lecture impossible' },
      { status: 500 }
    )
  }
}
