import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { deals, deal_credits, workspaces, workspace_members, reps, periods } from '../db/schema.js'
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

function toDateOrNull(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}

const dealSchema = z.object({
  workspace_id: z.string().min(1),
  account_name: z.string().min(1),
  amount_cents: z.number().int(),
  margin_cents: z.number().int().optional().default(0),
  product: z.string().optional().default(''),
  close_date: z.string().min(1),
  currency: z.string().optional().default('USD'),
  status: z.string().optional().default('closed_won'),
  external_id: z.string().optional().nullable(),
  period_id: z.string().optional().nullable(),
})

const dealUpdateSchema = z.object({
  account_name: z.string().min(1).optional(),
  amount_cents: z.number().int().optional(),
  margin_cents: z.number().int().optional(),
  product: z.string().optional(),
  close_date: z.string().optional(),
  currency: z.string().optional(),
  status: z.string().optional(),
  external_id: z.string().nullable().optional(),
  period_id: z.string().nullable().optional(),
})

const creditSchema = z.object({
  rep_id: z.string().min(1),
  role: z.string().optional().default('AE'),
  split_pct: z.number().optional().default(100),
})

const bulkImportSchema = z.object({
  workspace_id: z.string().min(1),
  deals: z
    .array(
      z.object({
        account_name: z.string().min(1),
        amount_cents: z.number().int(),
        margin_cents: z.number().int().optional().default(0),
        product: z.string().optional().default(''),
        close_date: z.string().min(1),
        currency: z.string().optional().default('USD'),
        status: z.string().optional().default('closed_won'),
        external_id: z.string().optional().nullable(),
        period_id: z.string().optional().nullable(),
      }),
    )
    .min(1),
})

// ─────────────────────────────────────────────────────────────
// GET / — public — deals for ?workspace_id= (&period_id, &status)
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id')
  const status = c.req.query('status')

  const conditions = [eq(deals.workspace_id, workspaceId)]
  if (periodId) conditions.push(eq(deals.period_id, periodId))
  if (status) conditions.push(eq(deals.status, status))

  const rows = await db
    .select()
    .from(deals)
    .where(and(...conditions))
    .orderBy(desc(deals.close_date))
  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// POST / — auth — create deal
// ─────────────────────────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', dealSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const closeDate = toDateOrNull(body.close_date)
  if (!closeDate) return c.json({ error: 'Invalid close_date' }, 400)

  if (body.period_id) {
    const [p] = await db.select().from(periods).where(eq(periods.id, body.period_id))
    if (!p || p.workspace_id !== body.workspace_id) return c.json({ error: 'Invalid period_id' }, 400)
  }

  const [created] = await db
    .insert(deals)
    .values({
      workspace_id: body.workspace_id,
      account_name: body.account_name,
      amount_cents: body.amount_cents,
      margin_cents: body.margin_cents,
      product: body.product,
      close_date: closeDate,
      currency: body.currency,
      status: body.status,
      external_id: body.external_id ?? null,
      period_id: body.period_id ?? null,
    })
    .returning()
  return c.json(created, 201)
})

// ─────────────────────────────────────────────────────────────
// GET /:id — public — deal + credits
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [deal] = await db.select().from(deals).where(eq(deals.id, id))
  if (!deal) return c.json({ error: 'Not found' }, 404)
  const credits = await db
    .select()
    .from(deal_credits)
    .where(eq(deal_credits.deal_id, id))
    .orderBy(desc(deal_credits.created_at))
  return c.json({ ...deal, credits })
})

// ─────────────────────────────────────────────────────────────
// PUT /:id — auth — update
// ─────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, zValidator('json', dealUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(deals).where(eq(deals.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.account_name !== undefined) patch.account_name = body.account_name
  if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents
  if (body.margin_cents !== undefined) patch.margin_cents = body.margin_cents
  if (body.product !== undefined) patch.product = body.product
  if (body.currency !== undefined) patch.currency = body.currency
  if (body.status !== undefined) patch.status = body.status
  if (body.external_id !== undefined) patch.external_id = body.external_id
  if (body.period_id !== undefined) {
    if (body.period_id) {
      const [p] = await db.select().from(periods).where(eq(periods.id, body.period_id))
      if (!p || p.workspace_id !== existing.workspace_id) return c.json({ error: 'Invalid period_id' }, 400)
    }
    patch.period_id = body.period_id
  }
  if (body.close_date !== undefined) {
    const d = toDateOrNull(body.close_date)
    if (!d) return c.json({ error: 'Invalid close_date' }, 400)
    patch.close_date = d
  }

  const [updated] = await db.update(deals).set(patch).where(eq(deals.id, id)).returning()
  return c.json(updated)
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id — auth — delete (cascades credits)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(deals).where(eq(deals.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(deal_credits).where(eq(deal_credits.deal_id, id))
  await db.delete(deals).where(eq(deals.id, id))
  return c.json({ success: true })
})

// ─────────────────────────────────────────────────────────────
// POST /bulk-import — auth — bulk create {workspace_id, deals[]}
// ─────────────────────────────────────────────────────────────
router.post('/bulk-import', authMiddleware, zValidator('json', bulkImportSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const values = []
  for (const d of body.deals) {
    const closeDate = toDateOrNull(d.close_date)
    if (!closeDate) return c.json({ error: `Invalid close_date for "${d.account_name}"` }, 400)
    values.push({
      workspace_id: body.workspace_id,
      account_name: d.account_name,
      amount_cents: d.amount_cents,
      margin_cents: d.margin_cents,
      product: d.product,
      close_date: closeDate,
      currency: d.currency,
      status: d.status,
      external_id: d.external_id ?? null,
      period_id: d.period_id ?? null,
    })
  }
  const inserted = await db.insert(deals).values(values).returning()
  return c.json({ created: inserted.length }, 201)
})

// ─────────────────────────────────────────────────────────────
// POST /:id/credits — auth — add credit assignment
// ─────────────────────────────────────────────────────────────
router.post('/:id/credits', authMiddleware, zValidator('json', creditSchema), async (c) => {
  const userId = getUserId(c)
  const dealId = c.req.param('id')
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId))
  if (!deal) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(deal.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [rep] = await db.select().from(reps).where(eq(reps.id, body.rep_id))
  if (!rep || rep.workspace_id !== deal.workspace_id) return c.json({ error: 'Invalid rep_id' }, 400)

  const [credit] = await db
    .insert(deal_credits)
    .values({ deal_id: dealId, rep_id: body.rep_id, role: body.role, split_pct: body.split_pct })
    .returning()
  return c.json(credit, 201)
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id/credits/:creditId — auth — remove credit
// ─────────────────────────────────────────────────────────────
router.delete('/:id/credits/:creditId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const dealId = c.req.param('id')
  const creditId = c.req.param('creditId')
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId))
  if (!deal) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(deal.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [credit] = await db.select().from(deal_credits).where(eq(deal_credits.id, creditId))
  if (!credit || credit.deal_id !== dealId) return c.json({ error: 'Not found' }, 404)

  await db.delete(deal_credits).where(eq(deal_credits.id, creditId))
  return c.json({ success: true })
})

export default router
