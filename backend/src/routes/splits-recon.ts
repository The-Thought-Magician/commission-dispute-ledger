import { Hono } from 'hono'
import { db } from '../db/index.js'
import { deals, deal_credits } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

// Floating-point tolerance for split-percentage sums (e.g. 33.33 * 3 = 99.99).
const SPLIT_EPSILON = 0.01

interface DealSplitRow {
  deal_id: string
  account_name: string
  period_id: string | null
  total: number
  credit_count: number
  ok: boolean
  classification: 'ok' | 'over' | 'under' | 'unassigned'
}

// ─────────────────────────────────────────────────────────────
// Build per-deal split integrity for a workspace (optionally one period).
// A deal is "ok" when its credit split_pct values sum to 100 (± epsilon).
// Deals with no credits at all are "unassigned" (treated as broken/under).
// ─────────────────────────────────────────────────────────────
async function buildSplitRows(workspaceId: string, periodId?: string): Promise<DealSplitRow[]> {
  const dealConditions = [eq(deals.workspace_id, workspaceId)]
  if (periodId) dealConditions.push(eq(deals.period_id, periodId))

  const dealRows = await db
    .select()
    .from(deals)
    .where(and(...dealConditions))

  const rows: DealSplitRow[] = []
  for (const deal of dealRows) {
    const credits = await db.select().from(deal_credits).where(eq(deal_credits.deal_id, deal.id))
    const total = credits.reduce((sum, cr) => sum + (cr.split_pct ?? 0), 0)
    const creditCount = credits.length

    let classification: DealSplitRow['classification']
    let ok: boolean
    if (creditCount === 0) {
      classification = 'unassigned'
      ok = false
    } else if (Math.abs(total - 100) <= SPLIT_EPSILON) {
      classification = 'ok'
      ok = true
    } else if (total > 100) {
      classification = 'over'
      ok = false
    } else {
      classification = 'under'
      ok = false
    }

    rows.push({
      deal_id: deal.id,
      account_name: deal.account_name,
      period_id: deal.period_id,
      total: Math.round(total * 100) / 100,
      credit_count: creditCount,
      ok,
      classification,
    })
  }
  return rows
}

// ─────────────────────────────────────────────────────────────
// GET / — public — per-deal split integrity for ?workspace_id=
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id') || undefined

  const rows = await buildSplitRows(workspaceId, periodId)
  return c.json({ deals: rows })
})

// ─────────────────────────────────────────────────────────────
// GET /summary — public — period roll-up of split integrity
//   ?workspace_id= (&period_id)
// ─────────────────────────────────────────────────────────────
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const periodId = c.req.query('period_id') || undefined

  const rows = await buildSplitRows(workspaceId, periodId)

  const checked = rows.length
  const broken = rows.filter((r) => !r.ok).length
  const over = rows.filter((r) => r.classification === 'over').length
  const under = rows.filter((r) => r.classification === 'under').length
  const unassigned = rows.filter((r) => r.classification === 'unassigned').length

  return c.json({ checked, broken, over, under, unassigned })
})

export default router
