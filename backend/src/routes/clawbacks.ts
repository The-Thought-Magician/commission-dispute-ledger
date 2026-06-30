import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { clawbacks, deals, reps } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  deal_id: z.string().min(1),
  rep_id: z.string().min(1),
  original_payout_cents: z.number().int().nonnegative().optional().default(0),
  amount_cents: z.number().int().nonnegative().optional().default(0),
  reason: z.string().optional().default(''),
  status: z.enum(['pending', 'applied', 'waived']).optional().default('pending'),
})

const updateSchema = z.object({
  original_payout_cents: z.number().int().nonnegative().optional(),
  amount_cents: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
  status: z.enum(['pending', 'applied', 'waived']).optional(),
})

// GET / — public — clawbacks for ?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(clawbacks)
    .where(eq(clawbacks.workspace_id, workspaceId))
    .orderBy(desc(clawbacks.created_at))
  return c.json(rows)
})

// POST / — auth — create clawback
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, body.deal_id), eq(deals.workspace_id, body.workspace_id)))
  if (!deal) return c.json({ error: 'Deal not found in workspace' }, 404)

  const [rep] = await db
    .select()
    .from(reps)
    .where(and(eq(reps.id, body.rep_id), eq(reps.workspace_id, body.workspace_id)))
  if (!rep) return c.json({ error: 'Rep not found in workspace' }, 404)

  const [created] = await db
    .insert(clawbacks)
    .values({
      workspace_id: body.workspace_id,
      deal_id: body.deal_id,
      rep_id: body.rep_id,
      original_payout_cents: body.original_payout_cents,
      amount_cents: body.amount_cents,
      reason: body.reason,
      status: body.status,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — auth — update / set status (pending/applied/waived)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(clawbacks).where(eq(clawbacks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const patch: Record<string, unknown> = {}
  if (body.original_payout_cents !== undefined) patch.original_payout_cents = body.original_payout_cents
  if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents
  if (body.reason !== undefined) patch.reason = body.reason
  if (body.status !== undefined) patch.status = body.status
  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db.update(clawbacks).set(patch).where(eq(clawbacks.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(clawbacks).where(eq(clawbacks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(clawbacks).where(eq(clawbacks.id, id))
  return c.json({ success: true })
})

export default router
