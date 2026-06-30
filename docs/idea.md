# CommissionDisputeLedger — Feature Specification

## Overview

CommissionDisputeLedger is an independent audit and reconciliation layer for sales commission payouts. It re-derives, from raw closed-won deals and a versioned comp-plan model, exactly what every rep *should* have been paid, reconciles that expected payout line-by-line against what the commission run *actually* paid, and turns every discrepancy into a tracked dispute case backed by a transparent calculation trail.

The product is deliberately not a forward commission *calculator* (that is the incumbent's job). It is the second opinion: the shadow ledger RevOps already rebuilds by hand in spreadsheets every pay period, made systematic, auditable, and shareable. Every number on the screen can be expanded into the exact rule, rate, tier, accelerator, cap, and split that produced it.

All features are free for any signed-in user. Stripe billing is wired but optional (returns 503 when unconfigured); the `plans`/`subscriptions` tables exist so a paid tier can be switched on later without a migration.

## Problem

Variable comp disputes recur every single pay period. When a rep believes their check is wrong, RevOps cannot simply trust the commission tool that produced the check — they have to independently rebuild the math. Today that rebuild happens in throwaway spreadsheets:

- **Overpayments leak cash silently.** A miscoded deal, a missed clawback on a churned account, or a double-counted split quietly overpays reps month after month. Nobody reconciles backward, so the leak compounds.
- **Underpayments drive attrition.** A rep who is shorted on an accelerator or a tier crossover loses trust fast. By the time it is found, the rep is interviewing.
- **Disputes have no audit trail.** "Trust me, I recalculated it" does not survive an SOX audit, a finance review, or an angry rep. There is no system of record for *why* a payout was deemed correct or corrected.
- **Split credit never reconciles to 100%.** Multi-rep deals are where the money hides. Splits that sum to 95% or 110% are invisible until someone re-derives them.

The ROI is concrete: recovered overpayments (hard dollars) plus a defensible audit trail (risk reduction) plus reduced rep attrition (soft dollars).

## Target Users

- **Sales Compensation Analysts** who own variable-comp accuracy and personally field rep payout disputes every cycle.
- **RevOps managers** at 30–500-rep orgs who are accountable for comp correctness and influence comp-tooling budget.
- **Finance / FP&A partners** who need a clean reconciliation and accrual view of commission liability.
- **Sales managers** who triage rep complaints before escalating.

The economic buyer is the Sales Comp Analyst / RevOps manager who owns variable-comp accuracy and fields disputes every cycle.

## Why This Is NOT an Existing Project

This is an independent **audit / reconciliation / dispute-resolution** layer, not a comp calculator. Nearest neighbors:

- **commission-tracker (nearest corpus sibling)** — a *forward* comp calculator: it computes and pays commissions. CommissionDisputeLedger does the opposite job: it takes someone else's already-run payout and *re-derives an independent expected value* to catch where the calculator (or its inputs) was wrong. Different direction of data flow, different buyer (the auditor, not the operator).
- **usage-meter-trust-auditor (nearest base archetype)** — re-derives *usage-based billing* from raw events. Same "trust but verify by independent re-derivation" archetype, but an entirely different domain (metered SaaS billing vs. rep variable comp), different data model (usage events vs. closed-won deals + comp plans), and a different buyer.
- **interchange-leakage-auditor (nearest sibling in the set)** — re-derives card interchange costs. Same re-derive-and-reconcile archetype, completely different domain (payment card economics).
- **CaptivateIQ / Spiff / Everstage (commercial incumbents)** — these are the systems of record that *run* commissions. We are the adversarial checker that sits *next to* them and audits their output. We never replace the comp engine; we grade it.

The distinguishing core: (1) a **versioned comp-plan model** used purely as the re-derivation rulebook, (2) a **deterministic independent re-derivation engine**, (3) **line-by-line reconciliation** of expected vs. actually-paid, and (4) a **dispute case manager** that records the claim, the disputed deals, the calculation, and the resolution as a permanent audit record.

---

## Major Features

### 1. Workspaces & Membership
Every artifact (plans, reps, deals, runs, disputes) is scoped to a workspace. Users create workspaces, invite teammates by email-as-userid, and assign roles (owner, analyst, viewer). Ownership checks gate all writes.
- Create / rename / archive workspace
- Invite member, set role, remove member
- Per-workspace settings: currency, fiscal-year start month, default rounding mode
- Workspace switcher and "my workspaces" list

### 2. Comp Plan Modeler
Encode a complete commission plan as structured, versioned data: base rate, tiered rate schedules, accelerators (above-quota multipliers), caps (per-period and per-deal), split rules, draw/recoverable rules, and SPIFs. This is the rulebook the re-derivation engine executes — it is NOT used to pay anyone.
- Plan CRUD with name, description, effective date range, currency
- Plan **versioning**: every edit creates an immutable version; re-derivations pin to a version
- Rate components: flat rate, % of revenue, % of margin
- Quota assignment per rep per period
- Clone plan, compare two plan versions (diff view)

### 3. Rate Tiers & Accelerators
A plan has an ordered set of tiers keyed on attainment %, each with its own rate or multiplier; accelerators kick in above a threshold.
- Tier CRUD (lower bound, upper bound, rate, multiplier)
- Accelerator threshold + multiplier
- Per-period cap and per-deal cap
- Floor / draw guarantee
- Tier validation: no gaps, no overlaps, monotonic bounds

### 4. Split Rules
Define how credit on a deal is divided across reps/roles (e.g., AE 70%, SDR 20%, overlay 10%), and the policy when splits do not sum to 100%.
- Split rule CRUD (role, percentage)
- Default split template per plan
- Per-deal split override
- Policy: reject / normalize / flag when total ≠ 100%

### 5. Reps & Roster
The people whose comp is audited. Each rep maps to a plan, a quota, and a set of deals.
- Rep CRUD (name, email, role, hire date, territory)
- Assign rep to plan + quota per period
- Rep status (active, ramped, terminated) affecting draw recovery
- Rep tags / territory grouping

### 6. Deals (Closed-Won Source Data)
The raw input: closed-won deals with amount, close date, product, account, and credited reps. This is the ground truth the re-derivation reads.
- Deal CRUD (account, amount, margin, close date, product, currency)
- Deal credit assignments (rep + split %)
- Deal status flags: closed-won, refunded, churned, amended
- Bulk import deals (CSV/JSON paste)
- Deal de-duplication / external-id mapping

### 7. Independent Payout Re-Derivation Engine
The heart of the product. Given a comp-plan version, a roster, and a set of deals for a period, deterministically compute the *expected* payout per rep, fully decomposed into per-deal, per-component line items.
- Run a re-derivation for a period against a pinned plan version
- Deterministic, reproducible output (same inputs → same outputs)
- Full calculation breakdown: deal → split → tier → rate → accelerator → cap → line amount
- Handles attainment ramp across tiers within a period
- Stores the run as an immutable snapshot

### 8. Commission Run Import (Actuals)
Import what the commission tool actually paid, per rep per period, to reconcile against.
- Import an actual commission run (per-rep totals and/or per-deal line items)
- Map external rep ids to roster reps
- Multiple actuals versions per period (re-imports)
- Source label (CaptivateIQ, Spiff, manual, etc.)

### 9. Line-by-Line Reconciliation
Compare expected (re-derived) vs. actual (imported) at every level and surface every delta.
- Reconciliation per period: expected total, actual total, net delta
- Per-rep delta with drill-down to per-deal deltas
- Classify each delta: overpaid / underpaid / matched / unexplained
- Tolerance threshold (ignore sub-cent / sub-$X noise)
- Reconciliation status: open, reviewed, accepted

### 10. Dispute Case Manager
Turn any discrepancy into a tracked case: the claim, the disputed deals, the re-derived calculation, the conversation, and the resolution.
- Dispute CRUD (rep, period, claimed amount, narrative)
- Attach disputed deals + the relevant reconciliation rows
- Snapshot the calculation at case-open time
- Status workflow: open → investigating → resolved → closed (or rejected)
- Resolution record: agreed amount, adjustment created, rationale
- Comment thread per dispute
- Assignee + due date

### 11. Clawback & Adjustment Tracker
When a deal is refunded or an account churns, the commission already paid must be recovered; track these clawbacks and any manual adjustments.
- Clawback CRUD tied to a deal + rep + original payout
- Adjustment CRUD (manual credit/debit with reason)
- Link adjustment/clawback to a dispute resolution
- Net adjustment ledger per rep per period
- Status: pending, applied, waived

### 12. Split-Credit Reconciliation
Verify that every deal's split credit sums to 100% and that re-derived split payouts reconcile.
- Per-deal split-sum check (flag ≠ 100%)
- Per-period roll-up of split-credit integrity
- Over/under-allocation report
- Suggested normalization

### 13. Comp-Cost-of-Error Report
Quantify the financial impact of all detected errors: total overpaid (recoverable), total underpaid (owed), error rate, trend over periods.
- Cost-of-error summary per period and rolling
- Breakdown by error type (tier, split, clawback, accelerator, data)
- Recoverable-overpayment total (the headline ROI number)
- Underpayment exposure total
- Per-rep and per-plan error attribution

### 14. Sample-Data Seeder
One-click generation of a realistic plan + roster + deals + an intentionally-flawed commission run, so the product is demoable with zero setup and the reconciliation lights up immediately.
- Seed a complete demo workspace (plan, tiers, splits, reps, deals, actuals)
- Inject configurable error scenarios (overpay, underpay, bad split, missed clawback)
- Reset / regenerate

### 15. Periods & Fiscal Calendar
Comp is reconciled per period; define the calendar.
- Period CRUD (monthly / quarterly), fiscal-year aware
- Lock a period (freeze re-derivations and actuals)
- Period status (open, locked, closed)
- Carry-forward of draw balances across periods

### 16. Quota & Attainment Tracking
Track quota and attainment, which drive tier crossing and accelerators.
- Quota per rep per period
- Attainment % = credited bookings / quota
- Attainment timeline within a period
- Cross-rep attainment leaderboard (audit context)

### 17. Audit Trail & Calculation Explainer
Every number is explainable; every change is logged.
- Immutable audit log of every write (who, what, when, before/after)
- "Explain this number" drill-down on any payout line
- Re-derivation provenance: plan version + inputs hash
- Export the full calculation trail for a dispute

### 18. Notifications & Alerts
Proactively surface what needs attention.
- Per-user notification feed (new dispute assigned, reconciliation finished, large delta detected)
- Mark read / unread
- Threshold alerts (delta > $X, error rate > Y%)

### 19. Reporting & Exports
Shareable outputs for finance and reps.
- Reconciliation report (CSV/JSON export)
- Dispute resolution report
- Cost-of-error report export
- Per-rep payout statement (expected vs. actual)
- Accrual / liability summary for finance

### 20. Saved Views & Filters
Analysts triage large datasets fast.
- Saved filters on deals, reconciliations, disputes
- Quick filters: overpaid-only, unresolved disputes, split-broken deals
- Sort & paginate large lists

### 21. Dashboard & Health Summary
A single home screen: open disputes, net delta this period, recoverable overpayment, split-integrity score, recent activity.
- KPI cards (net delta, recoverable, open disputes, error rate)
- Recent reconciliations and disputes
- Trend sparkline of error rate over periods

### 22. Settings & Billing
Workspace and account settings plus the optional Stripe billing surface.
- Workspace settings (currency, fiscal start, rounding, tolerance defaults)
- Billing plan view (free / pro), checkout & portal (503 when Stripe unconfigured)
- Profile / sign-out

---

## Data Model (Tables)

- `workspaces` — tenant root (name, owner, currency, fiscal_start_month, rounding_mode, default_tolerance_cents)
- `workspace_members` — user_id, workspace_id, role
- `comp_plans` — plan header (workspace, name, description, currency, effective_start, effective_end)
- `comp_plan_versions` — immutable versioned snapshot of a plan's config (jsonb), version_number
- `rate_tiers` — plan_version, lower_bound, upper_bound, rate, multiplier, sort_order
- `accelerators` — plan_version, threshold_attainment, multiplier, per_period_cap_cents, per_deal_cap_cents
- `split_rules` — plan_version, role, percentage, is_default
- `reps` — workspace, name, email, role, territory, status, hire_date
- `rep_plan_assignments` — rep, comp_plan, period, quota_cents
- `periods` — workspace, label, kind, start_date, end_date, status (open/locked/closed)
- `deals` — workspace, account_name, amount_cents, margin_cents, product, close_date, currency, status, external_id
- `deal_credits` — deal, rep, role, split_pct
- `derivation_runs` — workspace, period, plan_version, status, inputs_hash, expected_total_cents
- `derivation_lines` — run, rep, deal, component, tier_applied, rate_applied, multiplier_applied, amount_cents (the decomposed breakdown)
- `actual_runs` — workspace, period, source_label, actual_total_cents
- `actual_lines` — actual_run, rep, deal (nullable), amount_cents
- `reconciliations` — workspace, period, derivation_run, actual_run, expected_total_cents, actual_total_cents, net_delta_cents, status
- `reconciliation_lines` — reconciliation, rep, deal (nullable), expected_cents, actual_cents, delta_cents, classification (overpaid/underpaid/matched/unexplained)
- `disputes` — workspace, rep, period, claimed_amount_cents, narrative, status, assignee, due_date, resolution_amount_cents, resolution_note, calc_snapshot (jsonb)
- `dispute_deals` — dispute, deal (the disputed deals)
- `dispute_comments` — dispute, author, body
- `clawbacks` — workspace, deal, rep, original_payout_cents, amount_cents, reason, status
- `adjustments` — workspace, rep, period, amount_cents, direction (credit/debit), reason, status, dispute (nullable)
- `notifications` — user_id, workspace, kind, title, body, read
- `audit_logs` — workspace, actor, entity_type, entity_id, action, before (jsonb), after (jsonb)
- `saved_views` — user_id, workspace, name, resource, filter (jsonb)
- `plans` — billing plan catalog (id, name, price_cents)
- `subscriptions` — user_id, plan_id, stripe ids, status, current_period_end

---

## API Surface (mounted under `/api/v1`)

- `workspaces` — workspace CRUD, members, settings
- `comp-plans` — plan CRUD, versions, compare, clone
- `tiers` — rate tiers + accelerators per plan version
- `split-rules` — split rule CRUD + integrity policy
- `reps` — roster CRUD + plan/quota assignment
- `periods` — period CRUD, lock/close, draw carry-forward
- `deals` — deal CRUD, credits, bulk import
- `derivations` — run re-derivation, fetch run + decomposed lines, explain
- `actuals` — import actual commission runs + lines
- `reconciliations` — run/fetch reconciliation + per-line deltas, set status
- `disputes` — dispute CRUD, status workflow, resolve, deals, comments
- `clawbacks` — clawback CRUD + status
- `adjustments` — adjustment CRUD + status
- `splits-recon` — split-credit integrity checks & roll-ups
- `cost-of-error` — cost-of-error reports
- `quota` — quota & attainment tracking
- `audit` — audit log feed + explain-number
- `notifications` — feed, mark read
- `reports` — exports (recon, dispute, cost-of-error, statements, accruals)
- `views` — saved views CRUD
- `dashboard` — KPI summary
- `seed` — sample-data seeder
- `billing` — plan view, checkout, portal, webhook
- `stats` — aggregate statistics

---

## Frontend Pages (~24)

Public:
1. `/` — landing (static marketing)
2. `/auth/sign-in` — sign in
3. `/auth/sign-up` — sign up
4. `/pricing` — pricing (static + checkout CTA)

Dashboard (under `/dashboard`, sidebar chrome):
5. `/dashboard` — home KPI summary
6. `/dashboard/workspaces` — workspace list / create / switch
7. `/dashboard/workspaces/[id]` — workspace settings & members
8. `/dashboard/plans` — comp plan list
9. `/dashboard/plans/[id]` — plan detail, versions, tiers, accelerators, splits
10. `/dashboard/plans/[id]/compare` — version diff
11. `/dashboard/reps` — roster list + assignments
12. `/dashboard/reps/[id]` — rep detail (quota, deals, payout)
13. `/dashboard/deals` — deals list + bulk import
14. `/dashboard/deals/[id]` — deal detail + credits
15. `/dashboard/periods` — period list, lock/close
16. `/dashboard/derivations` — re-derivation runs list + new run
17. `/dashboard/derivations/[id]` — run detail with decomposed calculation breakdown
18. `/dashboard/actuals` — imported commission runs
19. `/dashboard/reconciliations` — reconciliation list + run new
20. `/dashboard/reconciliations/[id]` — line-by-line delta detail
21. `/dashboard/disputes` — dispute case list
22. `/dashboard/disputes/[id]` — dispute detail (calc snapshot, deals, comments, resolve)
23. `/dashboard/clawbacks` — clawbacks & adjustments tracker
24. `/dashboard/splits` — split-credit reconciliation
25. `/dashboard/cost-of-error` — cost-of-error report
26. `/dashboard/notifications` — notification feed
27. `/dashboard/reports` — exports hub
28. `/dashboard/settings` — settings + billing
