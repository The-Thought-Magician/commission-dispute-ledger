import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  actual_runs,
  actual_lines,
  workspaces,
  workspace_members,
  periods,
  reps,
  deals,
} from '../db/schema.js'
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

const importSchema = z.object({
  workspace_id: z.string().min(1),
  period_id: z.string().min(1),
  source_label: z.string().optional().default('manual'),
  lines: z
    .array(
      z.object({
        rep_id: z.string().min(1),
        deal_id: z.string().optional().nullable(),
        amount_cents: z.number().int(),
      }),
    )
    .min(1),
})

// ─────────────────────────────────────────────────────────────
// GET / — public — actual runs for ?workspace_id= (&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id')

  const conditions = [eq(actual_runs.workspace_id, workspaceId)]
  if (periodId) conditions.push(eq(actual_runs.period_id, periodId))

  const rows = await db
    .select()
    .from(actual_runs)
    .where(and(...conditions))
    .orderBy(desc(actual_runs.created_at))
  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// POST / — auth — import actual run {workspace_id, period_id, source_label, lines[]}
// ─────────────────────────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', importSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [period] = await db.select().from(periods).where(eq(periods.id, body.period_id))
  if (!period || period.workspace_id !== body.workspace_id) return c.json({ error: 'Invalid period_id' }, 400)

  // Validate every line references reps/deals in this workspace.
  for (const ln of body.lines) {
    const [rep] = await db.select().from(reps).where(eq(reps.id, ln.rep_id))
    if (!rep || rep.workspace_id !== body.workspace_id) {
      return c.json({ error: `Invalid rep_id: ${ln.rep_id}` }, 400)
    }
    if (ln.deal_id) {
      const [deal] = await db.select().from(deals).where(eq(deals.id, ln.deal_id))
      if (!deal || deal.workspace_id !== body.workspace_id) {
        return c.json({ error: `Invalid deal_id: ${ln.deal_id}` }, 400)
      }
    }
  }

  const actualTotal = body.lines.reduce((sum, ln) => sum + ln.amount_cents, 0)

  const [run] = await db
    .insert(actual_runs)
    .values({
      workspace_id: body.workspace_id,
      period_id: body.period_id,
      source_label: body.source_label,
      actual_total_cents: actualTotal,
      created_by: userId,
    })
    .returning()

  const lineValues = body.lines.map((ln) => ({
    actual_run_id: run.id,
    rep_id: ln.rep_id,
    deal_id: ln.deal_id ?? null,
    amount_cents: ln.amount_cents,
  }))
  const insertedLines = await db.insert(actual_lines).values(lineValues).returning()

  return c.json({ ...run, lines: insertedLines }, 201)
})

// ─────────────────────────────────────────────────────────────
// GET /:id — public — run + lines
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(actual_runs).where(eq(actual_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const lines = await db
    .select()
    .from(actual_lines)
    .where(eq(actual_lines.actual_run_id, id))
    .orderBy(desc(actual_lines.amount_cents))
  return c.json({ run, lines })
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id — auth — delete (cascades lines)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [run] = await db.select().from(actual_runs).where(eq(actual_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(run.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(actual_lines).where(eq(actual_lines.actual_run_id, id))
  await db.delete(actual_runs).where(eq(actual_runs.id, id))
  return c.json({ success: true })
})

export default router
