import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  audit_logs,
  derivation_runs,
  derivation_lines,
  reps,
  deals,
  periods,
  comp_plan_versions,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// GET / — audit log feed for ?workspace_id= (paginated)
// query: workspace_id (required), limit, offset, entity_type, action
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limit = Math.min(Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(c.req.query('offset') ?? '0', 10) || 0, 0)
  const entityType = c.req.query('entity_type')
  const action = c.req.query('action')

  const conds = [eq(audit_logs.workspace_id, workspaceId)]
  if (entityType) conds.push(eq(audit_logs.entity_type, entityType))
  if (action) conds.push(eq(audit_logs.action, action))

  const all = await db
    .select()
    .from(audit_logs)
    .where(and(...conds))
    .orderBy(desc(audit_logs.created_at))

  const total = all.length
  const logs = all.slice(offset, offset + limit)

  return c.json({ logs, total, limit, offset })
})

// ─────────────────────────────────────────────────────────────
// GET /explain — explain a payout number ?run_id=&line_id=
// Full provenance: the derivation line, its rep/deal/period/plan-version
// context, and the engine's stored `explain` breakdown.
// ─────────────────────────────────────────────────────────────
router.get('/explain', async (c) => {
  const runId = c.req.query('run_id')
  const lineId = c.req.query('line_id')
  if (!runId || !lineId) {
    return c.json({ error: 'run_id and line_id are required' }, 400)
  }

  const [line] = await db
    .select()
    .from(derivation_lines)
    .where(and(eq(derivation_lines.id, lineId), eq(derivation_lines.run_id, runId)))
  if (!line) return c.json({ error: 'Derivation line not found' }, 404)

  const [run] = await db.select().from(derivation_runs).where(eq(derivation_runs.id, runId))
  if (!run) return c.json({ error: 'Derivation run not found' }, 404)

  const [rep] = await db.select().from(reps).where(eq(reps.id, line.rep_id))
  const [period] = await db.select().from(periods).where(eq(periods.id, run.period_id))
  const [planVersion] = await db
    .select()
    .from(comp_plan_versions)
    .where(eq(comp_plan_versions.id, run.plan_version_id))

  let deal = null
  if (line.deal_id) {
    const [d] = await db.select().from(deals).where(eq(deals.id, line.deal_id))
    deal = d ?? null
  }

  // Human-readable derivation: rate_applied over the deal basis, scaled
  // by split_pct and any accelerator multiplier, yielding amount_cents.
  const basisCents = deal
    ? planVersion?.rate_basis === 'margin'
      ? deal.margin_cents
      : deal.amount_cents
    : null

  const explain = {
    summary: {
      rep_id: line.rep_id,
      rep_name: rep?.name ?? null,
      deal_id: line.deal_id,
      account_name: deal?.account_name ?? null,
      component: line.component,
      amount_cents: line.amount_cents,
    },
    inputs: {
      basis: planVersion?.rate_basis ?? 'revenue',
      basis_cents: basisCents,
      rate_applied: line.rate_applied,
      tier_applied: line.tier_applied,
      split_pct: line.split_pct,
      multiplier_applied: line.multiplier_applied,
    },
    calculation: {
      formula:
        'amount_cents = round(basis_cents * rate_applied * (split_pct / 100) * multiplier_applied)',
      basis_cents: basisCents,
      rate_applied: line.rate_applied,
      split_factor: (line.split_pct ?? 100) / 100,
      multiplier_applied: line.multiplier_applied,
      result_cents: line.amount_cents,
    },
    engine_explain: line.explain ?? {},
    context: {
      run: {
        id: run.id,
        status: run.status,
        inputs_hash: run.inputs_hash,
        expected_total_cents: run.expected_total_cents,
        created_at: run.created_at,
      },
      period: period
        ? { id: period.id, label: period.label, status: period.status }
        : null,
      plan_version: planVersion
        ? {
            id: planVersion.id,
            version_number: planVersion.version_number,
            base_rate: planVersion.base_rate,
            rate_basis: planVersion.rate_basis,
          }
        : null,
    },
  }

  return c.json({ explain })
})

export default router
