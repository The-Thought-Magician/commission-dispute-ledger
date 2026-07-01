import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  reconciliations,
  reconciliation_lines,
  disputes,
  clawbacks,
  adjustments,
  derivation_runs,
  reps,
  periods,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// GET / — KPI summary for ?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // All reconciliations for the workspace.
  const recons = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
    .orderBy(desc(reconciliations.created_at))

  // Net delta = sum of expected-vs-actual deltas across reconciliations.
  const netDelta = recons.reduce((sum, r) => sum + r.net_delta_cents, 0)

  // Error-rate + recoverable computed from reconciliation lines.
  let errorLines = 0
  let totalLines = 0
  let recoverable = 0 // overpaid magnitude (actual > expected) — recoverable from reps via clawback
  for (const recon of recons) {
    const lines = await db
      .select()
      .from(reconciliation_lines)
      .where(eq(reconciliation_lines.reconciliation_id, recon.id))
    for (const l of lines) {
      totalLines++
      if (l.delta_cents !== 0) errorLines++
      // delta_cents = actual - expected. Overpayments (actual > expected → positive delta) are recoverable.
      if (l.delta_cents > 0) recoverable += l.delta_cents
    }
  }
  const errorRate = totalLines > 0 ? errorLines / totalLines : 0

  // Pending clawbacks add to recoverable (money to claw back from reps).
  const clawbackRows = await db
    .select()
    .from(clawbacks)
    .where(eq(clawbacks.workspace_id, workspaceId))
  const recoverableClawbacks = clawbackRows
    .filter((cb) => cb.status === 'pending')
    .reduce((sum, cb) => sum + cb.amount_cents, 0)

  // Open disputes count.
  const disputeRows = await db
    .select()
    .from(disputes)
    .where(eq(disputes.workspace_id, workspaceId))
  const openDisputes = disputeRows.filter(
    (d) => d.status !== 'resolved' && d.status !== 'rejected' && d.status !== 'closed',
  ).length

  // Recent activity feed: most recent reconciliations, disputes, derivation runs, adjustments.
  const repList = await db.select().from(reps).where(eq(reps.workspace_id, workspaceId))
  const repMap = new Map(repList.map((r) => [r.id, r.name]))
  const periodList = await db
    .select()
    .from(periods)
    .where(eq(periods.workspace_id, workspaceId))
  const periodMap = new Map(periodList.map((p) => [p.id, p.label]))

  const recentDerivations = await db
    .select()
    .from(derivation_runs)
    .where(eq(derivation_runs.workspace_id, workspaceId))
    .orderBy(desc(derivation_runs.created_at))
    .limit(5)

  const recentAdjustments = await db
    .select()
    .from(adjustments)
    .where(eq(adjustments.workspace_id, workspaceId))
    .orderBy(desc(adjustments.created_at))
    .limit(5)

  type RecentItem = {
    kind: string
    id: string
    title: string
    detail: string
    created_at: Date
  }
  const recent: RecentItem[] = []

  for (const r of recons.slice(0, 5)) {
    recent.push({
      kind: 'reconciliation',
      id: r.id,
      title: `Reconciliation ${r.status}`,
      detail: `${periodMap.get(r.period_id) ?? 'period'}: net delta ${r.net_delta_cents}c`,
      created_at: r.created_at,
    })
  }
  for (const d of disputeRows
    .slice()
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, 5)) {
    recent.push({
      kind: 'dispute',
      id: d.id,
      title: `Dispute ${d.status}`,
      detail: `${repMap.get(d.rep_id) ?? 'rep'} claims ${d.claimed_amount_cents}c`,
      created_at: d.created_at,
    })
  }
  for (const run of recentDerivations) {
    recent.push({
      kind: 'derivation',
      id: run.id,
      title: `Derivation ${run.status}`,
      detail: `${periodMap.get(run.period_id) ?? 'period'}: expected ${run.expected_total_cents}c`,
      created_at: run.created_at,
    })
  }
  for (const a of recentAdjustments) {
    recent.push({
      kind: 'adjustment',
      id: a.id,
      title: `Adjustment ${a.direction}`,
      detail: `${repMap.get(a.rep_id) ?? 'rep'}: ${a.amount_cents}c (${a.status})`,
      created_at: a.created_at,
    })
  }

  recent.sort((a, b) => b.created_at.getTime() - a.created_at.getTime())

  return c.json({
    net_delta: netDelta,
    recoverable: recoverable + recoverableClawbacks,
    open_disputes: openDisputes,
    error_rate: errorRate,
    recent: recent.slice(0, 10).map((r) => ({
      kind: r.kind,
      id: r.id,
      title: r.title,
      detail: r.detail,
      created_at: r.created_at,
    })),
  })
})

export default router
