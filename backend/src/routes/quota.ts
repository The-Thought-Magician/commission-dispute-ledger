import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  rep_plan_assignments,
  reps,
  derivation_runs,
  derivation_lines,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Pick the most relevant completed derivation run for a workspace
// (optionally scoped to a period), then sum its lines per rep so we
// have an "attained" payout figure to compare against quota.
async function attainedByRep(
  workspaceId: string,
  periodId?: string | null,
): Promise<Map<string, number>> {
  const conds = [eq(derivation_runs.workspace_id, workspaceId)]
  if (periodId) conds.push(eq(derivation_runs.period_id, periodId))

  const runs = await db
    .select()
    .from(derivation_runs)
    .where(and(...conds))
    .orderBy(desc(derivation_runs.created_at))

  // Latest run per period so we never double count overlapping runs.
  const latestRunByPeriod = new Map<string, string>()
  for (const r of runs) {
    if (!latestRunByPeriod.has(r.period_id)) latestRunByPeriod.set(r.period_id, r.id)
  }

  const attained = new Map<string, number>()
  for (const runId of latestRunByPeriod.values()) {
    const lines = await db
      .select()
      .from(derivation_lines)
      .where(eq(derivation_lines.run_id, runId))
    for (const l of lines) {
      attained.set(l.rep_id, (attained.get(l.rep_id) ?? 0) + (l.amount_cents ?? 0))
    }
  }
  return attained
}

// ─────────────────────────────────────────────────────────────
// GET / — quota + attainment per rep for ?workspace_id= (&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id') ?? null

  // Reps for this workspace
  const roster = await db.select().from(reps).where(eq(reps.workspace_id, workspaceId))
  const repIds = new Set(roster.map((r) => r.id))
  const repName = new Map(roster.map((r) => [r.id, r.name]))

  // Assignments (quota) — filtered to this workspace's reps
  const assignments = periodId
    ? await db
        .select()
        .from(rep_plan_assignments)
        .where(eq(rep_plan_assignments.period_id, periodId))
    : await db.select().from(rep_plan_assignments)

  const attained = await attainedByRep(workspaceId, periodId)

  // Build quota map (sum quota across assignments for the rep within scope)
  const quotaByRep = new Map<string, number>()
  const periodByRep = new Map<string, string | null>()
  for (const a of assignments) {
    if (!repIds.has(a.rep_id)) continue
    quotaByRep.set(a.rep_id, (quotaByRep.get(a.rep_id) ?? 0) + (a.quota_cents ?? 0))
    if (!periodByRep.has(a.rep_id)) periodByRep.set(a.rep_id, a.period_id)
  }

  // Union of reps that have either a quota or attainment in scope,
  // restricted to this workspace's roster.
  const involved = [...new Set<string>([...quotaByRep.keys(), ...attained.keys()])].filter((id) =>
    repIds.has(id),
  )

  const rows = involved.map((repId) => {
    const quota_cents = quotaByRep.get(repId) ?? 0
    const attained_cents = attained.get(repId) ?? 0
    const attainment_pct = quota_cents > 0 ? (attained_cents / quota_cents) * 100 : 0
    return {
      rep_id: repId,
      rep_name: repName.get(repId) ?? null,
      period_id: periodByRep.get(repId) ?? periodId,
      quota_cents,
      attained_cents,
      attainment_pct: Math.round(attainment_pct * 100) / 100,
    }
  })

  rows.sort((a, b) => b.attainment_pct - a.attainment_pct)
  return c.json({ rows })
})

// ─────────────────────────────────────────────────────────────
// GET /leaderboard — attainment leaderboard ?workspace_id= (&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/leaderboard', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id') ?? null

  const roster = await db.select().from(reps).where(eq(reps.workspace_id, workspaceId))
  const repIds = new Set(roster.map((r) => r.id))
  const repMeta = new Map(roster.map((r) => [r.id, r]))

  const assignments = periodId
    ? await db
        .select()
        .from(rep_plan_assignments)
        .where(eq(rep_plan_assignments.period_id, periodId))
    : await db.select().from(rep_plan_assignments)

  const attained = await attainedByRep(workspaceId, periodId)

  const quotaByRep = new Map<string, number>()
  for (const a of assignments) {
    if (!repIds.has(a.rep_id)) continue
    quotaByRep.set(a.rep_id, (quotaByRep.get(a.rep_id) ?? 0) + (a.quota_cents ?? 0))
  }

  const involved = [...new Set<string>([...quotaByRep.keys(), ...attained.keys()])].filter((id) =>
    repIds.has(id),
  )

  const board = involved
    .map((repId) => {
      const meta = repMeta.get(repId)
      const quota_cents = quotaByRep.get(repId) ?? 0
      const attained_cents = attained.get(repId) ?? 0
      const attainment_pct = quota_cents > 0 ? (attained_cents / quota_cents) * 100 : 0
      return {
        rep_id: repId,
        rep_name: meta?.name ?? null,
        territory: meta?.territory ?? null,
        role: meta?.role ?? null,
        quota_cents,
        attained_cents,
        attainment_pct: Math.round(attainment_pct * 100) / 100,
      }
    })
    .sort((a, b) => b.attainment_pct - a.attainment_pct || b.attained_cents - a.attained_cents)
    .map((row, i) => ({ rank: i + 1, ...row }))

  return c.json(board)
})

export default router
