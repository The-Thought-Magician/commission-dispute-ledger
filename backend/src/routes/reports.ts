import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  reconciliations,
  reconciliation_lines,
  disputes,
  dispute_deals,
  dispute_comments,
  deals,
  reps,
  periods,
  derivation_runs,
  derivation_lines,
  actual_runs,
  actual_lines,
  adjustments,
  clawbacks,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// GET /reconciliation — recon export ?reconciliation_id=
// ─────────────────────────────────────────────────────────────
router.get('/reconciliation', async (c) => {
  const reconciliationId = c.req.query('reconciliation_id')
  if (!reconciliationId) return c.json({ error: 'reconciliation_id is required' }, 400)

  const [recon] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.id, reconciliationId))
  if (!recon) return c.json({ error: 'Not found' }, 404)

  const lines = await db
    .select()
    .from(reconciliation_lines)
    .where(eq(reconciliation_lines.reconciliation_id, reconciliationId))
    .orderBy(desc(reconciliation_lines.delta_cents))

  const repList = await db.select().from(reps).where(eq(reps.workspace_id, recon.workspace_id))
  const repMap = new Map(repList.map((r) => [r.id, r]))

  const dealList = await db.select().from(deals).where(eq(deals.workspace_id, recon.workspace_id))
  const dealMap = new Map(dealList.map((d) => [d.id, d]))

  const rows = lines.map((l) => ({
    line_id: l.id,
    rep_id: l.rep_id,
    rep_name: repMap.get(l.rep_id)?.name ?? null,
    deal_id: l.deal_id,
    account_name: l.deal_id ? dealMap.get(l.deal_id)?.account_name ?? null : null,
    expected_cents: l.expected_cents,
    actual_cents: l.actual_cents,
    delta_cents: l.delta_cents,
    classification: l.classification,
  }))

  return c.json({
    reconciliation: recon,
    rows,
    summary: {
      expected_total_cents: recon.expected_total_cents,
      actual_total_cents: recon.actual_total_cents,
      net_delta_cents: recon.net_delta_cents,
      tolerance_cents: recon.tolerance_cents,
      status: recon.status,
      line_count: rows.length,
    },
  })
})

// ─────────────────────────────────────────────────────────────
// GET /dispute — dispute resolution report ?dispute_id=
// ─────────────────────────────────────────────────────────────
router.get('/dispute', async (c) => {
  const disputeId = c.req.query('dispute_id')
  if (!disputeId) return c.json({ error: 'dispute_id is required' }, 400)

  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId))
  if (!dispute) return c.json({ error: 'Not found' }, 404)

  const [rep] = await db.select().from(reps).where(eq(reps.id, dispute.rep_id))
  const period = dispute.period_id
    ? (await db.select().from(periods).where(eq(periods.id, dispute.period_id)))[0] ?? null
    : null

  const links = await db
    .select()
    .from(dispute_deals)
    .where(eq(dispute_deals.dispute_id, disputeId))
  const dealIds = links.map((l) => l.deal_id)
  const attachedDeals: Array<typeof deals.$inferSelect> = []
  for (const did of dealIds) {
    const [d] = await db.select().from(deals).where(eq(deals.id, did))
    if (d) attachedDeals.push(d)
  }

  const comments = await db
    .select()
    .from(dispute_comments)
    .where(eq(dispute_comments.dispute_id, disputeId))
    .orderBy(dispute_comments.created_at)

  const linkedAdjustments = await db
    .select()
    .from(adjustments)
    .where(eq(adjustments.dispute_id, disputeId))

  const claimed = dispute.claimed_amount_cents
  const resolved = dispute.resolution_amount_cents ?? 0
  const variance = resolved - claimed

  return c.json({
    report: {
      dispute,
      rep: rep ?? null,
      period,
      deals: attachedDeals,
      comments,
      adjustments: linkedAdjustments,
      financials: {
        claimed_amount_cents: claimed,
        resolution_amount_cents: dispute.resolution_amount_cents,
        variance_cents: variance,
        status: dispute.status,
        resolution_note: dispute.resolution_note,
      },
    },
  })
})

// ─────────────────────────────────────────────────────────────
// GET /cost-of-error — cost-of-error export ?workspace_id=(&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/cost-of-error', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const periodId = c.req.query('period_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const recons = periodId
    ? await db
        .select()
        .from(reconciliations)
        .where(
          and(
            eq(reconciliations.workspace_id, workspaceId),
            eq(reconciliations.period_id, periodId),
          ),
        )
    : await db
        .select()
        .from(reconciliations)
        .where(eq(reconciliations.workspace_id, workspaceId))

  const repList = await db.select().from(reps).where(eq(reps.workspace_id, workspaceId))
  const repMap = new Map(repList.map((r) => [r.id, r]))

  let overpaid = 0
  let underpaid = 0
  let matched = 0
  let errorLineCount = 0
  let totalLineCount = 0
  const rows: Array<Record<string, unknown>> = []

  for (const recon of recons) {
    const lines = await db
      .select()
      .from(reconciliation_lines)
      .where(eq(reconciliation_lines.reconciliation_id, recon.id))
    for (const l of lines) {
      totalLineCount++
      if (l.delta_cents > 0) overpaid += l.delta_cents
      else if (l.delta_cents < 0) underpaid += -l.delta_cents
      if (l.delta_cents !== 0) errorLineCount++
      else matched++
      rows.push({
        reconciliation_id: recon.id,
        period_id: recon.period_id,
        rep_id: l.rep_id,
        rep_name: repMap.get(l.rep_id)?.name ?? null,
        deal_id: l.deal_id,
        expected_cents: l.expected_cents,
        actual_cents: l.actual_cents,
        delta_cents: l.delta_cents,
        classification: l.classification,
      })
    }
  }

  const errorRate = totalLineCount > 0 ? errorLineCount / totalLineCount : 0

  return c.json({
    rows,
    summary: {
      overpaid_cents: overpaid,
      underpaid_cents: underpaid,
      net_error_cents: overpaid - underpaid,
      gross_error_cents: overpaid + underpaid,
      matched_lines: matched,
      error_lines: errorLineCount,
      total_lines: totalLineCount,
      error_rate: errorRate,
    },
  })
})

// ─────────────────────────────────────────────────────────────
// GET /statement — per-rep expected-vs-actual ?workspace_id=&rep_id=&period_id=
// ─────────────────────────────────────────────────────────────
router.get('/statement', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const repId = c.req.query('rep_id')
  const periodId = c.req.query('period_id')
  if (!workspaceId || !repId || !periodId) {
    return c.json({ error: 'workspace_id, rep_id and period_id are required' }, 400)
  }

  const [rep] = await db
    .select()
    .from(reps)
    .where(and(eq(reps.id, repId), eq(reps.workspace_id, workspaceId)))
  if (!rep) return c.json({ error: 'Rep not found' }, 404)

  const [period] = await db
    .select()
    .from(periods)
    .where(and(eq(periods.id, periodId), eq(periods.workspace_id, workspaceId)))
  if (!period) return c.json({ error: 'Period not found' }, 404)

  // Expected: derivation lines for this rep across runs in the period.
  const runs = await db
    .select()
    .from(derivation_runs)
    .where(
      and(
        eq(derivation_runs.workspace_id, workspaceId),
        eq(derivation_runs.period_id, periodId),
      ),
    )
    .orderBy(desc(derivation_runs.created_at))

  const expectedLines: Array<Record<string, unknown>> = []
  let expectedTotal = 0
  if (runs.length > 0) {
    const latestRun = runs[0]
    const dl = await db
      .select()
      .from(derivation_lines)
      .where(
        and(eq(derivation_lines.run_id, latestRun.id), eq(derivation_lines.rep_id, repId)),
      )
    for (const l of dl) {
      expectedTotal += l.amount_cents
      expectedLines.push({
        deal_id: l.deal_id,
        component: l.component,
        split_pct: l.split_pct,
        tier_applied: l.tier_applied,
        rate_applied: l.rate_applied,
        multiplier_applied: l.multiplier_applied,
        amount_cents: l.amount_cents,
      })
    }
  }

  // Actual: actual lines for this rep across actual runs in the period.
  const aRuns = await db
    .select()
    .from(actual_runs)
    .where(
      and(eq(actual_runs.workspace_id, workspaceId), eq(actual_runs.period_id, periodId)),
    )
    .orderBy(desc(actual_runs.created_at))

  const actualLines: Array<Record<string, unknown>> = []
  let actualTotal = 0
  if (aRuns.length > 0) {
    const latestActual = aRuns[0]
    const al = await db
      .select()
      .from(actual_lines)
      .where(
        and(
          eq(actual_lines.actual_run_id, latestActual.id),
          eq(actual_lines.rep_id, repId),
        ),
      )
    for (const l of al) {
      actualTotal += l.amount_cents
      actualLines.push({ deal_id: l.deal_id, amount_cents: l.amount_cents })
    }
  }

  // Adjustments & clawbacks attributable to this rep in this period.
  const repAdjustments = await db
    .select()
    .from(adjustments)
    .where(
      and(
        eq(adjustments.workspace_id, workspaceId),
        eq(adjustments.rep_id, repId),
        eq(adjustments.period_id, periodId),
      ),
    )
  const adjustmentTotal = repAdjustments.reduce(
    (sum, a) => sum + (a.direction === 'debit' ? -a.amount_cents : a.amount_cents),
    0,
  )

  const repClawbacks = await db
    .select()
    .from(clawbacks)
    .where(and(eq(clawbacks.workspace_id, workspaceId), eq(clawbacks.rep_id, repId)))
  const clawbackTotal = repClawbacks
    .filter((cb) => cb.status === 'applied')
    .reduce((sum, cb) => sum + cb.amount_cents, 0)

  return c.json({
    statement: {
      rep,
      period,
      expected: { lines: expectedLines, total_cents: expectedTotal },
      actual: { lines: actualLines, total_cents: actualTotal },
      net_delta_cents: expectedTotal - actualTotal,
      adjustments: { rows: repAdjustments, total_cents: adjustmentTotal },
      clawbacks: { rows: repClawbacks, applied_total_cents: clawbackTotal },
      reconciled_owed_cents: expectedTotal - actualTotal + adjustmentTotal - clawbackTotal,
    },
  })
})

// ─────────────────────────────────────────────────────────────
// GET /accrual — finance accrual/liability summary ?workspace_id=(&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/accrual', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const periodId = c.req.query('period_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  // Expected liability from latest derivation run per period.
  const runs = periodId
    ? await db
        .select()
        .from(derivation_runs)
        .where(
          and(
            eq(derivation_runs.workspace_id, workspaceId),
            eq(derivation_runs.period_id, periodId),
          ),
        )
        .orderBy(desc(derivation_runs.created_at))
    : await db
        .select()
        .from(derivation_runs)
        .where(eq(derivation_runs.workspace_id, workspaceId))
        .orderBy(desc(derivation_runs.created_at))

  // Keep only the latest run per period.
  const latestByPeriod = new Map<string, typeof derivation_runs.$inferSelect>()
  for (const r of runs) {
    if (!latestByPeriod.has(r.period_id)) latestByPeriod.set(r.period_id, r)
  }
  let expectedLiability = 0
  for (const r of latestByPeriod.values()) expectedLiability += r.expected_total_cents

  // Open disputed exposure.
  const disputeRows = periodId
    ? await db
        .select()
        .from(disputes)
        .where(
          and(eq(disputes.workspace_id, workspaceId), eq(disputes.period_id, periodId)),
        )
    : await db.select().from(disputes).where(eq(disputes.workspace_id, workspaceId))
  let openDisputeExposure = 0
  let openDisputeCount = 0
  for (const d of disputeRows) {
    if (d.status !== 'resolved' && d.status !== 'rejected' && d.status !== 'closed') {
      openDisputeExposure += d.claimed_amount_cents
      openDisputeCount++
    }
  }

  // Pending adjustments (signed) and pending clawbacks (recoverable).
  const adjRows = periodId
    ? await db
        .select()
        .from(adjustments)
        .where(
          and(
            eq(adjustments.workspace_id, workspaceId),
            eq(adjustments.period_id, periodId),
          ),
        )
    : await db.select().from(adjustments).where(eq(adjustments.workspace_id, workspaceId))
  let pendingAdjustments = 0
  for (const a of adjRows) {
    if (a.status === 'pending') {
      pendingAdjustments += a.direction === 'debit' ? -a.amount_cents : a.amount_cents
    }
  }

  const clawbackRows = await db
    .select()
    .from(clawbacks)
    .where(eq(clawbacks.workspace_id, workspaceId))
  let pendingClawbacks = 0
  for (const cb of clawbackRows) {
    if (cb.status === 'pending') pendingClawbacks += cb.amount_cents
  }

  const totalAccrual =
    expectedLiability + openDisputeExposure + pendingAdjustments - pendingClawbacks

  return c.json({
    accrual: {
      expected_liability_cents: expectedLiability,
      open_dispute_exposure_cents: openDisputeExposure,
      open_dispute_count: openDisputeCount,
      pending_adjustments_cents: pendingAdjustments,
      pending_clawbacks_cents: pendingClawbacks,
      total_accrual_cents: totalAccrual,
      periods_included: latestByPeriod.size,
    },
  })
})

export default router
