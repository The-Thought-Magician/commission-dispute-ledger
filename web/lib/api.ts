// All calls are same-origin relative to /api/proxy/<path>, mapping 1:1 to backend /api/v1/<path>.
// The proxy route injects X-User-Id after resolving the Neon Auth session.

async function req(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(message)
  }
  return data
}

const get = (path: string) => req(path)
const post = (path: string, body?: unknown) =>
  req(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const put = (path: string, body?: unknown) =>
  req(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) })
const del = (path: string) => req(path, { method: 'DELETE' })

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  createWorkspace: (body: unknown) => post('workspaces', body),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  updateWorkspace: (id: string, body: unknown) => put(`workspaces/${id}`, body),
  archiveWorkspace: (id: string) => del(`workspaces/${id}`),
  listMembers: (id: string) => get(`workspaces/${id}/members`),
  inviteMember: (id: string, body: unknown) => post(`workspaces/${id}/members`, body),
  removeMember: (id: string, memberId: string) => del(`workspaces/${id}/members/${memberId}`),

  // Comp plans
  listPlans: (workspace_id: string) => get(`comp-plans${qs({ workspace_id })}`),
  createPlan: (body: unknown) => post('comp-plans', body),
  getPlan: (id: string) => get(`comp-plans/${id}`),
  updatePlan: (id: string, body: unknown) => put(`comp-plans/${id}`, body),
  deletePlan: (id: string) => del(`comp-plans/${id}`),
  createPlanVersion: (id: string, body: unknown) => post(`comp-plans/${id}/versions`, body),
  listPlanVersions: (id: string) => get(`comp-plans/${id}/versions`),
  clonePlan: (id: string, body?: unknown) => post(`comp-plans/${id}/clone`, body),
  comparePlanVersions: (id: string, a: string, b: string) =>
    get(`comp-plans/${id}/compare${qs({ a, b })}`),

  // Tiers & accelerators
  listTiers: (plan_version_id: string) => get(`tiers${qs({ plan_version_id })}`),
  createTier: (body: unknown) => post('tiers', body),
  updateTier: (id: string, body: unknown) => put(`tiers/${id}`, body),
  deleteTier: (id: string) => del(`tiers/${id}`),
  createAccelerator: (body: unknown) => post('tiers/accelerators', body),
  updateAccelerator: (id: string, body: unknown) => put(`tiers/accelerators/${id}`, body),
  deleteAccelerator: (id: string) => del(`tiers/accelerators/${id}`),
  validateTiers: (plan_version_id: string) => get(`tiers/validate${qs({ plan_version_id })}`),

  // Split rules
  listSplitRules: (plan_version_id: string) => get(`split-rules${qs({ plan_version_id })}`),
  createSplitRule: (body: unknown) => post('split-rules', body),
  updateSplitRule: (id: string, body: unknown) => put(`split-rules/${id}`, body),
  deleteSplitRule: (id: string) => del(`split-rules/${id}`),
  checkSplitRules: (plan_version_id: string) => get(`split-rules/check${qs({ plan_version_id })}`),

  // Reps
  listReps: (workspace_id: string) => get(`reps${qs({ workspace_id })}`),
  createRep: (body: unknown) => post('reps', body),
  getRep: (id: string) => get(`reps/${id}`),
  updateRep: (id: string, body: unknown) => put(`reps/${id}`, body),
  deleteRep: (id: string) => del(`reps/${id}`),
  assignRepPlan: (id: string, body: unknown) => post(`reps/${id}/assignments`, body),
  listRepAssignments: (id: string) => get(`reps/${id}/assignments`),

  // Periods
  listPeriods: (workspace_id: string) => get(`periods${qs({ workspace_id })}`),
  createPeriod: (body: unknown) => post('periods', body),
  getPeriod: (id: string) => get(`periods/${id}`),
  updatePeriod: (id: string, body: unknown) => put(`periods/${id}`, body),
  lockPeriod: (id: string, body?: unknown) => post(`periods/${id}/lock`, body),
  closePeriod: (id: string, body?: unknown) => post(`periods/${id}/close`, body),

  // Deals
  listDeals: (workspace_id: string, opts?: { period_id?: string; status?: string }) =>
    get(`deals${qs({ workspace_id, period_id: opts?.period_id, status: opts?.status })}`),
  createDeal: (body: unknown) => post('deals', body),
  getDeal: (id: string) => get(`deals/${id}`),
  updateDeal: (id: string, body: unknown) => put(`deals/${id}`, body),
  deleteDeal: (id: string) => del(`deals/${id}`),
  bulkImportDeals: (body: unknown) => post('deals/bulk-import', body),
  addDealCredit: (id: string, body: unknown) => post(`deals/${id}/credits`, body),
  removeDealCredit: (id: string, creditId: string) => del(`deals/${id}/credits/${creditId}`),

  // Derivations
  listDerivations: (workspace_id: string) => get(`derivations${qs({ workspace_id })}`),
  runDerivation: (body: unknown) => post('derivations', body),
  getDerivation: (id: string) => get(`derivations/${id}`),
  explainDerivationLine: (id: string, lineId: string) => get(`derivations/${id}/explain/${lineId}`),
  deleteDerivation: (id: string) => del(`derivations/${id}`),

  // Actuals
  listActuals: (workspace_id: string) => get(`actuals${qs({ workspace_id })}`),
  importActual: (body: unknown) => post('actuals', body),
  getActual: (id: string) => get(`actuals/${id}`),
  deleteActual: (id: string) => del(`actuals/${id}`),

  // Reconciliations
  listReconciliations: (workspace_id: string) => get(`reconciliations${qs({ workspace_id })}`),
  runReconciliation: (body: unknown) => post('reconciliations', body),
  getReconciliation: (id: string) => get(`reconciliations/${id}`),
  setReconciliationStatus: (id: string, body: unknown) => put(`reconciliations/${id}/status`, body),
  deleteReconciliation: (id: string) => del(`reconciliations/${id}`),

  // Disputes
  listDisputes: (workspace_id: string, opts?: { status?: string }) =>
    get(`disputes${qs({ workspace_id, status: opts?.status })}`),
  createDispute: (body: unknown) => post('disputes', body),
  getDispute: (id: string) => get(`disputes/${id}`),
  updateDispute: (id: string, body: unknown) => put(`disputes/${id}`, body),
  resolveDispute: (id: string, body: unknown) => post(`disputes/${id}/resolve`, body),
  deleteDispute: (id: string) => del(`disputes/${id}`),
  attachDisputeDeal: (id: string, body: unknown) => post(`disputes/${id}/deals`, body),
  detachDisputeDeal: (id: string, dealId: string) => del(`disputes/${id}/deals/${dealId}`),
  addDisputeComment: (id: string, body: unknown) => post(`disputes/${id}/comments`, body),
  listDisputeComments: (id: string) => get(`disputes/${id}/comments`),

  // Clawbacks
  listClawbacks: (workspace_id: string) => get(`clawbacks${qs({ workspace_id })}`),
  createClawback: (body: unknown) => post('clawbacks', body),
  updateClawback: (id: string, body: unknown) => put(`clawbacks/${id}`, body),
  deleteClawback: (id: string) => del(`clawbacks/${id}`),

  // Adjustments
  listAdjustments: (workspace_id: string, opts?: { rep_id?: string }) =>
    get(`adjustments${qs({ workspace_id, rep_id: opts?.rep_id })}`),
  createAdjustment: (body: unknown) => post('adjustments', body),
  updateAdjustment: (id: string, body: unknown) => put(`adjustments/${id}`, body),
  deleteAdjustment: (id: string) => del(`adjustments/${id}`),

  // Splits reconciliation
  listSplitIntegrity: (workspace_id: string) => get(`splits-recon${qs({ workspace_id })}`),
  getSplitIntegritySummary: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`splits-recon/summary${qs({ workspace_id, period_id: opts?.period_id })}`),

  // Cost of error
  getCostOfError: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`cost-of-error${qs({ workspace_id, period_id: opts?.period_id })}`),
  getCostOfErrorTrend: (workspace_id: string) => get(`cost-of-error/trend${qs({ workspace_id })}`),

  // Quota
  getQuota: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`quota${qs({ workspace_id, period_id: opts?.period_id })}`),
  getQuotaLeaderboard: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`quota/leaderboard${qs({ workspace_id, period_id: opts?.period_id })}`),

  // Audit
  listAuditLogs: (workspace_id: string, opts?: { page?: number; limit?: number }) =>
    get(`audit${qs({ workspace_id, page: opts?.page, limit: opts?.limit })}`),
  explainNumber: (run_id: string, line_id: string) => get(`audit/explain${qs({ run_id, line_id })}`),

  // Notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: () => post('notifications/read-all'),

  // Reports
  reportReconciliation: (reconciliation_id: string) =>
    get(`reports/reconciliation${qs({ reconciliation_id })}`),
  reportDispute: (dispute_id: string) => get(`reports/dispute${qs({ dispute_id })}`),
  reportCostOfError: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`reports/cost-of-error${qs({ workspace_id, period_id: opts?.period_id })}`),
  reportStatement: (workspace_id: string, rep_id: string, period_id: string) =>
    get(`reports/statement${qs({ workspace_id, rep_id, period_id })}`),
  reportAccrual: (workspace_id: string, opts?: { period_id?: string }) =>
    get(`reports/accrual${qs({ workspace_id, period_id: opts?.period_id })}`),

  // Saved views
  listViews: (workspace_id: string, opts?: { resource?: string }) =>
    get(`views${qs({ workspace_id, resource: opts?.resource })}`),
  createView: (body: unknown) => post('views', body),
  updateView: (id: string, body: unknown) => put(`views/${id}`, body),
  deleteView: (id: string) => del(`views/${id}`),

  // Dashboard
  getDashboard: (workspace_id: string) => get(`dashboard${qs({ workspace_id })}`),

  // Seed
  seedDemo: (body?: unknown) => post('seed', body),
  resetDemo: (body: unknown) => post('seed/reset', body),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: (body?: unknown) => post('billing/checkout', body),
  openBillingPortal: (body?: unknown) => post('billing/portal', body),

  // Stats
  getStats: (workspace_id: string) => get(`stats${qs({ workspace_id })}`),
}

export default api
