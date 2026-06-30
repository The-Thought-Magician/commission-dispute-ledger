import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { adjustments, workspaces, workspace_members, reps, periods, disputes } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// Ownership helper: caller must be a member (or owner) of the workspace.
// ─────────────────────────────────────────────────────────────
async function isWorkspaceMember(workspaceId: string, userId: string): Promise<boolean> {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return false
  if (ws.owner_id === userId) return true
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!member
}

const createSchema = z.object({
  workspace_id: z.string().min(1),
  rep_id: z.string().min(1),
  period_id: z.string().min(1).nullable().optional(),
  amount_cents: z.number().int(),
  direction: z.enum(['credit', 'debit']).default('credit'),
  reason: z.string().default(''),
  status: z.enum(['pending', 'approved', 'applied', 'rejected']).default('pending'),
  dispute_id: z.string().min(1).nullable().optional(),
})

const updateSchema = z.object({
  rep_id: z.string().min(1).optional(),
  period_id: z.string().min(1).nullable().optional(),
  amount_cents: z.number().int().optional(),
  direction: z.enum(['credit', 'debit']).optional(),
  reason: z.string().optional(),
  status: z.enum(['pending', 'approved', 'applied', 'rejected']).optional(),
  dispute_id: z.string().min(1).nullable().optional(),
})

// ─────────────────────────────────────────────────────────────
// GET / — public — adjustments for ?workspace_id= (&rep_id)
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const repId = c.req.query('rep_id')

  const conditions = [eq(adjustments.workspace_id, workspaceId)]
  if (repId) conditions.push(eq(adjustments.rep_id, repId))

  const rows = await db
    .select()
    .from(adjustments)
    .where(and(...conditions))
    .orderBy(desc(adjustments.created_at))
  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// POST / — auth — create adjustment
// ─────────────────────────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  if (!(await isWorkspaceMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  // Validate referenced rep belongs to the workspace.
  const [rep] = await db.select().from(reps).where(eq(reps.id, body.rep_id))
  if (!rep || rep.workspace_id !== body.workspace_id) {
    return c.json({ error: 'Rep not found in workspace' }, 400)
  }

  // Validate optional period belongs to the workspace.
  if (body.period_id) {
    const [period] = await db.select().from(periods).where(eq(periods.id, body.period_id))
    if (!period || period.workspace_id !== body.workspace_id) {
      return c.json({ error: 'Period not found in workspace' }, 400)
    }
  }

  // Validate optional dispute link belongs to the workspace.
  if (body.dispute_id) {
    const [dispute] = await db.select().from(disputes).where(eq(disputes.id, body.dispute_id))
    if (!dispute || dispute.workspace_id !== body.workspace_id) {
      return c.json({ error: 'Dispute not found in workspace' }, 400)
    }
  }

  const [created] = await db
    .insert(adjustments)
    .values({
      workspace_id: body.workspace_id,
      rep_id: body.rep_id,
      period_id: body.period_id ?? null,
      amount_cents: body.amount_cents,
      direction: body.direction,
      reason: body.reason,
      status: body.status,
      dispute_id: body.dispute_id ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ─────────────────────────────────────────────────────────────
// PUT /:id — auth — update / set status
// ─────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')

  const [existing] = await db.select().from(adjustments).where(eq(adjustments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  if (body.rep_id) {
    const [rep] = await db.select().from(reps).where(eq(reps.id, body.rep_id))
    if (!rep || rep.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'Rep not found in workspace' }, 400)
    }
  }
  if (body.period_id) {
    const [period] = await db.select().from(periods).where(eq(periods.id, body.period_id))
    if (!period || period.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'Period not found in workspace' }, 400)
    }
  }
  if (body.dispute_id) {
    const [dispute] = await db.select().from(disputes).where(eq(disputes.id, body.dispute_id))
    if (!dispute || dispute.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'Dispute not found in workspace' }, 400)
    }
  }

  const patch: Record<string, unknown> = {}
  if (body.rep_id !== undefined) patch.rep_id = body.rep_id
  if (body.period_id !== undefined) patch.period_id = body.period_id
  if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents
  if (body.direction !== undefined) patch.direction = body.direction
  if (body.reason !== undefined) patch.reason = body.reason
  if (body.status !== undefined) patch.status = body.status
  if (body.dispute_id !== undefined) patch.dispute_id = body.dispute_id

  if (Object.keys(patch).length === 0) return c.json(existing)

  const [updated] = await db.update(adjustments).set(patch).where(eq(adjustments.id, id)).returning()
  return c.json(updated)
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id — auth — delete
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(adjustments).where(eq(adjustments.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isWorkspaceMember(existing.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db.delete(adjustments).where(eq(adjustments.id, id))
  return c.json({ success: true })
})

export default router
