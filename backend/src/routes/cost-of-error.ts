import { Hono } from 'hono'
import { db } from '../db/index.js'
import { reconciliations, reconciliation_lines, periods } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

interface ErrorTotals {
  overpaid: number // actual exceeded expected (employer overpaid)
  underpaid: number // actual fell short of expected (rep underpaid)
  checked: number // total reconciliation lines examined
  errored: number // lines outside tolerance
  error_rate: number // errored / checked (0..1)
  net_delta_cents: number // sum of (actual - expected) across lines
  by_type: Record<string, { count: number; amount_cents: number }>
}

// ─────────────────────────────────────────────────────────────
// Aggregate cost-of-error from every reconciliation line belonging to the
// given workspace (optionally restricted to a single period).
//
// Convention from schema: reconciliation_lines.delta_cents = actual - expected.
//   delta > 0  → overpaid (employer paid more than derived)
//   delta < 0  → underpaid (rep got less than derived)
// A line is "errored" when its classification is not 'matched' OR delta != 0.
// ─────────────────────────────────────────────────────────────
async function aggregateForReconciliations(reconIds: string[]): Promise<ErrorTotals> {
  const totals: ErrorTotals = {
    overpaid: 0,
    underpaid: 0,
    checked: 0,
    errored: 0,
    error_rate: 0,
    net_delta_cents: 0,
    by_type: {},
  }

  for (const reconId of reconIds) {
    const lines = await db
      .select()
      .from(reconciliation_lines)
      .where(eq(reconciliation_lines.reconciliation_id, reconId))

    for (const line of lines) {
      totals.checked += 1
      const delta = line.delta_cents ?? 0
      totals.net_delta_cents += delta

      const classification = line.classification || 'matched'
      const isError = classification !== 'matched' || delta !== 0
      if (isError) totals.errored += 1

      if (delta > 0) totals.overpaid += delta
      else if (delta < 0) totals.underpaid += Math.abs(delta)

      if (!totals.by_type[classification]) {
        totals.by_type[classification] = { count: 0, amount_cents: 0 }
      }
      totals.by_type[classification].count += 1
      totals.by_type[classification].amount_cents += Math.abs(delta)
    }
  }

  totals.error_rate = totals.checked > 0 ? totals.errored / totals.checked : 0
  return totals
}

async function reconIdsFor(workspaceId: string, periodId?: string): Promise<string[]> {
  const conditions = [eq(reconciliations.workspace_id, workspaceId)]
  if (periodId) conditions.push(eq(reconciliations.period_id, periodId))
  const rows = await db
    .select()
    .from(reconciliations)
    .where(and(...conditions))
  return rows.map((r) => r.id)
}

// ─────────────────────────────────────────────────────────────
// GET / — public — cost-of-error for ?workspace_id= (&period_id)
//   → { overpaid, underpaid, error_rate, by_type }
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id') || undefined

  const reconIds = await reconIdsFor(workspaceId, periodId)
  const totals = await aggregateForReconciliations(reconIds)

  return c.json({
    overpaid: totals.overpaid,
    underpaid: totals.underpaid,
    net_delta_cents: totals.net_delta_cents,
    checked: totals.checked,
    errored: totals.errored,
    error_rate: totals.error_rate,
    by_type: totals.by_type,
  })
})

// ─────────────────────────────────────────────────────────────
// GET /trend — public — error-rate trend across periods ?workspace_id=
//   → { points: [{ period, error_rate, net_delta }] }
// ─────────────────────────────────────────────────────────────
router.get('/trend', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const periodRows = await db
    .select()
    .from(periods)
    .where(eq(periods.workspace_id, workspaceId))
    .orderBy(periods.start_date)

  const points: Array<{
    period_id: string
    period: string
    error_rate: number
    net_delta: number
    overpaid: number
    underpaid: number
    checked: number
  }> = []

  for (const period of periodRows) {
    const reconIds = await reconIdsFor(workspaceId, period.id)
    const totals = await aggregateForReconciliations(reconIds)
    points.push({
      period_id: period.id,
      period: period.label,
      error_rate: totals.error_rate,
      net_delta: totals.net_delta_cents,
      overpaid: totals.overpaid,
      underpaid: totals.underpaid,
      checked: totals.checked,
    })
  }

  return c.json({ points })
})

export default router
