import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  split_rules,
  comp_plan_versions,
  comp_plans,
  workspace_members,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  plan_version_id: z.string().min(1),
  role: z.string().min(1),
  percentage: z.number().min(0).max(100),
  is_default: z.boolean().optional().default(false),
})

const updateSchema = z.object({
  role: z.string().min(1).optional(),
  percentage: z.number().min(0).max(100).optional(),
  is_default: z.boolean().optional(),
})

// Resolve the workspace owning a given plan_version_id (via comp_plan_versions -> comp_plans).
async function workspaceForVersion(planVersionId: string): Promise<string | null> {
  const [v] = await db
    .select({ comp_plan_id: comp_plan_versions.comp_plan_id })
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.id, planVersionId))
  if (!v) return null
  const [p] = await db
    .select({ workspace_id: comp_plans.workspace_id })
    .from(comp_plans)
    .where(eq(comp_plans.id, v.comp_plan_id))
  return p ? p.workspace_id : null
}

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// Public: list split rules for a plan version
router.get('/', async (c) => {
  const planVersionId = c.req.query('plan_version_id')
  if (!planVersionId) return c.json({ error: 'plan_version_id is required' }, 400)
  const rows = await db
    .select()
    .from(split_rules)
    .where(eq(split_rules.plan_version_id, planVersionId))
    .orderBy(split_rules.created_at)
  return c.json(rows)
})

// Public: sum-to-100 policy check for a plan version
router.get('/check', async (c) => {
  const planVersionId = c.req.query('plan_version_id')
  if (!planVersionId) return c.json({ error: 'plan_version_id is required' }, 400)
  const rows = await db
    .select()
    .from(split_rules)
    .where(eq(split_rules.plan_version_id, planVersionId))
  const total = rows.reduce((acc, r) => acc + (r.percentage ?? 0), 0)
  const rounded = Math.round(total * 100) / 100
  const ok = Math.abs(rounded - 100) < 0.001
  return c.json({
    total: rounded,
    ok,
    policy: 'sum-to-100',
    rule_count: rows.length,
  })
})

// Auth: create a split rule
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const workspaceId = await workspaceForVersion(body.plan_version_id)
  if (!workspaceId) return c.json({ error: 'Plan version not found' }, 404)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db.insert(split_rules).values(body).returning()
  return c.json(created, 201)
})

// Auth: update a split rule
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(split_rules).where(eq(split_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const workspaceId = await workspaceForVersion(existing.plan_version_id)
  if (!workspaceId || !(await isMember(workspaceId, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(split_rules)
    .set(body)
    .where(eq(split_rules.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete a split rule
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(split_rules).where(eq(split_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const workspaceId = await workspaceForVersion(existing.plan_version_id)
  if (!workspaceId || !(await isMember(workspaceId, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(split_rules).where(eq(split_rules.id, id))
  return c.json({ success: true })
})

export default router
