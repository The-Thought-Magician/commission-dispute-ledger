import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { rate_tiers, accelerators, comp_plan_versions, comp_plans, workspaces } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const tierSchema = z.object({
  plan_version_id: z.string().min(1),
  lower_bound: z.number().optional(),
  upper_bound: z.number().nullable().optional(),
  rate: z.number().optional(),
  multiplier: z.number().optional(),
  sort_order: z.number().int().optional(),
})

const tierUpdateSchema = z.object({
  lower_bound: z.number().optional(),
  upper_bound: z.number().nullable().optional(),
  rate: z.number().optional(),
  multiplier: z.number().optional(),
  sort_order: z.number().int().optional(),
})

const acceleratorSchema = z.object({
  plan_version_id: z.string().min(1),
  threshold_attainment: z.number().optional(),
  multiplier: z.number().optional(),
  per_period_cap_cents: z.number().int().nullable().optional(),
  per_deal_cap_cents: z.number().int().nullable().optional(),
})

const acceleratorUpdateSchema = z.object({
  threshold_attainment: z.number().optional(),
  multiplier: z.number().optional(),
  per_period_cap_cents: z.number().int().nullable().optional(),
  per_deal_cap_cents: z.number().int().nullable().optional(),
})

// Helpers ───────────────────────────────────────────────────────
async function getVersion(versionId: string) {
  const [v] = await db.select().from(comp_plan_versions).where(eq(comp_plan_versions.id, versionId))
  return v
}

// Confirms the caller owns the workspace that owns the plan version.
async function ownsVersion(versionId: string, userId: string): Promise<boolean> {
  const version = await getVersion(versionId)
  if (!version) return false
  const [plan] = await db.select().from(comp_plans).where(eq(comp_plans.id, version.comp_plan_id))
  if (!plan) return false
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, plan.workspace_id))
  return !!w && w.owner_id === userId
}

// GET / — tiers + accelerators for ?plan_version_id= — public
router.get('/', async (c) => {
  const versionId = c.req.query('plan_version_id')
  if (!versionId) return c.json({ error: 'plan_version_id is required' }, 400)
  const tiers = await db
    .select()
    .from(rate_tiers)
    .where(eq(rate_tiers.plan_version_id, versionId))
    .orderBy(rate_tiers.sort_order)
  const accs = await db
    .select()
    .from(accelerators)
    .where(eq(accelerators.plan_version_id, versionId))
  return c.json({ tiers, accelerators: accs })
})

// POST / — create tier — auth
router.post('/', authMiddleware, zValidator('json', tierSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const version = await getVersion(body.plan_version_id)
  if (!version) return c.json({ error: 'Plan version not found' }, 404)
  if (!(await ownsVersion(body.plan_version_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const [tier] = await db
    .insert(rate_tiers)
    .values({
      plan_version_id: body.plan_version_id,
      lower_bound: body.lower_bound ?? 0,
      upper_bound: body.upper_bound ?? null,
      rate: body.rate ?? 0,
      multiplier: body.multiplier ?? 1,
      sort_order: body.sort_order ?? 0,
    })
    .returning()
  return c.json(tier, 201)
})

// PUT /:id — update tier — auth
router.put('/:id', authMiddleware, zValidator('json', tierUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rate_tiers).where(eq(rate_tiers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsVersion(existing.plan_version_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.lower_bound !== undefined) patch.lower_bound = body.lower_bound
  if (body.upper_bound !== undefined) patch.upper_bound = body.upper_bound
  if (body.rate !== undefined) patch.rate = body.rate
  if (body.multiplier !== undefined) patch.multiplier = body.multiplier
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order
  const [updated] = await db.update(rate_tiers).set(patch).where(eq(rate_tiers.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — delete tier — auth
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(rate_tiers).where(eq(rate_tiers.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsVersion(existing.plan_version_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(rate_tiers).where(eq(rate_tiers.id, id))
  return c.json({ success: true })
})

// POST /accelerators — create accelerator — auth
router.post('/accelerators', authMiddleware, zValidator('json', acceleratorSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const version = await getVersion(body.plan_version_id)
  if (!version) return c.json({ error: 'Plan version not found' }, 404)
  if (!(await ownsVersion(body.plan_version_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const [acc] = await db
    .insert(accelerators)
    .values({
      plan_version_id: body.plan_version_id,
      threshold_attainment: body.threshold_attainment ?? 1,
      multiplier: body.multiplier ?? 1,
      per_period_cap_cents: body.per_period_cap_cents ?? null,
      per_deal_cap_cents: body.per_deal_cap_cents ?? null,
    })
    .returning()
  return c.json(acc, 201)
})

// PUT /accelerators/:id — update accelerator — auth
router.put(
  '/accelerators/:id',
  authMiddleware,
  zValidator('json', acceleratorUpdateSchema),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db.select().from(accelerators).where(eq(accelerators.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (!(await ownsVersion(existing.plan_version_id, userId)))
      return c.json({ error: 'Forbidden' }, 403)
    const body = c.req.valid('json')
    const patch: Record<string, unknown> = {}
    if (body.threshold_attainment !== undefined)
      patch.threshold_attainment = body.threshold_attainment
    if (body.multiplier !== undefined) patch.multiplier = body.multiplier
    if (body.per_period_cap_cents !== undefined)
      patch.per_period_cap_cents = body.per_period_cap_cents
    if (body.per_deal_cap_cents !== undefined) patch.per_deal_cap_cents = body.per_deal_cap_cents
    const [updated] = await db
      .update(accelerators)
      .set(patch)
      .where(eq(accelerators.id, id))
      .returning()
    return c.json(updated)
  },
)

// DELETE /accelerators/:id — delete accelerator — auth
router.delete('/accelerators/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(accelerators).where(eq(accelerators.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsVersion(existing.plan_version_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(accelerators).where(eq(accelerators.id, id))
  return c.json({ success: true })
})

// GET /validate — tier integrity (gaps/overlaps) for ?plan_version_id= — public
router.get('/validate', async (c) => {
  const versionId = c.req.query('plan_version_id')
  if (!versionId) return c.json({ error: 'plan_version_id is required' }, 400)

  const tiers = await db
    .select()
    .from(rate_tiers)
    .where(eq(rate_tiers.plan_version_id, versionId))

  // Sort by lower bound to inspect the ladder.
  const sorted = [...tiers].sort((a, b) => a.lower_bound - b.lower_bound)

  const issues: { type: string; message: string; tier_ids: string[] }[] = []

  if (sorted.length === 0) {
    return c.json({ valid: true, issues: [] })
  }

  // First tier should start at 0 (ladder origin).
  if (sorted[0].lower_bound !== 0) {
    issues.push({
      type: 'origin',
      message: `Lowest tier starts at ${sorted[0].lower_bound}, expected 0`,
      tier_ids: [sorted[0].id],
    })
  }

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]
    // A tier whose upper bound is below its lower bound is invalid.
    if (t.upper_bound !== null && t.upper_bound <= t.lower_bound) {
      issues.push({
        type: 'inverted',
        message: `Tier upper bound ${t.upper_bound} is not greater than lower bound ${t.lower_bound}`,
        tier_ids: [t.id],
      })
    }
    // A null upper bound (open-ended) must be the final tier.
    if (t.upper_bound === null && i !== sorted.length - 1) {
      issues.push({
        type: 'open_ended_not_last',
        message: 'An open-ended tier (no upper bound) must be the highest tier',
        tier_ids: [t.id],
      })
    }
    if (i > 0) {
      const prev = sorted[i - 1]
      if (prev.upper_bound === null) {
        // Previous open-ended tier already covers everything above.
        issues.push({
          type: 'overlap',
          message: 'Tier follows an open-ended tier and is unreachable',
          tier_ids: [prev.id, t.id],
        })
      } else if (t.lower_bound < prev.upper_bound) {
        issues.push({
          type: 'overlap',
          message: `Tier lower bound ${t.lower_bound} overlaps previous tier upper bound ${prev.upper_bound}`,
          tier_ids: [prev.id, t.id],
        })
      } else if (t.lower_bound > prev.upper_bound) {
        issues.push({
          type: 'gap',
          message: `Gap between ${prev.upper_bound} and ${t.lower_bound}`,
          tier_ids: [prev.id, t.id],
        })
      }
    }
  }

  return c.json({ valid: issues.length === 0, issues })
})

export default router
