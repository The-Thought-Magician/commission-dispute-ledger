# CommissionDisputeLedger — Authoritative Build Contract

> This is the single source of truth. Every filename, mount path, api method name, and page file here is binding. Backend mounts every domain router under `/api/v1` via a child Hono `api` router. Frontend calls go through `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`. Backend trusts `X-User-Id` and uses `getUserId(c)` everywhere. Public reads / auth-gated writes with zod + ownership checks. Schema is in `backend/src/db/schema.ts`; DDL self-provisions via `backend/src/db/migrate.ts`.

---

## (a) Tables (columns)

- **workspaces** — id, name, owner_id, currency, fiscal_start_month, rounding_mode, default_tolerance_cents, created_at, updated_at
- **workspace_members** — id, workspace_id→workspaces, user_id, role, created_at; UNIQUE(workspace_id,user_id)
- **comp_plans** — id, workspace_id→workspaces, name, description, currency, effective_start, effective_end, created_by, created_at, updated_at
- **comp_plan_versions** — id, comp_plan_id→comp_plans, version_number, base_rate, rate_basis, config(jsonb), notes, created_by, created_at; UNIQUE(comp_plan_id,version_number)
- **rate_tiers** — id, plan_version_id→comp_plan_versions, lower_bound, upper_bound, rate, multiplier, sort_order, created_at
- **accelerators** — id, plan_version_id→comp_plan_versions, threshold_attainment, multiplier, per_period_cap_cents, per_deal_cap_cents, created_at
- **split_rules** — id, plan_version_id→comp_plan_versions, role, percentage, is_default, created_at
- **reps** — id, workspace_id→workspaces, name, email, role, territory, status, hire_date, tags(jsonb), created_at
- **periods** — id, workspace_id→workspaces, label, kind, start_date, end_date, status, created_at
- **rep_plan_assignments** — id, rep_id→reps, comp_plan_id→comp_plans, period_id→periods, quota_cents, created_at; UNIQUE(rep_id,period_id)
- **deals** — id, workspace_id→workspaces, account_name, amount_cents, margin_cents, product, close_date, currency, status, external_id, period_id→periods, created_at
- **deal_credits** — id, deal_id→deals, rep_id→reps, role, split_pct, created_at
- **derivation_runs** — id, workspace_id→workspaces, period_id→periods, plan_version_id→comp_plan_versions, status, inputs_hash, expected_total_cents, created_by, created_at
- **derivation_lines** — id, run_id→derivation_runs, rep_id→reps, deal_id→deals, component, split_pct, tier_applied, rate_applied, multiplier_applied, amount_cents, explain(jsonb), created_at
- **actual_runs** — id, workspace_id→workspaces, period_id→periods, source_label, actual_total_cents, created_by, created_at
- **actual_lines** — id, actual_run_id→actual_runs, rep_id→reps, deal_id→deals, amount_cents, created_at
- **reconciliations** — id, workspace_id→workspaces, period_id→periods, derivation_run_id→derivation_runs, actual_run_id→actual_runs, expected_total_cents, actual_total_cents, net_delta_cents, tolerance_cents, status, created_by, created_at
- **reconciliation_lines** — id, reconciliation_id→reconciliations, rep_id→reps, deal_id→deals, expected_cents, actual_cents, delta_cents, classification, created_at
- **disputes** — id, workspace_id→workspaces, rep_id→reps, period_id→periods, claimed_amount_cents, narrative, status, assignee, due_date, resolution_amount_cents, resolution_note, calc_snapshot(jsonb), created_by, created_at, updated_at
- **dispute_deals** — id, dispute_id→disputes, deal_id→deals, created_at; UNIQUE(dispute_id,deal_id)
- **dispute_comments** — id, dispute_id→disputes, author, body, created_at
- **clawbacks** — id, workspace_id→workspaces, deal_id→deals, rep_id→reps, original_payout_cents, amount_cents, reason, status, created_by, created_at
- **adjustments** — id, workspace_id→workspaces, rep_id→reps, period_id→periods, amount_cents, direction, reason, status, dispute_id→disputes, created_by, created_at
- **notifications** — id, user_id, workspace_id→workspaces, kind, title, body, read, created_at
- **audit_logs** — id, workspace_id→workspaces, actor, entity_type, entity_id, action, before(jsonb), after(jsonb), created_at
- **saved_views** — id, user_id, workspace_id→workspaces, name, resource, filter(jsonb), created_at
- **plans** — id(text PK, seeded 'free'/'pro'), name, price_cents, created_at
- **subscriptions** — id, user_id(unique), plan_id→plans, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at

---

## (b) Backend route files (mounted under `/api/v1`)

### `workspaces.ts` → `/workspaces`
- GET `/` — auth — list caller's workspaces (member-of) — `Workspace[]`
- POST `/` — auth — create workspace (+owner member row) — `Workspace`
- GET `/:id` — auth — workspace detail (member check) — `Workspace`
- PUT `/:id` — auth — update settings (owner) — `Workspace`
- DELETE `/:id` — auth — archive (owner) — `{success}`
- GET `/:id/members` — auth — list members — `Member[]`
- POST `/:id/members` — auth — invite member {user_id,role} (owner) — `Member`
- DELETE `/:id/members/:memberId` — auth — remove member (owner) — `{success}`

### `comp-plans.ts` → `/comp-plans`
- GET `/` — public — list plans (by workspace_id query) — `Plan[]`
- POST `/` — auth — create plan (+v1) — `Plan`
- GET `/:id` — public — plan detail + versions — `PlanDetail`
- PUT `/:id` — auth — update header (owner) — `Plan`
- DELETE `/:id` — auth — delete (owner) — `{success}`
- POST `/:id/versions` — auth — new immutable version — `PlanVersion`
- GET `/:id/versions` — public — list versions — `PlanVersion[]`
- POST `/:id/clone` — auth — clone plan + latest version — `Plan`
- GET `/:id/compare` — public — diff two versions (?a=&b=) — `{a,b,diff}`

### `tiers.ts` → `/tiers`
- GET `/` — public — tiers + accelerators for ?plan_version_id= — `{tiers,accelerators}`
- POST `/` — auth — create tier — `Tier`
- PUT `/:id` — auth — update tier — `Tier`
- DELETE `/:id` — auth — delete tier — `{success}`
- POST `/accelerators` — auth — create accelerator — `Accelerator`
- PUT `/accelerators/:id` — auth — update accelerator — `Accelerator`
- DELETE `/accelerators/:id` — auth — delete accelerator — `{success}`
- GET `/validate` — public — tier integrity (gaps/overlaps) for ?plan_version_id= — `{valid,issues[]}`

### `split-rules.ts` → `/split-rules`
- GET `/` — public — split rules for ?plan_version_id= — `SplitRule[]`
- POST `/` — auth — create split rule — `SplitRule`
- PUT `/:id` — auth — update — `SplitRule`
- DELETE `/:id` — auth — delete — `{success}`
- GET `/check` — public — sum-to-100 policy check for ?plan_version_id= — `{total,ok,policy}`

### `reps.ts` → `/reps`
- GET `/` — public — roster for ?workspace_id= — `Rep[]`
- POST `/` — auth — create rep — `Rep`
- GET `/:id` — public — rep detail — `Rep`
- PUT `/:id` — auth — update — `Rep`
- DELETE `/:id` — auth — delete — `{success}`
- POST `/:id/assignments` — auth — assign plan+quota for period — `Assignment`
- GET `/:id/assignments` — public — assignments list — `Assignment[]`

### `periods.ts` → `/periods`
- GET `/` — public — periods for ?workspace_id= — `Period[]`
- POST `/` — auth — create period — `Period`
- GET `/:id` — public — period detail — `Period`
- PUT `/:id` — auth — update — `Period`
- POST `/:id/lock` — auth — lock period — `Period`
- POST `/:id/close` — auth — close period — `Period`

### `deals.ts` → `/deals`
- GET `/` — public — deals for ?workspace_id= (&period_id, &status) — `Deal[]`
- POST `/` — auth — create deal — `Deal`
- GET `/:id` — public — deal + credits — `DealDetail`
- PUT `/:id` — auth — update — `Deal`
- DELETE `/:id` — auth — delete — `{success}`
- POST `/bulk-import` — auth — bulk create {workspace_id,deals[]} — `{created:number}`
- POST `/:id/credits` — auth — add credit assignment — `DealCredit`
- DELETE `/:id/credits/:creditId` — auth — remove credit — `{success}`

### `derivations.ts` → `/derivations`
- GET `/` — public — runs for ?workspace_id= — `DerivationRun[]`
- POST `/` — auth — run re-derivation {workspace_id,period_id,plan_version_id} — `DerivationRun`
- GET `/:id` — public — run + decomposed lines — `{run,lines}`
- GET `/:id/explain/:lineId` — public — full explain of one line — `{line,explain}`
- DELETE `/:id` — auth — delete run — `{success}`

### `actuals.ts` → `/actuals`
- GET `/` — public — actual runs for ?workspace_id= — `ActualRun[]`
- POST `/` — auth — import actual run {workspace_id,period_id,source_label,lines[]} — `ActualRun`
- GET `/:id` — public — run + lines — `{run,lines}`
- DELETE `/:id` — auth — delete — `{success}`

### `reconciliations.ts` → `/reconciliations`
- GET `/` — public — reconciliations for ?workspace_id= — `Reconciliation[]`
- POST `/` — auth — run reconciliation {workspace_id,period_id,derivation_run_id,actual_run_id} — `Reconciliation`
- GET `/:id` — public — reconciliation + per-line deltas — `{recon,lines}`
- PUT `/:id/status` — auth — set status (open/reviewed/accepted) — `Reconciliation`
- DELETE `/:id` — auth — delete — `{success}`

### `disputes.ts` → `/disputes`
- GET `/` — public — disputes for ?workspace_id= (&status) — `Dispute[]`
- POST `/` — auth — create dispute — `Dispute`
- GET `/:id` — public — dispute + deals + comments — `DisputeDetail`
- PUT `/:id` — auth — update fields/status/assignee — `Dispute`
- POST `/:id/resolve` — auth — resolve {resolution_amount_cents,resolution_note,create_adjustment?} — `Dispute`
- DELETE `/:id` — auth — delete — `{success}`
- POST `/:id/deals` — auth — attach disputed deal {deal_id} — `DisputeDeal`
- DELETE `/:id/deals/:dealId` — auth — detach — `{success}`
- POST `/:id/comments` — auth — add comment {body} — `DisputeComment`
- GET `/:id/comments` — public — comment thread — `DisputeComment[]`

### `clawbacks.ts` → `/clawbacks`
- GET `/` — public — clawbacks for ?workspace_id= — `Clawback[]`
- POST `/` — auth — create clawback — `Clawback`
- PUT `/:id` — auth — update / set status (pending/applied/waived) — `Clawback`
- DELETE `/:id` — auth — delete — `{success}`

### `adjustments.ts` → `/adjustments`
- GET `/` — public — adjustments for ?workspace_id= (&rep_id) — `Adjustment[]`
- POST `/` — auth — create adjustment — `Adjustment`
- PUT `/:id` — auth — update / set status — `Adjustment`
- DELETE `/:id` — auth — delete — `{success}`

### `splits-recon.ts` → `/splits-recon`
- GET `/` — public — per-deal split integrity for ?workspace_id= — `{deals:[{deal_id,total,ok}]}`
- GET `/summary` — public — period roll-up of split integrity ?workspace_id=(&period_id) — `{checked,broken,over,under}`

### `cost-of-error.ts` → `/cost-of-error`
- GET `/` — public — cost-of-error for ?workspace_id= (&period_id) — `{overpaid,underpaid,error_rate,by_type}`
- GET `/trend` — public — error-rate trend across periods ?workspace_id= — `{points:[{period,error_rate,net_delta}]}`

### `quota.ts` → `/quota`
- GET `/` — public — quota+attainment for ?workspace_id= (&period_id) — `{rows:[{rep_id,quota_cents,attainment_pct}]}`
- GET `/leaderboard` — public — attainment leaderboard ?workspace_id=(&period_id) — `LeaderRow[]`

### `audit.ts` → `/audit`
- GET `/` — public — audit log feed for ?workspace_id= (paginated) — `{logs,total}`
- GET `/explain` — public — explain a payout number ?run_id=&line_id= — `{explain}`

### `notifications.ts` → `/notifications`
- GET `/` — auth — caller's notifications — `Notification[]`
- POST `/:id/read` — auth — mark read — `{success}`
- POST `/read-all` — auth — mark all read — `{success}`

### `reports.ts` → `/reports`
- GET `/reconciliation` — public — recon export ?reconciliation_id= — `{rows}`
- GET `/dispute` — public — dispute resolution report ?dispute_id= — `{report}`
- GET `/cost-of-error` — public — cost-of-error export ?workspace_id=(&period_id) — `{rows}`
- GET `/statement` — public — per-rep expected-vs-actual statement ?workspace_id=&rep_id=&period_id= — `{statement}`
- GET `/accrual` — public — finance accrual/liability summary ?workspace_id=(&period_id) — `{accrual}`

### `views.ts` → `/views`
- GET `/` — auth — caller's saved views for ?workspace_id= (&resource) — `SavedView[]`
- POST `/` — auth — create saved view — `SavedView`
- PUT `/:id` — auth — update — `SavedView`
- DELETE `/:id` — auth — delete — `{success}`

### `dashboard.ts` → `/dashboard`
- GET `/` — public — KPI summary for ?workspace_id= — `{net_delta,recoverable,open_disputes,error_rate,recent}`

### `seed.ts` → `/seed`
- POST `/` — auth — seed a complete demo workspace {with_errors?} — `{workspace_id}`
- POST `/reset` — auth — reset/regenerate demo for {workspace_id} — `{workspace_id}`

### `billing.ts` → `/billing`
- GET `/plan` — public (reads x-user-id) — subscription + plan + stripeEnabled — `{subscription,plan,stripeEnabled}`
- POST `/checkout` — public — Stripe checkout (503 if unconfigured) — `{url}`
- POST `/portal` — public — Stripe portal (503 if unconfigured) — `{url}`
- POST `/webhook` — public — Stripe webhook (503 if unconfigured) — `{received}`

### `stats.ts` → `/stats`
- GET `/` — public — aggregate stats for ?workspace_id= — `{deals,reps,disputes,runs,reconciliations}`

---

## (c) `web/lib/api.ts` method list

| Method | Path | Verb |
|--------|------|------|
| listWorkspaces | `/api/proxy/workspaces` | GET |
| createWorkspace | `/api/proxy/workspaces` | POST |
| getWorkspace | `/api/proxy/workspaces/:id` | GET |
| updateWorkspace | `/api/proxy/workspaces/:id` | PUT |
| archiveWorkspace | `/api/proxy/workspaces/:id` | DELETE |
| listMembers | `/api/proxy/workspaces/:id/members` | GET |
| inviteMember | `/api/proxy/workspaces/:id/members` | POST |
| removeMember | `/api/proxy/workspaces/:id/members/:memberId` | DELETE |
| listPlans | `/api/proxy/comp-plans?workspace_id=` | GET |
| createPlan | `/api/proxy/comp-plans` | POST |
| getPlan | `/api/proxy/comp-plans/:id` | GET |
| updatePlan | `/api/proxy/comp-plans/:id` | PUT |
| deletePlan | `/api/proxy/comp-plans/:id` | DELETE |
| createPlanVersion | `/api/proxy/comp-plans/:id/versions` | POST |
| listPlanVersions | `/api/proxy/comp-plans/:id/versions` | GET |
| clonePlan | `/api/proxy/comp-plans/:id/clone` | POST |
| comparePlanVersions | `/api/proxy/comp-plans/:id/compare?a=&b=` | GET |
| listTiers | `/api/proxy/tiers?plan_version_id=` | GET |
| createTier | `/api/proxy/tiers` | POST |
| updateTier | `/api/proxy/tiers/:id` | PUT |
| deleteTier | `/api/proxy/tiers/:id` | DELETE |
| createAccelerator | `/api/proxy/tiers/accelerators` | POST |
| updateAccelerator | `/api/proxy/tiers/accelerators/:id` | PUT |
| deleteAccelerator | `/api/proxy/tiers/accelerators/:id` | DELETE |
| validateTiers | `/api/proxy/tiers/validate?plan_version_id=` | GET |
| listSplitRules | `/api/proxy/split-rules?plan_version_id=` | GET |
| createSplitRule | `/api/proxy/split-rules` | POST |
| updateSplitRule | `/api/proxy/split-rules/:id` | PUT |
| deleteSplitRule | `/api/proxy/split-rules/:id` | DELETE |
| checkSplitRules | `/api/proxy/split-rules/check?plan_version_id=` | GET |
| listReps | `/api/proxy/reps?workspace_id=` | GET |
| createRep | `/api/proxy/reps` | POST |
| getRep | `/api/proxy/reps/:id` | GET |
| updateRep | `/api/proxy/reps/:id` | PUT |
| deleteRep | `/api/proxy/reps/:id` | DELETE |
| assignRepPlan | `/api/proxy/reps/:id/assignments` | POST |
| listRepAssignments | `/api/proxy/reps/:id/assignments` | GET |
| listPeriods | `/api/proxy/periods?workspace_id=` | GET |
| createPeriod | `/api/proxy/periods` | POST |
| getPeriod | `/api/proxy/periods/:id` | GET |
| updatePeriod | `/api/proxy/periods/:id` | PUT |
| lockPeriod | `/api/proxy/periods/:id/lock` | POST |
| closePeriod | `/api/proxy/periods/:id/close` | POST |
| listDeals | `/api/proxy/deals?workspace_id=` | GET |
| createDeal | `/api/proxy/deals` | POST |
| getDeal | `/api/proxy/deals/:id` | GET |
| updateDeal | `/api/proxy/deals/:id` | PUT |
| deleteDeal | `/api/proxy/deals/:id` | DELETE |
| bulkImportDeals | `/api/proxy/deals/bulk-import` | POST |
| addDealCredit | `/api/proxy/deals/:id/credits` | POST |
| removeDealCredit | `/api/proxy/deals/:id/credits/:creditId` | DELETE |
| listDerivations | `/api/proxy/derivations?workspace_id=` | GET |
| runDerivation | `/api/proxy/derivations` | POST |
| getDerivation | `/api/proxy/derivations/:id` | GET |
| explainDerivationLine | `/api/proxy/derivations/:id/explain/:lineId` | GET |
| deleteDerivation | `/api/proxy/derivations/:id` | DELETE |
| listActuals | `/api/proxy/actuals?workspace_id=` | GET |
| importActual | `/api/proxy/actuals` | POST |
| getActual | `/api/proxy/actuals/:id` | GET |
| deleteActual | `/api/proxy/actuals/:id` | DELETE |
| listReconciliations | `/api/proxy/reconciliations?workspace_id=` | GET |
| runReconciliation | `/api/proxy/reconciliations` | POST |
| getReconciliation | `/api/proxy/reconciliations/:id` | GET |
| setReconciliationStatus | `/api/proxy/reconciliations/:id/status` | PUT |
| deleteReconciliation | `/api/proxy/reconciliations/:id` | DELETE |
| listDisputes | `/api/proxy/disputes?workspace_id=` | GET |
| createDispute | `/api/proxy/disputes` | POST |
| getDispute | `/api/proxy/disputes/:id` | GET |
| updateDispute | `/api/proxy/disputes/:id` | PUT |
| resolveDispute | `/api/proxy/disputes/:id/resolve` | POST |
| deleteDispute | `/api/proxy/disputes/:id` | DELETE |
| attachDisputeDeal | `/api/proxy/disputes/:id/deals` | POST |
| detachDisputeDeal | `/api/proxy/disputes/:id/deals/:dealId` | DELETE |
| addDisputeComment | `/api/proxy/disputes/:id/comments` | POST |
| listDisputeComments | `/api/proxy/disputes/:id/comments` | GET |
| listClawbacks | `/api/proxy/clawbacks?workspace_id=` | GET |
| createClawback | `/api/proxy/clawbacks` | POST |
| updateClawback | `/api/proxy/clawbacks/:id` | PUT |
| deleteClawback | `/api/proxy/clawbacks/:id` | DELETE |
| listAdjustments | `/api/proxy/adjustments?workspace_id=` | GET |
| createAdjustment | `/api/proxy/adjustments` | POST |
| updateAdjustment | `/api/proxy/adjustments/:id` | PUT |
| deleteAdjustment | `/api/proxy/adjustments/:id` | DELETE |
| listSplitIntegrity | `/api/proxy/splits-recon?workspace_id=` | GET |
| getSplitIntegritySummary | `/api/proxy/splits-recon/summary?workspace_id=` | GET |
| getCostOfError | `/api/proxy/cost-of-error?workspace_id=` | GET |
| getCostOfErrorTrend | `/api/proxy/cost-of-error/trend?workspace_id=` | GET |
| getQuota | `/api/proxy/quota?workspace_id=` | GET |
| getQuotaLeaderboard | `/api/proxy/quota/leaderboard?workspace_id=` | GET |
| listAuditLogs | `/api/proxy/audit?workspace_id=` | GET |
| explainNumber | `/api/proxy/audit/explain?run_id=&line_id=` | GET |
| listNotifications | `/api/proxy/notifications` | GET |
| markNotificationRead | `/api/proxy/notifications/:id/read` | POST |
| markAllNotificationsRead | `/api/proxy/notifications/read-all` | POST |
| reportReconciliation | `/api/proxy/reports/reconciliation?reconciliation_id=` | GET |
| reportDispute | `/api/proxy/reports/dispute?dispute_id=` | GET |
| reportCostOfError | `/api/proxy/reports/cost-of-error?workspace_id=` | GET |
| reportStatement | `/api/proxy/reports/statement?workspace_id=&rep_id=&period_id=` | GET |
| reportAccrual | `/api/proxy/reports/accrual?workspace_id=` | GET |
| listViews | `/api/proxy/views?workspace_id=` | GET |
| createView | `/api/proxy/views` | POST |
| updateView | `/api/proxy/views/:id` | PUT |
| deleteView | `/api/proxy/views/:id` | DELETE |
| getDashboard | `/api/proxy/dashboard?workspace_id=` | GET |
| seedDemo | `/api/proxy/seed` | POST |
| resetDemo | `/api/proxy/seed/reset` | POST |
| getBillingPlan | `/api/proxy/billing/plan` | GET |
| startCheckout | `/api/proxy/billing/checkout` | POST |
| openBillingPortal | `/api/proxy/billing/portal` | POST |
| getStats | `/api/proxy/stats?workspace_id=` | GET |

---

## (d) Pages

| URL path | File (under web/) | Kind | API methods used | Renders |
|----------|-------------------|------|------------------|---------|
| `/` | `app/page.tsx` | public | (none) | Static landing: hero, feature grid, CTAs |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | Sign-in form |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | Sign-up form |
| `/pricing` | `app/pricing/page.tsx` | public | getBillingPlan, startCheckout | Plan cards + checkout CTA |
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | getDashboard, listWorkspaces, getCostOfError | KPI cards, recent activity, trend |
| `/dashboard/workspaces` | `app/dashboard/workspaces/page.tsx` | dashboard | listWorkspaces, createWorkspace, seedDemo | Workspace list / create / switch / seed demo |
| `/dashboard/workspaces/[id]` | `app/dashboard/workspaces/[id]/page.tsx` | dashboard | getWorkspace, updateWorkspace, listMembers, inviteMember, removeMember, archiveWorkspace | Settings + members |
| `/dashboard/plans` | `app/dashboard/plans/page.tsx` | dashboard | listPlans, createPlan, clonePlan, deletePlan | Comp plan list |
| `/dashboard/plans/[id]` | `app/dashboard/plans/[id]/page.tsx` | dashboard | getPlan, updatePlan, listPlanVersions, createPlanVersion, listTiers, createTier, updateTier, deleteTier, createAccelerator, updateAccelerator, deleteAccelerator, validateTiers, listSplitRules, createSplitRule, updateSplitRule, deleteSplitRule, checkSplitRules | Plan detail: versions, tiers, accelerators, splits |
| `/dashboard/plans/[id]/compare` | `app/dashboard/plans/[id]/compare/page.tsx` | dashboard | listPlanVersions, comparePlanVersions | Version diff |
| `/dashboard/reps` | `app/dashboard/reps/page.tsx` | dashboard | listReps, createRep, deleteRep | Roster list |
| `/dashboard/reps/[id]` | `app/dashboard/reps/[id]/page.tsx` | dashboard | getRep, updateRep, assignRepPlan, listRepAssignments, listPlans, listPeriods | Rep detail, quota, assignments |
| `/dashboard/deals` | `app/dashboard/deals/page.tsx` | dashboard | listDeals, createDeal, deleteDeal, bulkImportDeals, listPeriods | Deals list + bulk import |
| `/dashboard/deals/[id]` | `app/dashboard/deals/[id]/page.tsx` | dashboard | getDeal, updateDeal, addDealCredit, removeDealCredit, listReps | Deal detail + credits |
| `/dashboard/periods` | `app/dashboard/periods/page.tsx` | dashboard | listPeriods, createPeriod, updatePeriod, lockPeriod, closePeriod | Period list, lock/close |
| `/dashboard/derivations` | `app/dashboard/derivations/page.tsx` | dashboard | listDerivations, runDerivation, deleteDerivation, listPeriods, listPlans, listPlanVersions | Re-derivation runs + new run |
| `/dashboard/derivations/[id]` | `app/dashboard/derivations/[id]/page.tsx` | dashboard | getDerivation, explainDerivationLine | Decomposed calculation breakdown |
| `/dashboard/actuals` | `app/dashboard/actuals/page.tsx` | dashboard | listActuals, importActual, getActual, deleteActual, listPeriods, listReps | Imported commission runs |
| `/dashboard/reconciliations` | `app/dashboard/reconciliations/page.tsx` | dashboard | listReconciliations, runReconciliation, deleteReconciliation, listDerivations, listActuals, listPeriods | Reconciliation list + run new |
| `/dashboard/reconciliations/[id]` | `app/dashboard/reconciliations/[id]/page.tsx` | dashboard | getReconciliation, setReconciliationStatus, reportReconciliation | Line-by-line delta detail |
| `/dashboard/disputes` | `app/dashboard/disputes/page.tsx` | dashboard | listDisputes, createDispute, listReps, listPeriods | Dispute case list |
| `/dashboard/disputes/[id]` | `app/dashboard/disputes/[id]/page.tsx` | dashboard | getDispute, updateDispute, resolveDispute, attachDisputeDeal, detachDisputeDeal, addDisputeComment, listDisputeComments, listDeals, reportDispute | Dispute detail: snapshot, deals, comments, resolve |
| `/dashboard/clawbacks` | `app/dashboard/clawbacks/page.tsx` | dashboard | listClawbacks, createClawback, updateClawback, deleteClawback, listAdjustments, createAdjustment, updateAdjustment, deleteAdjustment, listDeals, listReps | Clawbacks & adjustments tracker |
| `/dashboard/splits` | `app/dashboard/splits/page.tsx` | dashboard | listSplitIntegrity, getSplitIntegritySummary | Split-credit reconciliation |
| `/dashboard/cost-of-error` | `app/dashboard/cost-of-error/page.tsx` | dashboard | getCostOfError, getCostOfErrorTrend, getQuota, getQuotaLeaderboard, reportCostOfError | Cost-of-error report + quota/attainment |
| `/dashboard/notifications` | `app/dashboard/notifications/page.tsx` | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead | Notification feed |
| `/dashboard/reports` | `app/dashboard/reports/page.tsx` | dashboard | reportReconciliation, reportDispute, reportCostOfError, reportStatement, reportAccrual, listReps, listPeriods, listReconciliations, listDisputes, listAuditLogs, explainNumber | Exports hub + audit log feed |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | getBillingPlan, startCheckout, openBillingPortal, getStats, getWorkspace, updateWorkspace, listViews, createView, deleteView | Settings + billing + saved views |

---

## (e) DashboardLayout sidebar nav sections

`web/components/DashboardLayout.tsx` (client, `usePathname()` active state, mobile drawer). Sections:

- **Overview**
  - Dashboard → `/dashboard`
  - Workspaces → `/dashboard/workspaces`
- **Comp Model**
  - Plans → `/dashboard/plans`
  - Reps → `/dashboard/reps`
  - Periods → `/dashboard/periods`
- **Source Data**
  - Deals → `/dashboard/deals`
  - Actuals → `/dashboard/actuals`
- **Audit & Reconcile**
  - Derivations → `/dashboard/derivations`
  - Reconciliations → `/dashboard/reconciliations`
  - Splits → `/dashboard/splits`
  - Cost of Error → `/dashboard/cost-of-error`
- **Resolution**
  - Disputes → `/dashboard/disputes`
  - Clawbacks → `/dashboard/clawbacks`
- **Workspace**
  - Reports → `/dashboard/reports`
  - Notifications → `/dashboard/notifications`
  - Settings → `/dashboard/settings`

> Detail pages (`/dashboard/plans/[id]`, `/dashboard/plans/[id]/compare`, `/dashboard/reps/[id]`, `/dashboard/deals/[id]`, `/dashboard/derivations/[id]`, `/dashboard/reconciliations/[id]`, `/dashboard/disputes/[id]`, `/dashboard/workspaces/[id]`) are reached by drill-down, not top-level nav.

### Consistency invariants
- 25 backend route files; every `api.ts` method maps to exactly one endpoint; every endpoint is consumed by at least one page.
- 28 page files (4 public + 24 dashboard incl. detail pages).
- Backend `index.ts` runs `migrate()` then `seedIfEmpty()` (seeds `plans`: 'free' $0, 'pro' $4900) before `serve()`.
