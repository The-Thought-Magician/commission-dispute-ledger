import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  comp_plans,
  comp_plan_versions,
  rate_tiers,
  accelerators,
  split_rules,
  reps,
  periods,
  rep_plan_assignments,
  deals,
  deal_credits,
  derivation_runs,
  derivation_lines,
  actual_runs,
  actual_lines,
  reconciliations,
  reconciliation_lines,
  disputes,
  dispute_deals,
  dispute_comments,
  clawbacks,
  adjustments,
  notifications,
  audit_logs,
} from '../db/schema.js'
import { eq, inArray } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// Demo data generator
// ─────────────────────────────────────────────────────────────

interface SeedResult {
  workspace_id: string
  reps: number
  periods: number
  deals: number
  derivation_runs: number
  actual_runs: number
  reconciliations: number
  disputes: number
  injected_errors: boolean
}

const DEMO_REPS = [
  { name: 'Dana Reyes', email: 'dana@acme.test', role: 'AE', territory: 'West', quota: 50_000_00 },
  { name: 'Marcus Hale', email: 'marcus@acme.test', role: 'AE', territory: 'East', quota: 60_000_00 },
  { name: 'Priya Nair', email: 'priya@acme.test', role: 'AE', territory: 'Central', quota: 45_000_00 },
  { name: 'Tom Becker', email: 'tom@acme.test', role: 'SE', territory: 'West', quota: 0 },
]

const DEMO_ACCOUNTS = [
  { account: 'Globex Corp', amount: 120_000_00, margin: 48_000_00, product: 'Platform' },
  { account: 'Initech', amount: 80_000_00, margin: 30_000_00, product: 'Platform' },
  { account: 'Umbrella Inc', amount: 200_000_00, margin: 90_000_00, product: 'Enterprise' },
  { account: 'Hooli', amount: 60_000_00, margin: 24_000_00, product: 'Starter' },
  { account: 'Stark Industries', amount: 150_000_00, margin: 70_000_00, product: 'Enterprise' },
  { account: 'Wayne Enterprises', amount: 95_000_00, margin: 40_000_00, product: 'Platform' },
]

function round(n: number): number {
  return Math.round(n)
}

// Given a deal amount (cents) and the tier table, compute the marginal rate the
// deal's full amount falls into (simple bracket-pick by lower/upper bound on dollars).
function pickTier(
  amountCents: number,
  tiers: { id: string; lower_bound: number; upper_bound: number | null; rate: number; multiplier: number }[],
): { rate: number; multiplier: number; tierId: string | null } {
  const dollars = amountCents / 100
  for (const t of tiers) {
    const lo = t.lower_bound ?? 0
    const hi = t.upper_bound ?? Number.POSITIVE_INFINITY
    if (dollars >= lo && dollars < hi) {
      return { rate: t.rate, multiplier: t.multiplier, tierId: t.id }
    }
  }
  // fall back to the last (highest) tier when above all upper bounds
  const last = tiers[tiers.length - 1]
  return last
    ? { rate: last.rate, multiplier: last.multiplier, tierId: last.id }
    : { rate: 0, multiplier: 1, tierId: null }
}

async function deleteWorkspaceData(workspaceId: string) {
  // Delete in FK-safe order (children before parents).
  const runRows = await db
    .select({ id: derivation_runs.id })
    .from(derivation_runs)
    .where(eq(derivation_runs.workspace_id, workspaceId))
  const runIds = runRows.map((r) => r.id)

  const actualRunRows = await db
    .select({ id: actual_runs.id })
    .from(actual_runs)
    .where(eq(actual_runs.workspace_id, workspaceId))
  const actualRunIds = actualRunRows.map((r) => r.id)

  const reconRows = await db
    .select({ id: reconciliations.id })
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
  const reconIds = reconRows.map((r) => r.id)

  const disputeRows = await db
    .select({ id: disputes.id })
    .from(disputes)
    .where(eq(disputes.workspace_id, workspaceId))
  const disputeIds = disputeRows.map((r) => r.id)

  const dealRows = await db
    .select({ id: deals.id })
    .from(deals)
    .where(eq(deals.workspace_id, workspaceId))
  const dealIds = dealRows.map((r) => r.id)

  const planRows = await db
    .select({ id: comp_plans.id })
    .from(comp_plans)
    .where(eq(comp_plans.workspace_id, workspaceId))
  const planIds = planRows.map((r) => r.id)

  const versionRows = planIds.length
    ? await db
        .select({ id: comp_plan_versions.id })
        .from(comp_plan_versions)
        .where(inArray(comp_plan_versions.comp_plan_id, planIds))
    : []
  const versionIds = versionRows.map((r) => r.id)

  if (reconIds.length)
    await db.delete(reconciliation_lines).where(inArray(reconciliation_lines.reconciliation_id, reconIds))
  await db.delete(reconciliations).where(eq(reconciliations.workspace_id, workspaceId))

  if (runIds.length) await db.delete(derivation_lines).where(inArray(derivation_lines.run_id, runIds))
  await db.delete(derivation_runs).where(eq(derivation_runs.workspace_id, workspaceId))

  if (actualRunIds.length) await db.delete(actual_lines).where(inArray(actual_lines.actual_run_id, actualRunIds))
  await db.delete(actual_runs).where(eq(actual_runs.workspace_id, workspaceId))

  if (disputeIds.length) {
    await db.delete(dispute_comments).where(inArray(dispute_comments.dispute_id, disputeIds))
    await db.delete(dispute_deals).where(inArray(dispute_deals.dispute_id, disputeIds))
  }
  await db.delete(adjustments).where(eq(adjustments.workspace_id, workspaceId))
  await db.delete(disputes).where(eq(disputes.workspace_id, workspaceId))

  await db.delete(clawbacks).where(eq(clawbacks.workspace_id, workspaceId))

  if (dealIds.length) await db.delete(deal_credits).where(inArray(deal_credits.deal_id, dealIds))
  await db.delete(deals).where(eq(deals.workspace_id, workspaceId))

  const repRows = await db
    .select({ id: reps.id })
    .from(reps)
    .where(eq(reps.workspace_id, workspaceId))
  const repIds = repRows.map((r) => r.id)
  if (repIds.length)
    await db.delete(rep_plan_assignments).where(inArray(rep_plan_assignments.rep_id, repIds))

  if (versionIds.length) {
    await db.delete(rate_tiers).where(inArray(rate_tiers.plan_version_id, versionIds))
    await db.delete(accelerators).where(inArray(accelerators.plan_version_id, versionIds))
    await db.delete(split_rules).where(inArray(split_rules.plan_version_id, versionIds))
  }
  if (planIds.length) await db.delete(comp_plan_versions).where(inArray(comp_plan_versions.comp_plan_id, planIds))
  await db.delete(comp_plans).where(eq(comp_plans.workspace_id, workspaceId))

  await db.delete(reps).where(eq(reps.workspace_id, workspaceId))
  await db.delete(periods).where(eq(periods.workspace_id, workspaceId))
  await db.delete(notifications).where(eq(notifications.workspace_id, workspaceId))
  await db.delete(audit_logs).where(eq(audit_logs.workspace_id, workspaceId))
}

async function buildDemo(
  userId: string,
  workspaceId: string,
  withErrors: boolean,
): Promise<SeedResult> {
  // 1. Period (this calendar month).
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
  const label = `${start.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${start.getUTCFullYear()}`
  const [period] = await db
    .insert(periods)
    .values({ workspace_id: workspaceId, label, kind: 'monthly', start_date: start, end_date: end, status: 'open' })
    .returning()

  // 2. Comp plan + version 1.
  const [plan] = await db
    .insert(comp_plans)
    .values({
      workspace_id: workspaceId,
      name: 'Standard AE Plan',
      description: 'Tiered revenue commission with attainment accelerators',
      currency: 'USD',
      effective_start: start,
      created_by: userId,
    })
    .returning()

  const [version] = await db
    .insert(comp_plan_versions)
    .values({
      comp_plan_id: plan.id,
      version_number: 1,
      base_rate: 0.08,
      rate_basis: 'revenue',
      config: { description: 'v1 baseline' },
      notes: 'Initial version',
      created_by: userId,
    })
    .returning()

  // Tiers on deal-revenue (dollars).
  const tierRows = await db
    .insert(rate_tiers)
    .values([
      { plan_version_id: version.id, lower_bound: 0, upper_bound: 100_000, rate: 0.06, multiplier: 1, sort_order: 0 },
      { plan_version_id: version.id, lower_bound: 100_000, upper_bound: 175_000, rate: 0.08, multiplier: 1, sort_order: 1 },
      { plan_version_id: version.id, lower_bound: 175_000, upper_bound: null, rate: 0.1, multiplier: 1, sort_order: 2 },
    ])
    .returning()

  await db
    .insert(accelerators)
    .values({
      plan_version_id: version.id,
      threshold_attainment: 1,
      multiplier: 1.25,
      per_period_cap_cents: null,
      per_deal_cap_cents: null,
    })

  await db
    .insert(split_rules)
    .values([
      { plan_version_id: version.id, role: 'AE', percentage: 80, is_default: true },
      { plan_version_id: version.id, role: 'SE', percentage: 20, is_default: false },
    ])

  // 3. Reps + plan assignments.
  const repRows = await db
    .insert(reps)
    .values(
      DEMO_REPS.map((r) => ({
        workspace_id: workspaceId,
        name: r.name,
        email: r.email,
        role: r.role,
        territory: r.territory,
        status: 'active',
        tags: [],
      })),
    )
    .returning()

  for (let i = 0; i < repRows.length; i++) {
    await db.insert(rep_plan_assignments).values({
      rep_id: repRows[i].id,
      comp_plan_id: plan.id,
      period_id: period.id,
      quota_cents: DEMO_REPS[i].quota,
    })
  }

  const aeReps = repRows.filter((r) => r.role === 'AE')
  const seRep = repRows.find((r) => r.role === 'SE')

  // 4. Deals + credit assignments (round-robin across AEs, SE gets a split share).
  const dealRows: { id: string; amount_cents: number; margin_cents: number; aeRepId: string }[] = []
  for (let i = 0; i < DEMO_ACCOUNTS.length; i++) {
    const a = DEMO_ACCOUNTS[i]
    const ae = aeReps[i % aeReps.length]
    const closeDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5 + i))
    const [deal] = await db
      .insert(deals)
      .values({
        workspace_id: workspaceId,
        account_name: a.account,
        amount_cents: a.amount,
        margin_cents: a.margin,
        product: a.product,
        close_date: closeDate,
        currency: 'USD',
        status: 'closed_won',
        external_id: `CRM-${1000 + i}`,
        period_id: period.id,
      })
      .returning()

    // Primary AE credit + SE assist credit (split 80/20).
    await db.insert(deal_credits).values({ deal_id: deal.id, rep_id: ae.id, role: 'AE', split_pct: 80 })
    if (seRep) await db.insert(deal_credits).values({ deal_id: deal.id, rep_id: seRep.id, role: 'SE', split_pct: 20 })

    dealRows.push({ id: deal.id, amount_cents: a.amount, margin_cents: a.margin, aeRepId: ae.id })
  }

  // 5. Independent re-derivation: per-credit, tier-rate * amount * split.
  const tiersForPick = tierRows.map((t) => ({
    id: t.id,
    lower_bound: t.lower_bound,
    upper_bound: t.upper_bound,
    rate: t.rate,
    multiplier: t.multiplier,
  }))

  const [run] = await db
    .insert(derivation_runs)
    .values({
      workspace_id: workspaceId,
      period_id: period.id,
      plan_version_id: version.id,
      status: 'completed',
      inputs_hash: `demo-${Date.now()}`,
      expected_total_cents: 0,
      created_by: userId,
    })
    .returning()

  // expected payout per rep (cents)
  const expectedByRep = new Map<string, number>()
  let expectedTotal = 0

  for (const deal of dealRows) {
    const credits = await db.select().from(deal_credits).where(eq(deal_credits.deal_id, deal.id))
    const { rate, multiplier, tierId } = pickTier(deal.amount_cents, tiersForPick)
    for (const credit of credits) {
      const grossCents = round(deal.amount_cents * rate * multiplier)
      const lineCents = round((grossCents * credit.split_pct) / 100)
      expectedTotal += lineCents
      expectedByRep.set(credit.rep_id, (expectedByRep.get(credit.rep_id) ?? 0) + lineCents)
      await db.insert(derivation_lines).values({
        run_id: run.id,
        rep_id: credit.rep_id,
        deal_id: deal.id,
        component: 'commission',
        split_pct: credit.split_pct,
        tier_applied: tierId,
        rate_applied: rate,
        multiplier_applied: multiplier,
        amount_cents: lineCents,
        explain: {
          deal_amount_cents: deal.amount_cents,
          rate,
          multiplier,
          split_pct: credit.split_pct,
          formula: 'amount * rate * multiplier * split_pct/100',
        },
      })
    }
  }
  await db.update(derivation_runs).set({ expected_total_cents: expectedTotal }).where(eq(derivation_runs.id, run.id))

  // 6. Actual run (imported "payroll"). When withErrors, perturb a couple of reps.
  const [actualRun] = await db
    .insert(actual_runs)
    .values({
      workspace_id: workspaceId,
      period_id: period.id,
      source_label: 'payroll-export.csv',
      actual_total_cents: 0,
      created_by: userId,
    })
    .returning()

  const perturb = new Map<string, number>()
  if (withErrors) {
    const repIds = Array.from(expectedByRep.keys())
    // underpay the first rep by 15%, overpay the second by 8%
    if (repIds[0]) perturb.set(repIds[0], -0.15)
    if (repIds[1]) perturb.set(repIds[1], 0.08)
  }

  const actualByRep = new Map<string, number>()
  let actualTotal = 0
  for (const [repId, expected] of expectedByRep) {
    const factor = 1 + (perturb.get(repId) ?? 0)
    const actual = round(expected * factor)
    actualByRep.set(repId, actual)
    actualTotal += actual
    await db.insert(actual_lines).values({ actual_run_id: actualRun.id, rep_id: repId, deal_id: null, amount_cents: actual })
  }
  await db.update(actual_runs).set({ actual_total_cents: actualTotal }).where(eq(actual_runs.id, actualRun.id))

  // 7. Reconciliation (expected vs actual, per-rep deltas).
  const netDelta = expectedTotal - actualTotal
  const tolerance = 1
  const [recon] = await db
    .insert(reconciliations)
    .values({
      workspace_id: workspaceId,
      period_id: period.id,
      derivation_run_id: run.id,
      actual_run_id: actualRun.id,
      expected_total_cents: expectedTotal,
      actual_total_cents: actualTotal,
      net_delta_cents: netDelta,
      tolerance_cents: tolerance,
      status: 'open',
      created_by: userId,
    })
    .returning()

  for (const [repId, expected] of expectedByRep) {
    const actual = actualByRep.get(repId) ?? 0
    const delta = expected - actual
    let classification = 'matched'
    if (Math.abs(delta) > tolerance) classification = delta > 0 ? 'underpaid' : 'overpaid'
    await db.insert(reconciliation_lines).values({
      reconciliation_id: recon.id,
      rep_id: repId,
      deal_id: null,
      expected_cents: expected,
      actual_cents: actual,
      delta_cents: delta,
      classification,
    })
  }

  // 8. Disputes for any underpaid rep (and a clawback for overpaid).
  let disputeCount = 0
  if (withErrors) {
    for (const [repId, expected] of expectedByRep) {
      const actual = actualByRep.get(repId) ?? 0
      const delta = expected - actual
      if (delta > tolerance) {
        // underpaid -> rep files a dispute
        const [dispute] = await db
          .insert(disputes)
          .values({
            workspace_id: workspaceId,
            rep_id: repId,
            period_id: period.id,
            claimed_amount_cents: delta,
            narrative: 'My commission statement looks short versus my closed deals this period.',
            status: 'open',
            assignee: userId,
            calc_snapshot: { expected_cents: expected, actual_cents: actual, delta_cents: delta },
            created_by: userId,
          })
          .returning()
        disputeCount++
        await db.insert(dispute_comments).values({
          dispute_id: dispute.id,
          author: 'system',
          body: `Reconciliation flagged a ${delta} cent underpayment for this rep.`,
        })
        // attach the rep's deals to the dispute
        const repDeals = dealRows.filter((d) => d.aeRepId === repId)
        for (const d of repDeals) {
          await db.insert(dispute_deals).values({ dispute_id: dispute.id, deal_id: d.id }).onConflictDoNothing()
        }
        await db.insert(notifications).values({
          user_id: userId,
          workspace_id: workspaceId,
          kind: 'dispute',
          title: 'New commission dispute',
          body: `An underpayment dispute was opened for ${delta} cents.`,
        })
      } else if (delta < -tolerance) {
        // overpaid -> clawback candidate against the rep's largest deal
        const repDeals = dealRows.filter((d) => d.aeRepId === repId).sort((a, b) => b.amount_cents - a.amount_cents)
        if (repDeals[0]) {
          await db.insert(clawbacks).values({
            workspace_id: workspaceId,
            deal_id: repDeals[0].id,
            rep_id: repId,
            original_payout_cents: actual,
            amount_cents: Math.abs(delta),
            reason: 'Overpayment detected during reconciliation',
            status: 'pending',
            created_by: userId,
          })
        }
      }
    }
  }

  // 9. Audit log entry for the seed event.
  await db.insert(audit_logs).values({
    workspace_id: workspaceId,
    actor: userId,
    entity_type: 'workspace',
    entity_id: workspaceId,
    action: withErrors ? 'seed_demo_with_errors' : 'seed_demo',
    before: {},
    after: { period_id: period.id, deals: dealRows.length },
  })

  return {
    workspace_id: workspaceId,
    reps: repRows.length,
    periods: 1,
    deals: dealRows.length,
    derivation_runs: 1,
    actual_runs: 1,
    reconciliations: 1,
    disputes: disputeCount,
    injected_errors: withErrors,
  }
}

// ─────────────────────────────────────────────────────────────
// POST /seed — create a fresh demo workspace owned by the caller.
// body: { with_errors?: boolean, name?: string }
// ─────────────────────────────────────────────────────────────
const seedSchema = z.object({
  with_errors: z.boolean().optional().default(true),
  name: z.string().min(1).optional(),
})

router.post('/', authMiddleware, zValidator('json', seedSchema), async (c) => {
  const userId = getUserId(c)
  const { with_errors, name } = c.req.valid('json')

  const [ws] = await db
    .insert(workspaces)
    .values({ name: name ?? 'Demo Workspace', owner_id: userId, currency: 'USD' })
    .returning()

  await db
    .insert(workspace_members)
    .values({ workspace_id: ws.id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()

  const result = await buildDemo(userId, ws.id, with_errors)
  return c.json(result, 201)
})

// ─────────────────────────────────────────────────────────────
// POST /seed/reset — wipe and regenerate the demo for an existing workspace.
// body: { workspace_id: string, with_errors?: boolean }
// ─────────────────────────────────────────────────────────────
const resetSchema = z.object({
  workspace_id: z.string().min(1),
  with_errors: z.boolean().optional().default(true),
})

router.post('/reset', authMiddleware, zValidator('json', resetSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, with_errors } = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (ws.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await deleteWorkspaceData(workspace_id)

  // Ensure the owner membership still exists after the wipe.
  await db
    .insert(workspace_members)
    .values({ workspace_id, user_id: userId, role: 'owner' })
    .onConflictDoNothing()

  const result = await buildDemo(userId, workspace_id, with_errors)
  return c.json(result)
})

export default router
