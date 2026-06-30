import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ─────────────────────────────────────────────────────────────
// Workspaces & membership
// ─────────────────────────────────────────────────────────────
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  currency: text('currency').notNull().default('USD'),
  fiscal_start_month: integer('fiscal_start_month').notNull().default(1),
  rounding_mode: text('rounding_mode').notNull().default('half_up'),
  default_tolerance_cents: integer('default_tolerance_cents').notNull().default(1),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').notNull().default('analyst'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

// ─────────────────────────────────────────────────────────────
// Comp plans & versioned config
// ─────────────────────────────────────────────────────────────
export const comp_plans = pgTable('comp_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  currency: text('currency').notNull().default('USD'),
  effective_start: timestamp('effective_start'),
  effective_end: timestamp('effective_end'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const comp_plan_versions = pgTable('comp_plan_versions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  comp_plan_id: text('comp_plan_id').notNull().references(() => comp_plans.id),
  version_number: integer('version_number').notNull(),
  base_rate: real('base_rate').notNull().default(0),
  rate_basis: text('rate_basis').notNull().default('revenue'),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  notes: text('notes').notNull().default(''),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.comp_plan_id, t.version_number)])

export const rate_tiers = pgTable('rate_tiers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  plan_version_id: text('plan_version_id').notNull().references(() => comp_plan_versions.id),
  lower_bound: real('lower_bound').notNull().default(0),
  upper_bound: real('upper_bound'),
  rate: real('rate').notNull().default(0),
  multiplier: real('multiplier').notNull().default(1),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const accelerators = pgTable('accelerators', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  plan_version_id: text('plan_version_id').notNull().references(() => comp_plan_versions.id),
  threshold_attainment: real('threshold_attainment').notNull().default(1),
  multiplier: real('multiplier').notNull().default(1),
  per_period_cap_cents: integer('per_period_cap_cents'),
  per_deal_cap_cents: integer('per_deal_cap_cents'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const split_rules = pgTable('split_rules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  plan_version_id: text('plan_version_id').notNull().references(() => comp_plan_versions.id),
  role: text('role').notNull(),
  percentage: real('percentage').notNull().default(0),
  is_default: boolean('is_default').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Reps, periods, quota
// ─────────────────────────────────────────────────────────────
export const reps = pgTable('reps', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  email: text('email').notNull().default(''),
  role: text('role').notNull().default('AE'),
  territory: text('territory').notNull().default(''),
  status: text('status').notNull().default('active'),
  hire_date: timestamp('hire_date'),
  tags: jsonb('tags').$type<string[]>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const periods = pgTable('periods', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  label: text('label').notNull(),
  kind: text('kind').notNull().default('monthly'),
  start_date: timestamp('start_date').notNull(),
  end_date: timestamp('end_date').notNull(),
  status: text('status').notNull().default('open'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const rep_plan_assignments = pgTable('rep_plan_assignments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  comp_plan_id: text('comp_plan_id').notNull().references(() => comp_plans.id),
  period_id: text('period_id').notNull().references(() => periods.id),
  quota_cents: integer('quota_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.rep_id, t.period_id)])

// ─────────────────────────────────────────────────────────────
// Deals (source data) & credit assignments
// ─────────────────────────────────────────────────────────────
export const deals = pgTable('deals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  account_name: text('account_name').notNull(),
  amount_cents: integer('amount_cents').notNull().default(0),
  margin_cents: integer('margin_cents').notNull().default(0),
  product: text('product').notNull().default(''),
  close_date: timestamp('close_date').notNull(),
  currency: text('currency').notNull().default('USD'),
  status: text('status').notNull().default('closed_won'),
  external_id: text('external_id'),
  period_id: text('period_id').references(() => periods.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const deal_credits = pgTable('deal_credits', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  deal_id: text('deal_id').notNull().references(() => deals.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  role: text('role').notNull().default('AE'),
  split_pct: real('split_pct').notNull().default(100),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Independent re-derivation
// ─────────────────────────────────────────────────────────────
export const derivation_runs = pgTable('derivation_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  period_id: text('period_id').notNull().references(() => periods.id),
  plan_version_id: text('plan_version_id').notNull().references(() => comp_plan_versions.id),
  status: text('status').notNull().default('completed'),
  inputs_hash: text('inputs_hash').notNull().default(''),
  expected_total_cents: integer('expected_total_cents').notNull().default(0),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const derivation_lines = pgTable('derivation_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  run_id: text('run_id').notNull().references(() => derivation_runs.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  deal_id: text('deal_id').references(() => deals.id),
  component: text('component').notNull().default('base'),
  split_pct: real('split_pct').notNull().default(100),
  tier_applied: text('tier_applied'),
  rate_applied: real('rate_applied').notNull().default(0),
  multiplier_applied: real('multiplier_applied').notNull().default(1),
  amount_cents: integer('amount_cents').notNull().default(0),
  explain: jsonb('explain').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Actuals (imported commission run)
// ─────────────────────────────────────────────────────────────
export const actual_runs = pgTable('actual_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  period_id: text('period_id').notNull().references(() => periods.id),
  source_label: text('source_label').notNull().default('manual'),
  actual_total_cents: integer('actual_total_cents').notNull().default(0),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const actual_lines = pgTable('actual_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  actual_run_id: text('actual_run_id').notNull().references(() => actual_runs.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  deal_id: text('deal_id').references(() => deals.id),
  amount_cents: integer('amount_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────────────────
export const reconciliations = pgTable('reconciliations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  period_id: text('period_id').notNull().references(() => periods.id),
  derivation_run_id: text('derivation_run_id').notNull().references(() => derivation_runs.id),
  actual_run_id: text('actual_run_id').notNull().references(() => actual_runs.id),
  expected_total_cents: integer('expected_total_cents').notNull().default(0),
  actual_total_cents: integer('actual_total_cents').notNull().default(0),
  net_delta_cents: integer('net_delta_cents').notNull().default(0),
  tolerance_cents: integer('tolerance_cents').notNull().default(1),
  status: text('status').notNull().default('open'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reconciliation_lines = pgTable('reconciliation_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  reconciliation_id: text('reconciliation_id').notNull().references(() => reconciliations.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  deal_id: text('deal_id').references(() => deals.id),
  expected_cents: integer('expected_cents').notNull().default(0),
  actual_cents: integer('actual_cents').notNull().default(0),
  delta_cents: integer('delta_cents').notNull().default(0),
  classification: text('classification').notNull().default('matched'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Disputes
// ─────────────────────────────────────────────────────────────
export const disputes = pgTable('disputes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  period_id: text('period_id').references(() => periods.id),
  claimed_amount_cents: integer('claimed_amount_cents').notNull().default(0),
  narrative: text('narrative').notNull().default(''),
  status: text('status').notNull().default('open'),
  assignee: text('assignee'),
  due_date: timestamp('due_date'),
  resolution_amount_cents: integer('resolution_amount_cents'),
  resolution_note: text('resolution_note'),
  calc_snapshot: jsonb('calc_snapshot').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const dispute_deals = pgTable('dispute_deals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dispute_id: text('dispute_id').notNull().references(() => disputes.id),
  deal_id: text('deal_id').notNull().references(() => deals.id),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.dispute_id, t.deal_id)])

export const dispute_comments = pgTable('dispute_comments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dispute_id: text('dispute_id').notNull().references(() => disputes.id),
  author: text('author').notNull(),
  body: text('body').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Clawbacks & adjustments
// ─────────────────────────────────────────────────────────────
export const clawbacks = pgTable('clawbacks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  deal_id: text('deal_id').notNull().references(() => deals.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  original_payout_cents: integer('original_payout_cents').notNull().default(0),
  amount_cents: integer('amount_cents').notNull().default(0),
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('pending'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const adjustments = pgTable('adjustments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  rep_id: text('rep_id').notNull().references(() => reps.id),
  period_id: text('period_id').references(() => periods.id),
  amount_cents: integer('amount_cents').notNull().default(0),
  direction: text('direction').notNull().default('credit'),
  reason: text('reason').notNull().default(''),
  status: text('status').notNull().default('pending'),
  dispute_id: text('dispute_id').references(() => disputes.id),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Notifications, audit, saved views
// ─────────────────────────────────────────────────────────────
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  kind: text('kind').notNull().default('info'),
  title: text('title').notNull(),
  body: text('body').notNull().default(''),
  read: boolean('read').notNull().default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const audit_logs = pgTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  actor: text('actor').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id').notNull(),
  action: text('action').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>().default({}),
  after: jsonb('after').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const saved_views = pgTable('saved_views', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull(),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  resource: text('resource').notNull(),
  filter: jsonb('filter').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Billing
// ─────────────────────────────────────────────────────────────
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').notNull().default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().default('free').references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').notNull().default('active'),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
