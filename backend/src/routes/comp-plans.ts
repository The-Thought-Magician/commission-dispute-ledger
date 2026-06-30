import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  comp_plans,
  comp_plan_versions,
  rate_tiers,
  accelerators,
  split_rules,
  workspaces,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createPlanSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  currency: z.string().min(1).optional(),
  effective_start: z.string().datetime().optional(),
  effective_end: z.string().datetime().optional(),
  base_rate: z.number().optional(),
  rate_basis: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
})

const updatePlanSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  currency: z.string().min(1).optional(),
  effective_start: z.string().datetime().nullable().optional(),
  effective_end: z.string().datetime().nullable().optional(),
})

const versionSchema = z.object({
  base_rate: z.number().optional(),
  rate_basis: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  notes: z.string().optional(),
})

const cloneSchema = z.object({
  name: z.string().min(1).optional(),
})

// Helpers ───────────────────────────────────────────────────────
async function getPlan(id: string) {
  const [p] = await db.select().from(comp_plans).where(eq(comp_plans.id, id))
  return p
}

async function ownsWorkspace(workspaceId: string, userId: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  return !!w && w.owner_id === userId
}

async function latestVersionNumber(planId: string): Promise<number> {
  const [latest] = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.comp_plan_id, planId))
    .orderBy(desc(comp_plan_versions.version_number))
    .limit(1)
  return latest ? latest.version_number : 0
}

// GET / — list plans (by workspace_id query) — public
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const plans = await db
    .select()
    .from(comp_plans)
    .where(eq(comp_plans.workspace_id, workspaceId))
    .orderBy(desc(comp_plans.created_at))
  return c.json(plans)
})

// POST / — create plan (+ v1) — auth
router.post('/', authMiddleware, zValidator('json', createPlanSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await ownsWorkspace(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const [plan] = await db
    .insert(comp_plans)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      description: body.description ?? '',
      currency: body.currency ?? 'USD',
      effective_start: body.effective_start ? new Date(body.effective_start) : null,
      effective_end: body.effective_end ? new Date(body.effective_end) : null,
      created_by: userId,
      updated_at: new Date(),
    })
    .returning()
  const [version] = await db
    .insert(comp_plan_versions)
    .values({
      comp_plan_id: plan.id,
      version_number: 1,
      base_rate: body.base_rate ?? 0,
      rate_basis: body.rate_basis ?? 'revenue',
      config: body.config ?? {},
      notes: body.notes ?? '',
      created_by: userId,
    })
    .returning()
  return c.json({ ...plan, versions: [version] }, 201)
})

// GET /:id — plan detail + versions — public
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  const versions = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.comp_plan_id, id))
    .orderBy(desc(comp_plan_versions.version_number))
  return c.json({ ...plan, versions })
})

// PUT /:id — update header (owner) — auth
router.put('/:id', authMiddleware, zValidator('json', updatePlanSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(plan.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.description !== undefined) patch.description = body.description
  if (body.currency !== undefined) patch.currency = body.currency
  if (body.effective_start !== undefined)
    patch.effective_start = body.effective_start ? new Date(body.effective_start) : null
  if (body.effective_end !== undefined)
    patch.effective_end = body.effective_end ? new Date(body.effective_end) : null
  const [updated] = await db.update(comp_plans).set(patch).where(eq(comp_plans.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — delete (owner) — auth
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(plan.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  // Cascade clean version children, then versions, then plan
  const versions = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.comp_plan_id, id))
  for (const v of versions) {
    await db.delete(rate_tiers).where(eq(rate_tiers.plan_version_id, v.id))
    await db.delete(accelerators).where(eq(accelerators.plan_version_id, v.id))
    await db.delete(split_rules).where(eq(split_rules.plan_version_id, v.id))
  }
  await db.delete(comp_plan_versions).where(eq(comp_plan_versions.comp_plan_id, id))
  await db.delete(comp_plans).where(eq(comp_plans.id, id))
  return c.json({ success: true })
})

// POST /:id/versions — new immutable version — auth
router.post('/:id/versions', authMiddleware, zValidator('json', versionSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(plan.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const next = (await latestVersionNumber(id)) + 1
  const [version] = await db
    .insert(comp_plan_versions)
    .values({
      comp_plan_id: id,
      version_number: next,
      base_rate: body.base_rate ?? 0,
      rate_basis: body.rate_basis ?? 'revenue',
      config: body.config ?? {},
      notes: body.notes ?? '',
      created_by: userId,
    })
    .returning()
  await db.update(comp_plans).set({ updated_at: new Date() }).where(eq(comp_plans.id, id))
  return c.json(version, 201)
})

// GET /:id/versions — list versions — public
router.get('/:id/versions', async (c) => {
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  const versions = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.comp_plan_id, id))
    .orderBy(desc(comp_plan_versions.version_number))
  return c.json(versions)
})

// POST /:id/clone — clone plan + latest version (with tiers/accelerators/splits) — auth
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)
  if (!(await ownsWorkspace(plan.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')

  // Source: latest version of the plan
  const [srcVersion] = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.comp_plan_id, id))
    .orderBy(desc(comp_plan_versions.version_number))
    .limit(1)

  const [clonePlan] = await db
    .insert(comp_plans)
    .values({
      workspace_id: plan.workspace_id,
      name: body.name ?? `${plan.name} (copy)`,
      description: plan.description,
      currency: plan.currency,
      effective_start: plan.effective_start,
      effective_end: plan.effective_end,
      created_by: userId,
      updated_at: new Date(),
    })
    .returning()

  let cloneVersion = null
  if (srcVersion) {
    const [cv] = await db
      .insert(comp_plan_versions)
      .values({
        comp_plan_id: clonePlan.id,
        version_number: 1,
        base_rate: srcVersion.base_rate,
        rate_basis: srcVersion.rate_basis,
        config: srcVersion.config ?? {},
        notes: srcVersion.notes,
        created_by: userId,
      })
      .returning()
    cloneVersion = cv

    const tiers = await db
      .select()
      .from(rate_tiers)
      .where(eq(rate_tiers.plan_version_id, srcVersion.id))
    for (const t of tiers) {
      await db.insert(rate_tiers).values({
        plan_version_id: cv.id,
        lower_bound: t.lower_bound,
        upper_bound: t.upper_bound,
        rate: t.rate,
        multiplier: t.multiplier,
        sort_order: t.sort_order,
      })
    }
    const accs = await db
      .select()
      .from(accelerators)
      .where(eq(accelerators.plan_version_id, srcVersion.id))
    for (const a of accs) {
      await db.insert(accelerators).values({
        plan_version_id: cv.id,
        threshold_attainment: a.threshold_attainment,
        multiplier: a.multiplier,
        per_period_cap_cents: a.per_period_cap_cents,
        per_deal_cap_cents: a.per_deal_cap_cents,
      })
    }
    const splits = await db
      .select()
      .from(split_rules)
      .where(eq(split_rules.plan_version_id, srcVersion.id))
    for (const s of splits) {
      await db.insert(split_rules).values({
        plan_version_id: cv.id,
        role: s.role,
        percentage: s.percentage,
        is_default: s.is_default,
      })
    }
  }

  return c.json({ ...clonePlan, versions: cloneVersion ? [cloneVersion] : [] }, 201)
})

// GET /:id/compare — diff two versions (?a=&b=) — public
router.get('/:id/compare', async (c) => {
  const id = c.req.param('id')
  const aNum = c.req.query('a')
  const bNum = c.req.query('b')
  if (!aNum || !bNum) return c.json({ error: 'a and b version numbers are required' }, 400)
  const plan = await getPlan(id)
  if (!plan) return c.json({ error: 'Not found' }, 404)

  const [a] = await db
    .select()
    .from(comp_plan_versions)
    .where(
      and(
        eq(comp_plan_versions.comp_plan_id, id),
        eq(comp_plan_versions.version_number, parseInt(aNum, 10)),
      ),
    )
  const [b] = await db
    .select()
    .from(comp_plan_versions)
    .where(
      and(
        eq(comp_plan_versions.comp_plan_id, id),
        eq(comp_plan_versions.version_number, parseInt(bNum, 10)),
      ),
    )
  if (!a || !b) return c.json({ error: 'Version not found' }, 404)

  async function bundle(versionId: string) {
    const tiers = await db
      .select()
      .from(rate_tiers)
      .where(eq(rate_tiers.plan_version_id, versionId))
      .orderBy(rate_tiers.sort_order)
    const accs = await db
      .select()
      .from(accelerators)
      .where(eq(accelerators.plan_version_id, versionId))
    const splits = await db
      .select()
      .from(split_rules)
      .where(eq(split_rules.plan_version_id, versionId))
    return { tiers, accelerators: accs, split_rules: splits }
  }

  const aBundle = await bundle(a.id)
  const bBundle = await bundle(b.id)

  const fieldDiffs: { field: string; a: unknown; b: unknown }[] = []
  for (const field of ['base_rate', 'rate_basis', 'notes'] as const) {
    if (a[field] !== b[field]) fieldDiffs.push({ field, a: a[field], b: b[field] })
  }
  if (JSON.stringify(a.config) !== JSON.stringify(b.config))
    fieldDiffs.push({ field: 'config', a: a.config, b: b.config })

  const diff = {
    fields: fieldDiffs,
    tier_count: { a: aBundle.tiers.length, b: bBundle.tiers.length },
    accelerator_count: { a: aBundle.accelerators.length, b: bBundle.accelerators.length },
    split_rule_count: { a: aBundle.split_rules.length, b: bBundle.split_rules.length },
  }

  return c.json({
    a: { ...a, ...aBundle },
    b: { ...b, ...bBundle },
    diff,
  })
})

export default router
