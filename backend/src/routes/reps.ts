import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reps,
  rep_plan_assignments,
  comp_plans,
  periods,
  workspace_members,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createRepSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email().optional().default(''),
  role: z.string().min(1).optional().default('AE'),
  territory: z.string().optional().default(''),
  status: z.string().optional().default('active'),
  hire_date: z.string().datetime().optional(),
  tags: z.array(z.string()).optional().default([]),
})

const updateRepSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.string().min(1).optional(),
  territory: z.string().optional(),
  status: z.string().optional(),
  hire_date: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
})

const assignmentSchema = z.object({
  comp_plan_id: z.string().min(1),
  period_id: z.string().min(1),
  quota_cents: z.number().int().optional().default(0),
})

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

// Public: roster for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(reps)
    .where(eq(reps.workspace_id, workspaceId))
    .orderBy(reps.created_at)
  return c.json(rows)
})

// Public: rep detail
router.get('/:id', async (c) => {
  const [rep] = await db.select().from(reps).where(eq(reps.id, c.req.param('id')))
  if (!rep) return c.json({ error: 'Not found' }, 404)
  return c.json(rep)
})

// Public: assignments list for a rep
router.get('/:id/assignments', async (c) => {
  const repId = c.req.param('id')
  const [rep] = await db.select().from(reps).where(eq(reps.id, repId))
  if (!rep) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(rep_plan_assignments)
    .where(eq(rep_plan_assignments.rep_id, repId))
    .orderBy(rep_plan_assignments.created_at)
  return c.json(rows)
})

// Auth: create a rep
router.post('/', authMiddleware, zValidator('json', createRepSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db
    .insert(reps)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      email: body.email,
      role: body.role,
      territory: body.territory,
      status: body.status,
      hire_date: body.hire_date ? new Date(body.hire_date) : null,
      tags: body.tags,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update a rep
router.put('/:id', authMiddleware, zValidator('json', updateRepSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reps).where(eq(reps.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.email !== undefined) patch.email = body.email
  if (body.role !== undefined) patch.role = body.role
  if (body.territory !== undefined) patch.territory = body.territory
  if (body.status !== undefined) patch.status = body.status
  if (body.hire_date !== undefined) patch.hire_date = new Date(body.hire_date)
  if (body.tags !== undefined) patch.tags = body.tags
  const [updated] = await db.update(reps).set(patch).where(eq(reps.id, id)).returning()
  return c.json(updated)
})

// Auth: delete a rep
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reps).where(eq(reps.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(rep_plan_assignments).where(eq(rep_plan_assignments.rep_id, id))
  await db.delete(reps).where(eq(reps.id, id))
  return c.json({ success: true })
})

// Auth: assign a plan + quota for a period (upsert on rep_id+period_id)
router.post('/:id/assignments', authMiddleware, zValidator('json', assignmentSchema), async (c) => {
  const userId = getUserId(c)
  const repId = c.req.param('id')
  const body = c.req.valid('json')
  const [rep] = await db.select().from(reps).where(eq(reps.id, repId))
  if (!rep) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(rep.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Validate referenced plan + period belong to the same workspace.
  const [plan] = await db.select().from(comp_plans).where(eq(comp_plans.id, body.comp_plan_id))
  if (!plan || plan.workspace_id !== rep.workspace_id)
    return c.json({ error: 'comp_plan_id invalid for this workspace' }, 400)
  const [period] = await db.select().from(periods).where(eq(periods.id, body.period_id))
  if (!period || period.workspace_id !== rep.workspace_id)
    return c.json({ error: 'period_id invalid for this workspace' }, 400)

  const [assignment] = await db
    .insert(rep_plan_assignments)
    .values({
      rep_id: repId,
      comp_plan_id: body.comp_plan_id,
      period_id: body.period_id,
      quota_cents: body.quota_cents,
    })
    .onConflictDoUpdate({
      target: [rep_plan_assignments.rep_id, rep_plan_assignments.period_id],
      set: { comp_plan_id: body.comp_plan_id, quota_cents: body.quota_cents },
    })
    .returning()
  return c.json(assignment, 201)
})

export default router
