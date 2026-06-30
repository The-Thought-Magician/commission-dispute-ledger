import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { periods, workspace_members } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  label: z.string().min(1),
  kind: z.string().min(1).optional().default('monthly'),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  status: z.string().optional().default('open'),
})

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
  status: z.string().optional(),
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

// Public: periods for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(periods)
    .where(eq(periods.workspace_id, workspaceId))
    .orderBy(desc(periods.start_date))
  return c.json(rows)
})

// Public: period detail
router.get('/:id', async (c) => {
  const [period] = await db.select().from(periods).where(eq(periods.id, c.req.param('id')))
  if (!period) return c.json({ error: 'Not found' }, 404)
  return c.json(period)
})

// Auth: create a period
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const start = new Date(body.start_date)
  const end = new Date(body.end_date)
  if (end <= start) return c.json({ error: 'end_date must be after start_date' }, 400)
  const [created] = await db
    .insert(periods)
    .values({
      workspace_id: body.workspace_id,
      label: body.label,
      kind: body.kind,
      start_date: start,
      end_date: end,
      status: body.status,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: update a period (blocked once locked/closed)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(periods).where(eq(periods.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (existing.status === 'locked' || existing.status === 'closed')
    return c.json({ error: `Cannot edit a ${existing.status} period` }, 409)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.label !== undefined) patch.label = body.label
  if (body.kind !== undefined) patch.kind = body.kind
  if (body.start_date !== undefined) patch.start_date = new Date(body.start_date)
  if (body.end_date !== undefined) patch.end_date = new Date(body.end_date)
  if (body.status !== undefined) patch.status = body.status
  const start = patch.start_date instanceof Date ? patch.start_date : existing.start_date
  const end = patch.end_date instanceof Date ? patch.end_date : existing.end_date
  if (end <= start) return c.json({ error: 'end_date must be after start_date' }, 400)
  const [updated] = await db.update(periods).set(patch).where(eq(periods.id, id)).returning()
  return c.json(updated)
})

// Auth: lock a period
router.post('/:id/lock', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(periods).where(eq(periods.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (existing.status === 'closed') return c.json({ error: 'Cannot lock a closed period' }, 409)
  const [updated] = await db
    .update(periods)
    .set({ status: 'locked' })
    .where(eq(periods.id, id))
    .returning()
  return c.json(updated)
})

// Auth: close a period (must be locked first)
router.post('/:id/close', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(periods).where(eq(periods.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (existing.status === 'closed') return c.json(existing)
  if (existing.status !== 'locked')
    return c.json({ error: 'Period must be locked before it can be closed' }, 409)
  const [updated] = await db
    .update(periods)
    .set({ status: 'closed' })
    .where(eq(periods.id, id))
    .returning()
  return c.json(updated)
})

export default router
