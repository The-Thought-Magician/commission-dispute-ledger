import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  disputes,
  dispute_deals,
  dispute_comments,
  deals,
  reps,
  adjustments,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  rep_id: z.string().min(1),
  period_id: z.string().min(1).optional().nullable(),
  claimed_amount_cents: z.number().int().optional().default(0),
  narrative: z.string().optional().default(''),
  status: z.enum(['open', 'under_review', 'resolved', 'rejected']).optional().default('open'),
  assignee: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  calc_snapshot: z.record(z.unknown()).optional(),
})

const updateSchema = z.object({
  claimed_amount_cents: z.number().int().optional(),
  narrative: z.string().optional(),
  status: z.enum(['open', 'under_review', 'resolved', 'rejected']).optional(),
  assignee: z.string().optional().nullable(),
  due_date: z.string().datetime().optional().nullable(),
  calc_snapshot: z.record(z.unknown()).optional(),
})

const resolveSchema = z.object({
  resolution_amount_cents: z.number().int(),
  resolution_note: z.string().optional().default(''),
  create_adjustment: z.boolean().optional().default(false),
})

const attachSchema = z.object({ deal_id: z.string().min(1) })
const commentSchema = z.object({ body: z.string().min(1) })

// GET / — public — disputes for ?workspace_id= (&status)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const where = status
    ? and(eq(disputes.workspace_id, workspaceId), eq(disputes.status, status))
    : eq(disputes.workspace_id, workspaceId)
  const rows = await db.select().from(disputes).where(where).orderBy(desc(disputes.created_at))
  return c.json(rows)
})

// POST / — auth — create dispute
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [rep] = await db
    .select()
    .from(reps)
    .where(and(eq(reps.id, body.rep_id), eq(reps.workspace_id, body.workspace_id)))
  if (!rep) return c.json({ error: 'Rep not found in workspace' }, 404)

  const [created] = await db
    .insert(disputes)
    .values({
      workspace_id: body.workspace_id,
      rep_id: body.rep_id,
      period_id: body.period_id ?? null,
      claimed_amount_cents: body.claimed_amount_cents,
      narrative: body.narrative,
      status: body.status,
      assignee: body.assignee ?? null,
      due_date: body.due_date ? new Date(body.due_date) : null,
      calc_snapshot: body.calc_snapshot ?? {},
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// GET /:id — public — dispute + deals + comments
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!dispute) return c.json({ error: 'Not found' }, 404)
  const links = await db.select().from(dispute_deals).where(eq(dispute_deals.dispute_id, id))
  const dealRows = []
  for (const link of links) {
    const [deal] = await db.select().from(deals).where(eq(deals.id, link.deal_id))
    if (deal) dealRows.push({ ...deal, link_id: link.id })
  }
  const comments = await db
    .select()
    .from(dispute_comments)
    .where(eq(dispute_comments.dispute_id, id))
    .orderBy(dispute_comments.created_at)
  return c.json({ dispute, deals: dealRows, comments })
})

// PUT /:id — auth — update fields/status/assignee
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.claimed_amount_cents !== undefined) patch.claimed_amount_cents = body.claimed_amount_cents
  if (body.narrative !== undefined) patch.narrative = body.narrative
  if (body.status !== undefined) patch.status = body.status
  if (body.assignee !== undefined) patch.assignee = body.assignee
  if (body.due_date !== undefined) patch.due_date = body.due_date ? new Date(body.due_date) : null
  if (body.calc_snapshot !== undefined) patch.calc_snapshot = body.calc_snapshot

  const [updated] = await db.update(disputes).set(patch).where(eq(disputes.id, id)).returning()
  return c.json(updated)
})

// POST /:id/resolve — auth — resolve + optional adjustment
router.post('/:id/resolve', authMiddleware, zValidator('json', resolveSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)

  const [updated] = await db
    .update(disputes)
    .set({
      status: 'resolved',
      resolution_amount_cents: body.resolution_amount_cents,
      resolution_note: body.resolution_note,
      updated_at: new Date(),
    })
    .where(eq(disputes.id, id))
    .returning()

  if (body.create_adjustment && body.resolution_amount_cents !== 0) {
    await db.insert(adjustments).values({
      workspace_id: existing.workspace_id,
      rep_id: existing.rep_id,
      period_id: existing.period_id ?? null,
      amount_cents: Math.abs(body.resolution_amount_cents),
      direction: body.resolution_amount_cents >= 0 ? 'credit' : 'debit',
      reason: `Dispute resolution: ${body.resolution_note}`.slice(0, 500),
      status: 'pending',
      dispute_id: id,
      created_by: userId,
    })
  }

  return c.json(updated)
})

// DELETE /:id — auth — delete (and links/comments)
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(dispute_comments).where(eq(dispute_comments.dispute_id, id))
  await db.delete(dispute_deals).where(eq(dispute_deals.dispute_id, id))
  await db.delete(disputes).where(eq(disputes.id, id))
  return c.json({ success: true })
})

// POST /:id/deals — auth — attach disputed deal
router.post('/:id/deals', authMiddleware, zValidator('json', attachSchema), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!dispute) return c.json({ error: 'Not found' }, 404)
  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, body.deal_id), eq(deals.workspace_id, dispute.workspace_id)))
  if (!deal) return c.json({ error: 'Deal not found in workspace' }, 404)

  const [existingLink] = await db
    .select()
    .from(dispute_deals)
    .where(and(eq(dispute_deals.dispute_id, id), eq(dispute_deals.deal_id, body.deal_id)))
  if (existingLink) return c.json(existingLink, 200)

  const [link] = await db
    .insert(dispute_deals)
    .values({ dispute_id: id, deal_id: body.deal_id })
    .returning()
  return c.json(link, 201)
})

// DELETE /:id/deals/:dealId — auth — detach
router.delete('/:id/deals/:dealId', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const dealId = c.req.param('dealId')
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!dispute) return c.json({ error: 'Not found' }, 404)
  await db
    .delete(dispute_deals)
    .where(and(eq(dispute_deals.dispute_id, id), eq(dispute_deals.deal_id, dealId)))
  return c.json({ success: true })
})

// POST /:id/comments — auth — add comment
router.post('/:id/comments', authMiddleware, zValidator('json', commentSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!dispute) return c.json({ error: 'Not found' }, 404)
  const [comment] = await db
    .insert(dispute_comments)
    .values({ dispute_id: id, author: userId, body: body.body })
    .returning()
  return c.json(comment, 201)
})

// GET /:id/comments — public — comment thread
router.get('/:id/comments', async (c) => {
  const id = c.req.param('id')
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, id))
  if (!dispute) return c.json({ error: 'Not found' }, 404)
  const comments = await db
    .select()
    .from(dispute_comments)
    .where(eq(dispute_comments.dispute_id, id))
    .orderBy(dispute_comments.created_at)
  return c.json(comments)
})

export default router
