import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  reconciliations,
  reconciliation_lines,
  derivation_runs,
  derivation_lines,
  actual_runs,
  actual_lines,
  workspaces,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const runSchema = z.object({
  workspace_id: z.string().min(1),
  period_id: z.string().min(1),
  derivation_run_id: z.string().min(1),
  actual_run_id: z.string().min(1),
  tolerance_cents: z.number().int().nonnegative().optional(),
})

const statusSchema = z.object({
  status: z.enum(['open', 'reviewed', 'accepted']),
})

function classify(expected: number, actual: number, tolerance: number): string {
  const delta = actual - expected
  if (Math.abs(delta) <= tolerance) return 'matched'
  if (delta > 0) return 'overpaid'
  return 'underpaid'
}

// GET / — public — reconciliations for ?workspace_id=
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
    .orderBy(desc(reconciliations.created_at))
  return c.json(rows)
})

// POST / — auth — run reconciliation
router.post('/', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const [drun] = await db
    .select()
    .from(derivation_runs)
    .where(
      and(
        eq(derivation_runs.id, body.derivation_run_id),
        eq(derivation_runs.workspace_id, body.workspace_id),
      ),
    )
  if (!drun) return c.json({ error: 'Derivation run not found' }, 404)

  const [arun] = await db
    .select()
    .from(actual_runs)
    .where(
      and(
        eq(actual_runs.id, body.actual_run_id),
        eq(actual_runs.workspace_id, body.workspace_id),
      ),
    )
  if (!arun) return c.json({ error: 'Actual run not found' }, 404)

  const tolerance = body.tolerance_cents ?? ws.default_tolerance_cents ?? 1

  // Aggregate expected from derivation lines, actual from actual lines, keyed by rep+deal.
  const dlines = await db
    .select()
    .from(derivation_lines)
    .where(eq(derivation_lines.run_id, body.derivation_run_id))
  const alines = await db
    .select()
    .from(actual_lines)
    .where(eq(actual_lines.actual_run_id, body.actual_run_id))

  const key = (repId: string, dealId: string | null) => `${repId}::${dealId ?? ''}`
  type Bucket = { rep_id: string; deal_id: string | null; expected: number; actual: number }
  const buckets = new Map<string, Bucket>()

  for (const dl of dlines) {
    const k = key(dl.rep_id, dl.deal_id ?? null)
    const b = buckets.get(k) ?? { rep_id: dl.rep_id, deal_id: dl.deal_id ?? null, expected: 0, actual: 0 }
    b.expected += dl.amount_cents
    buckets.set(k, b)
  }
  for (const al of alines) {
    const k = key(al.rep_id, al.deal_id ?? null)
    const b = buckets.get(k) ?? { rep_id: al.rep_id, deal_id: al.deal_id ?? null, expected: 0, actual: 0 }
    b.actual += al.amount_cents
    buckets.set(k, b)
  }

  const expectedTotal = drun.expected_total_cents
  const actualTotal = arun.actual_total_cents
  const netDelta = actualTotal - expectedTotal

  const [recon] = await db
    .insert(reconciliations)
    .values({
      workspace_id: body.workspace_id,
      period_id: body.period_id,
      derivation_run_id: body.derivation_run_id,
      actual_run_id: body.actual_run_id,
      expected_total_cents: expectedTotal,
      actual_total_cents: actualTotal,
      net_delta_cents: netDelta,
      tolerance_cents: tolerance,
      status: 'open',
      created_by: userId,
    })
    .returning()

  const lineValues = Array.from(buckets.values()).map((b) => ({
    reconciliation_id: recon.id,
    rep_id: b.rep_id,
    deal_id: b.deal_id,
    expected_cents: b.expected,
    actual_cents: b.actual,
    delta_cents: b.actual - b.expected,
    classification: classify(b.expected, b.actual, tolerance),
  }))

  if (lineValues.length > 0) {
    await db.insert(reconciliation_lines).values(lineValues)
  }

  return c.json(recon, 201)
})

// GET /:id — public — reconciliation + per-line deltas
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [recon] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!recon) return c.json({ error: 'Not found' }, 404)
  const lines = await db
    .select()
    .from(reconciliation_lines)
    .where(eq(reconciliation_lines.reconciliation_id, id))
    .orderBy(desc(reconciliation_lines.delta_cents))
  return c.json({ recon, lines })
})

// PUT /:id/status — auth — set status
router.put('/:id/status', authMiddleware, zValidator('json', statusSchema), async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  const member = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, existing.workspace_id))
  if (member.length === 0) return c.json({ error: 'Workspace not found' }, 404)
  const [updated] = await db
    .update(reconciliations)
    .set({ status: body.status })
    .where(eq(reconciliations.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete (and its lines)
router.delete('/:id', authMiddleware, async (c) => {
  getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  await db.delete(reconciliation_lines).where(eq(reconciliation_lines.reconciliation_id, id))
  await db.delete(reconciliations).where(eq(reconciliations.id, id))
  return c.json({ success: true })
})

export default router
