import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { saved_views, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(userId: string, workspaceId: string): Promise<boolean> {
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

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  resource: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).optional().default({}),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
})

// GET / — caller's saved views for ?workspace_id= (&resource)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  const resource = c.req.query('resource')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const conditions = [
    eq(saved_views.user_id, userId),
    eq(saved_views.workspace_id, workspaceId),
  ]
  if (resource) conditions.push(eq(saved_views.resource, resource))

  const rows = await db
    .select()
    .from(saved_views)
    .where(and(...conditions))
    .orderBy(desc(saved_views.created_at))
  return c.json(rows)
})

// POST / — create saved view
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(userId, body.workspace_id))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [created] = await db
    .insert(saved_views)
    .values({
      user_id: userId,
      workspace_id: body.workspace_id,
      name: body.name,
      resource: body.resource,
      filter: body.filter,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — update
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db
    .update(saved_views)
    .set(body)
    .where(eq(saved_views.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(saved_views).where(eq(saved_views.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(saved_views).where(eq(saved_views.id, id))
  return c.json({ success: true })
})

export default router
