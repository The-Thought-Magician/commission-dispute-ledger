import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  derivation_runs,
  derivation_lines,
  workspaces,
  workspace_members,
  comp_plan_versions,
  comp_plans,
  rate_tiers,
  accelerators,
  periods,
  deals,
  deal_credits,
  reps,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// Deterministic hash of the inputs that feed a derivation run.
function hashInputs(parts: string[]): string {
  const s = parts.join('|')
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

interface TierRow {
  id: string
  lower_bound: number
  upper_bound: number | null
  rate: number
  multiplier: number
  sort_order: number
}

// Pick the tier whose [lower_bound, upper_bound) band contains `basis`.
// Falls back to the highest tier when basis exceeds all upper bounds.
function pickTier(tiers: TierRow[], basis: number): TierRow | null {
  if (tiers.length === 0) return null
  const sorted = [...tiers].sort((a, b) => a.sort_order - b.sort_order || a.lower_bound - b.lower_bound)
  for (const t of sorted) {
    const upper = t.upper_bound ?? Number.POSITIVE_INFINITY
    if (basis >= t.lower_bound && basis < upper) return t
  }
  // basis at/above the top band: use the last tier whose lower_bound is <= basis
  const eligible = sorted.filter((t) => basis >= t.lower_bound)
  return eligible.length ? eligible[eligible.length - 1] : sorted[0]
}

// ─────────────────────────────────────────────────────────────
// GET / — public — runs for ?workspace_id=
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id')

  const conditions = [eq(derivation_runs.workspace_id, workspaceId)]
  if (periodId) conditions.push(eq(derivation_runs.period_id, periodId))

  const rows = await db
    .select()
    .from(derivation_runs)
    .where(and(...conditions))
    .orderBy(desc(derivation_runs.created_at))
  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// POST / — auth — run re-derivation {workspace_id, period_id, plan_version_id}
//
// Independent recomputation: pulls every deal in the period, fans each deal
// out across its credit assignments (or the plan's default split rule), applies
// the plan version's rate tier + accelerator, and writes one decomposed
// derivation_line per (deal, rep) with a full `explain` trace.
// ─────────────────────────────────────────────────────────────
const runSchema = z.object({
  workspace_id: z.string().min(1),
  period_id: z.string().min(1),
  plan_version_id: z.string().min(1),
})

router.post('/', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate references belong to the workspace.
  const [period] = await db.select().from(periods).where(eq(periods.id, body.period_id))
  if (!period || period.workspace_id !== body.workspace_id) return c.json({ error: 'Invalid period_id' }, 400)

  const [version] = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.id, body.plan_version_id))
  if (!version) return c.json({ error: 'Invalid plan_version_id' }, 400)
  const [plan] = await db.select().from(comp_plans).where(eq(comp_plans.id, version.comp_plan_id))
  if (!plan || plan.workspace_id !== body.workspace_id) return c.json({ error: 'Invalid plan_version_id' }, 400)

  // Load plan-version config.
  const tiers = (await db
    .select()
    .from(rate_tiers)
    .where(eq(rate_tiers.plan_version_id, body.plan_version_id))) as TierRow[]
  const accels = await db
    .select()
    .from(accelerators)
    .where(eq(accelerators.plan_version_id, body.plan_version_id))

  const baseRate = version.base_rate ?? 0
  const rateBasis = version.rate_basis // 'revenue' | 'margin'

  // Deals in this period for this workspace.
  const periodDeals = await db
    .select()
    .from(deals)
    .where(and(eq(deals.workspace_id, body.workspace_id), eq(deals.period_id, body.period_id)))

  // Create the run row first so lines can reference it.
  const inputsHash = hashInputs([
    body.workspace_id,
    body.period_id,
    body.plan_version_id,
    String(periodDeals.length),
    String(baseRate),
  ])

  const [run] = await db
    .insert(derivation_runs)
    .values({
      workspace_id: body.workspace_id,
      period_id: body.period_id,
      plan_version_id: body.plan_version_id,
      status: 'completed',
      inputs_hash: inputsHash,
      expected_total_cents: 0,
      created_by: userId,
    })
    .returning()

  const lineValues: Array<typeof derivation_lines.$inferInsert> = []
  let expectedTotal = 0

  for (const deal of periodDeals) {
    // Basis the commission is computed on.
    const basisCents = rateBasis === 'margin' ? deal.margin_cents : deal.amount_cents

    // Tier (chosen on the deal basis expressed in major currency units).
    const tier = pickTier(tiers, basisCents / 100)
    const effectiveRate = tier ? tier.rate : baseRate
    const tierMultiplier = tier ? tier.multiplier : 1

    // Accelerator: highest-threshold accelerator that applies (attainment proxy = 1).
    const applicableAccels = [...accels].sort((a, b) => b.threshold_attainment - a.threshold_attainment)
    const accel = applicableAccels.find((a) => a.threshold_attainment <= 1) ?? null
    const accelMultiplier = accel ? accel.multiplier : 1

    // Credit assignments for this deal (who gets split how).
    const credits = await db.select().from(deal_credits).where(eq(deal_credits.deal_id, deal.id))

    // Attribution requires explicit deal credits (which rep earns what share).
    // Without any credit row the deal cannot be attributed, so it contributes no lines.
    const assignments: Array<{ rep_id: string; split_pct: number; role: string }> =
      credits.length > 0
        ? credits.map((cr) => ({ rep_id: cr.rep_id, split_pct: cr.split_pct, role: cr.role }))
        : []

    for (const a of assignments) {
      const splitFraction = a.split_pct / 100
      // gross = basis * rate * tierMultiplier * accelMultiplier * splitFraction
      let amount = basisCents * effectiveRate * tierMultiplier * accelMultiplier * splitFraction

      // Per-deal cap (if accelerator defines one).
      if (accel?.per_deal_cap_cents != null && amount > accel.per_deal_cap_cents) {
        amount = accel.per_deal_cap_cents
      }
      const amountCents = Math.round(amount)
      expectedTotal += amountCents

      lineValues.push({
        run_id: run.id,
        rep_id: a.rep_id,
        deal_id: deal.id,
        component: 'commission',
        split_pct: a.split_pct,
        tier_applied: tier ? tier.id : null,
        rate_applied: effectiveRate,
        multiplier_applied: tierMultiplier * accelMultiplier,
        amount_cents: amountCents,
        explain: {
          basis: rateBasis,
          basis_cents: basisCents,
          rate_applied: effectiveRate,
          tier_id: tier ? tier.id : null,
          tier_multiplier: tierMultiplier,
          accelerator_id: accel ? accel.id : null,
          accelerator_multiplier: accelMultiplier,
          split_pct: a.split_pct,
          role: a.role,
          per_deal_cap_cents: accel?.per_deal_cap_cents ?? null,
          formula: 'round(basis_cents * rate * tier_multiplier * accel_multiplier * split_pct/100)',
          deal: { id: deal.id, account_name: deal.account_name, amount_cents: deal.amount_cents },
        },
      })
    }
  }

  if (lineValues.length > 0) {
    await db.insert(derivation_lines).values(lineValues)
  }

  // Apply per-period accelerator caps (rep-level) after line aggregation.
  const periodCappedAccel = accels.find((a) => a.per_period_cap_cents != null) ?? null
  if (periodCappedAccel?.per_period_cap_cents != null) {
    const cap = periodCappedAccel.per_period_cap_cents
    const perRep = new Map<string, number>()
    for (const lv of lineValues) {
      perRep.set(lv.rep_id, (perRep.get(lv.rep_id) ?? 0) + (lv.amount_cents ?? 0))
    }
    // Recompute expectedTotal honoring the cap.
    expectedTotal = 0
    for (const [, total] of perRep) {
      expectedTotal += Math.min(total, cap)
    }
  }

  const [updatedRun] = await db
    .update(derivation_runs)
    .set({ expected_total_cents: expectedTotal })
    .where(eq(derivation_runs.id, run.id))
    .returning()

  return c.json(updatedRun, 201)
})

// ─────────────────────────────────────────────────────────────
// GET /:id — public — run + decomposed lines
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(derivation_runs).where(eq(derivation_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const lines = await db
    .select()
    .from(derivation_lines)
    .where(eq(derivation_lines.run_id, id))
    .orderBy(desc(derivation_lines.amount_cents))
  return c.json({ run, lines })
})

// ─────────────────────────────────────────────────────────────
// GET /:id/explain/:lineId — public — full explain of one line
// ─────────────────────────────────────────────────────────────
router.get('/:id/explain/:lineId', async (c) => {
  const id = c.req.param('id')
  const lineId = c.req.param('lineId')
  const [run] = await db.select().from(derivation_runs).where(eq(derivation_runs.id, id))
  if (!run) return c.json({ error: 'Run not found' }, 404)
  const [line] = await db.select().from(derivation_lines).where(eq(derivation_lines.id, lineId))
  if (!line || line.run_id !== id) return c.json({ error: 'Line not found' }, 404)

  const [rep] = line.rep_id ? await db.select().from(reps).where(eq(reps.id, line.rep_id)) : [undefined]
  const [deal] = line.deal_id ? await db.select().from(deals).where(eq(deals.id, line.deal_id)) : [undefined]

  return c.json({
    line,
    explain: {
      ...(line.explain ?? {}),
      rep: rep ? { id: rep.id, name: rep.name } : null,
      deal: deal ? { id: deal.id, account_name: deal.account_name, amount_cents: deal.amount_cents } : null,
      computed_amount_cents: line.amount_cents,
    },
  })
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id — auth — delete run (cascades lines)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [run] = await db.select().from(derivation_runs).where(eq(derivation_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(run.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(derivation_lines).where(eq(derivation_lines.run_id, id))
  await db.delete(derivation_runs).where(eq(derivation_runs.id, id))
  return c.json({ success: true })
})

export default router
