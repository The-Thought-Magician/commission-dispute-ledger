import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  // ── Workspaces & membership ──
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    fiscal_start_month integer NOT NULL DEFAULT 1,
    rounding_mode text NOT NULL DEFAULT 'half_up',
    default_tolerance_cents integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'analyst',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  // ── Comp plans & versions ──
  `CREATE TABLE IF NOT EXISTS comp_plans (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    currency text NOT NULL DEFAULT 'USD',
    effective_start timestamptz,
    effective_end timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS comp_plan_versions (
    id text PRIMARY KEY,
    comp_plan_id text NOT NULL REFERENCES comp_plans(id),
    version_number integer NOT NULL,
    base_rate real NOT NULL DEFAULT 0,
    rate_basis text NOT NULL DEFAULT 'revenue',
    config jsonb DEFAULT '{}'::jsonb,
    notes text NOT NULL DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (comp_plan_id, version_number)
  )`,
  `CREATE TABLE IF NOT EXISTS rate_tiers (
    id text PRIMARY KEY,
    plan_version_id text NOT NULL REFERENCES comp_plan_versions(id),
    lower_bound real NOT NULL DEFAULT 0,
    upper_bound real,
    rate real NOT NULL DEFAULT 0,
    multiplier real NOT NULL DEFAULT 1,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS accelerators (
    id text PRIMARY KEY,
    plan_version_id text NOT NULL REFERENCES comp_plan_versions(id),
    threshold_attainment real NOT NULL DEFAULT 1,
    multiplier real NOT NULL DEFAULT 1,
    per_period_cap_cents integer,
    per_deal_cap_cents integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS split_rules (
    id text PRIMARY KEY,
    plan_version_id text NOT NULL REFERENCES comp_plan_versions(id),
    role text NOT NULL,
    percentage real NOT NULL DEFAULT 0,
    is_default boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Reps, periods, quota ──
  `CREATE TABLE IF NOT EXISTS reps (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    email text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'AE',
    territory text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'active',
    hire_date timestamptz,
    tags jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS periods (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    label text NOT NULL,
    kind text NOT NULL DEFAULT 'monthly',
    start_date timestamptz NOT NULL,
    end_date timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS rep_plan_assignments (
    id text PRIMARY KEY,
    rep_id text NOT NULL REFERENCES reps(id),
    comp_plan_id text NOT NULL REFERENCES comp_plans(id),
    period_id text NOT NULL REFERENCES periods(id),
    quota_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rep_id, period_id)
  )`,

  // ── Deals & credits ──
  `CREATE TABLE IF NOT EXISTS deals (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    account_name text NOT NULL,
    amount_cents integer NOT NULL DEFAULT 0,
    margin_cents integer NOT NULL DEFAULT 0,
    product text NOT NULL DEFAULT '',
    close_date timestamptz NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    status text NOT NULL DEFAULT 'closed_won',
    external_id text,
    period_id text REFERENCES periods(id),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS deal_credits (
    id text PRIMARY KEY,
    deal_id text NOT NULL REFERENCES deals(id),
    rep_id text NOT NULL REFERENCES reps(id),
    role text NOT NULL DEFAULT 'AE',
    split_pct real NOT NULL DEFAULT 100,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Re-derivation ──
  `CREATE TABLE IF NOT EXISTS derivation_runs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    period_id text NOT NULL REFERENCES periods(id),
    plan_version_id text NOT NULL REFERENCES comp_plan_versions(id),
    status text NOT NULL DEFAULT 'completed',
    inputs_hash text NOT NULL DEFAULT '',
    expected_total_cents integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS derivation_lines (
    id text PRIMARY KEY,
    run_id text NOT NULL REFERENCES derivation_runs(id),
    rep_id text NOT NULL REFERENCES reps(id),
    deal_id text REFERENCES deals(id),
    component text NOT NULL DEFAULT 'base',
    split_pct real NOT NULL DEFAULT 100,
    tier_applied text,
    rate_applied real NOT NULL DEFAULT 0,
    multiplier_applied real NOT NULL DEFAULT 1,
    amount_cents integer NOT NULL DEFAULT 0,
    explain jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Actuals ──
  `CREATE TABLE IF NOT EXISTS actual_runs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    period_id text NOT NULL REFERENCES periods(id),
    source_label text NOT NULL DEFAULT 'manual',
    actual_total_cents integer NOT NULL DEFAULT 0,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS actual_lines (
    id text PRIMARY KEY,
    actual_run_id text NOT NULL REFERENCES actual_runs(id),
    rep_id text NOT NULL REFERENCES reps(id),
    deal_id text REFERENCES deals(id),
    amount_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Reconciliation ──
  `CREATE TABLE IF NOT EXISTS reconciliations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    period_id text NOT NULL REFERENCES periods(id),
    derivation_run_id text NOT NULL REFERENCES derivation_runs(id),
    actual_run_id text NOT NULL REFERENCES actual_runs(id),
    expected_total_cents integer NOT NULL DEFAULT 0,
    actual_total_cents integer NOT NULL DEFAULT 0,
    net_delta_cents integer NOT NULL DEFAULT 0,
    tolerance_cents integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'open',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS reconciliation_lines (
    id text PRIMARY KEY,
    reconciliation_id text NOT NULL REFERENCES reconciliations(id),
    rep_id text NOT NULL REFERENCES reps(id),
    deal_id text REFERENCES deals(id),
    expected_cents integer NOT NULL DEFAULT 0,
    actual_cents integer NOT NULL DEFAULT 0,
    delta_cents integer NOT NULL DEFAULT 0,
    classification text NOT NULL DEFAULT 'matched',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Disputes ──
  `CREATE TABLE IF NOT EXISTS disputes (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    rep_id text NOT NULL REFERENCES reps(id),
    period_id text REFERENCES periods(id),
    claimed_amount_cents integer NOT NULL DEFAULT 0,
    narrative text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open',
    assignee text,
    due_date timestamptz,
    resolution_amount_cents integer,
    resolution_note text,
    calc_snapshot jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS dispute_deals (
    id text PRIMARY KEY,
    dispute_id text NOT NULL REFERENCES disputes(id),
    deal_id text NOT NULL REFERENCES deals(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (dispute_id, deal_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dispute_comments (
    id text PRIMARY KEY,
    dispute_id text NOT NULL REFERENCES disputes(id),
    author text NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Clawbacks & adjustments ──
  `CREATE TABLE IF NOT EXISTS clawbacks (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    deal_id text NOT NULL REFERENCES deals(id),
    rep_id text NOT NULL REFERENCES reps(id),
    original_payout_cents integer NOT NULL DEFAULT 0,
    amount_cents integer NOT NULL DEFAULT 0,
    reason text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS adjustments (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    rep_id text NOT NULL REFERENCES reps(id),
    period_id text REFERENCES periods(id),
    amount_cents integer NOT NULL DEFAULT 0,
    direction text NOT NULL DEFAULT 'credit',
    reason text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending',
    dispute_id text REFERENCES disputes(id),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Notifications, audit, saved views ──
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text REFERENCES workspaces(id),
    kind text NOT NULL DEFAULT 'info',
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    actor text NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action text NOT NULL,
    before jsonb DEFAULT '{}'::jsonb,
    after jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS saved_views (
    id text PRIMARY KEY,
    user_id text NOT NULL,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    resource text NOT NULL,
    filter jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Billing ──
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL DEFAULT 'free' REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
]

const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comp_plans_workspace ON comp_plans(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_comp_plan_versions_plan ON comp_plan_versions(comp_plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rate_tiers_version ON rate_tiers(plan_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_accelerators_version ON accelerators(plan_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_split_rules_version ON split_rules(plan_version_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reps_workspace ON reps(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_periods_workspace ON periods(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rep_plan_assignments_rep ON rep_plan_assignments(rep_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rep_plan_assignments_period ON rep_plan_assignments(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deals_workspace ON deals(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deals_period ON deals(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deal_credits_deal ON deal_credits(deal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deal_credits_rep ON deal_credits(rep_id)`,
  `CREATE INDEX IF NOT EXISTS idx_derivation_runs_workspace ON derivation_runs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_derivation_runs_period ON derivation_runs(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_derivation_lines_run ON derivation_lines(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_derivation_lines_rep ON derivation_lines(rep_id)`,
  `CREATE INDEX IF NOT EXISTS idx_actual_runs_workspace ON actual_runs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_actual_runs_period ON actual_runs(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_actual_lines_run ON actual_lines(actual_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_workspace ON reconciliations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_period ON reconciliations(period_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_lines_recon ON reconciliation_lines(reconciliation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_disputes_workspace ON disputes(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_disputes_rep ON disputes(rep_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dispute_deals_dispute ON dispute_deals(dispute_id)`,
  `CREATE INDEX IF NOT EXISTS idx_dispute_comments_dispute ON dispute_comments(dispute_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clawbacks_workspace ON clawbacks(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_clawbacks_deal ON clawbacks(deal_id)`,
  `CREATE INDEX IF NOT EXISTS idx_adjustments_workspace ON adjustments(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_adjustments_rep ON adjustments(rep_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_user ON saved_views(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_saved_views_workspace ON saved_views(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  for (const idx of indexes) {
    await db.execute(sql.raw(idx))
  }
  console.log('Migration complete')
}
