'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
  owner_id?: string
  currency?: string | null
  fiscal_start_month?: number | null
  rounding_mode?: string | null
  default_tolerance_cents?: number | null
}
interface BillingPlan {
  subscription: {
    id?: string
    plan_id?: string
    status?: string
    current_period_end?: string | null
  } | null
  plan: { id: string; name: string; price_cents: number } | null
  stripeEnabled: boolean
}
interface Stats {
  deals: number
  reps: number
  disputes: number
  runs: number
  reconciliations: number
}
interface SavedView {
  id: string
  name: string
  resource: string
  filter: unknown
  created_at: string
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']
const ROUNDING_MODES = ['half_up', 'half_even', 'down', 'up']
const RESOURCES = ['deals', 'reps', 'disputes', 'reconciliations', 'clawbacks', 'adjustments', 'derivations', 'actuals']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtPrice(cents: number | undefined): string {
  if (cents == null) return '—'
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(0)}/mo`
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [views, setViews] = useState<SavedView[]>([])

  // Workspace settings form
  const [form, setForm] = useState({
    name: '',
    currency: 'USD',
    fiscal_start_month: 1,
    rounding_mode: 'half_up',
    default_tolerance_cents: 0,
  })
  const [savingWs, setSavingWs] = useState(false)
  const [wsSaved, setWsSaved] = useState(false)

  // Billing busy
  const [billingBusy, setBillingBusy] = useState<'checkout' | 'portal' | null>(null)

  // Saved views
  const [viewModalOpen, setViewModalOpen] = useState(false)
  const [viewForm, setViewForm] = useState({ name: '', resource: 'deals', filter: '{}' })
  const [viewSaving, setViewSaving] = useState(false)
  const [viewError, setViewError] = useState<string | null>(null)
  const [deletingView, setDeletingView] = useState<SavedView | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const applyWorkspace = useCallback((ws: Workspace) => {
    setWorkspace(ws)
    setForm({
      name: ws.name ?? '',
      currency: ws.currency ?? 'USD',
      fiscal_start_month: ws.fiscal_start_month ?? 1,
      rounding_mode: ws.rounding_mode ?? 'half_up',
      default_tolerance_cents: ws.default_tolerance_cents ?? 0,
    })
  }, [])

  const loadAll = useCallback(
    async (wsId: string) => {
      setError(null)
      try {
        const [ws, bill, st, vw] = await Promise.all([
          api.getWorkspace(wsId),
          api.getBillingPlan(),
          api.getStats(wsId),
          api.listViews(wsId),
        ])
        if (ws) applyWorkspace(ws)
        setBilling(bill ?? null)
        setStats(st ?? null)
        setViews(vw ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load settings')
      }
    },
    [applyWorkspace]
  )

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const ws: Workspace[] = (await api.listWorkspaces()) ?? []
        if (!mounted) return
        setWorkspaces(ws)
        if (ws.length === 0) {
          // Billing is account-level, still load it
          try {
            setBilling((await api.getBillingPlan()) ?? null)
          } catch {
            /* ignore */
          }
          setLoading(false)
          return
        }
        const stored = getActiveWorkspaceId()
        const active = (stored && ws.find((w) => w.id === stored)?.id) || ws[0].id
        if (active !== stored) setActiveWorkspaceId(active)
        setWorkspaceId(active)
        await loadAll(active)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadAll])

  const onSwitchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    setActiveWorkspaceId(id)
    setWsSaved(false)
    setLoading(true)
    await loadAll(id)
    setLoading(false)
  }

  const saveWorkspace = async () => {
    if (!workspaceId) return
    setSavingWs(true)
    setError(null)
    setWsSaved(false)
    try {
      const updated = await api.updateWorkspace(workspaceId, {
        name: form.name.trim(),
        currency: form.currency,
        fiscal_start_month: Number(form.fiscal_start_month),
        rounding_mode: form.rounding_mode,
        default_tolerance_cents: Number(form.default_tolerance_cents),
      })
      if (updated) {
        applyWorkspace(updated)
        setWorkspaces((prev) => prev.map((w) => (w.id === updated.id ? { ...w, ...updated } : w)))
      }
      setWsSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save workspace settings')
    } finally {
      setSavingWs(false)
    }
  }

  const startCheckout = async () => {
    setBillingBusy('checkout')
    setError(null)
    try {
      const res = await api.startCheckout({})
      if (res?.url) window.location.href = res.url
      else setError('Checkout is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start checkout')
    } finally {
      setBillingBusy(null)
    }
  }

  const openPortal = async () => {
    setBillingBusy('portal')
    setError(null)
    try {
      const res = await api.openBillingPortal({})
      if (res?.url) window.location.href = res.url
      else setError('Billing portal is not available right now.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open billing portal')
    } finally {
      setBillingBusy(null)
    }
  }

  const submitView = async () => {
    if (!viewForm.name.trim()) {
      setViewError('Name is required')
      return
    }
    let parsedFilter: unknown = {}
    if (viewForm.filter.trim()) {
      try {
        parsedFilter = JSON.parse(viewForm.filter)
      } catch {
        setViewError('Filter must be valid JSON')
        return
      }
    }
    setViewSaving(true)
    setViewError(null)
    try {
      await api.createView({
        workspace_id: workspaceId,
        name: viewForm.name.trim(),
        resource: viewForm.resource,
        filter: parsedFilter,
      })
      setViewModalOpen(false)
      setViewForm({ name: '', resource: 'deals', filter: '{}' })
      const vw = await api.listViews(workspaceId)
      setViews(vw ?? [])
    } catch (e) {
      setViewError(e instanceof Error ? e.message : 'Failed to create saved view')
    } finally {
      setViewSaving(false)
    }
  }

  const confirmDeleteView = async () => {
    if (!deletingView) return
    setDeleteBusy(true)
    try {
      await api.deleteView(deletingView.id)
      setViews((prev) => prev.filter((v) => v.id !== deletingView.id))
      setDeletingView(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete saved view')
    } finally {
      setDeleteBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  const isPro = (billing?.plan?.id ?? billing?.subscription?.plan_id) === 'pro'
  const subStatus = billing?.subscription?.status

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">
            Workspace configuration, billing, and saved views.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => onSwitchWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Stat label="Deals" value={stats.deals} />
          <Stat label="Reps" value={stats.reps} />
          <Stat label="Disputes" value={stats.disputes} tone={stats.disputes > 0 ? 'warning' : 'default'} />
          <Stat label="Derivation Runs" value={stats.runs} />
          <Stat label="Reconciliations" value={stats.reconciliations} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workspace settings */}
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Workspace</h2>
            {wsSaved && <Badge tone="success">Saved</Badge>}
          </CardHeader>
          <CardBody className="space-y-4">
            {!workspace ? (
              <EmptyState title="No workspace" description="Create a workspace to configure settings." />
            ) : (
              <>
                <Field label="Name">
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={inputClass}
                  />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Currency">
                    <select
                      value={form.currency}
                      onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                      className={inputClass}
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Fiscal start month">
                    <select
                      value={form.fiscal_start_month}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, fiscal_start_month: Number(e.target.value) }))
                      }
                      className={inputClass}
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Rounding mode">
                    <select
                      value={form.rounding_mode}
                      onChange={(e) => setForm((f) => ({ ...f, rounding_mode: e.target.value }))}
                      className={inputClass}
                    >
                      {ROUNDING_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Default tolerance (cents)">
                    <input
                      type="number"
                      min={0}
                      value={form.default_tolerance_cents}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, default_tolerance_cents: Number(e.target.value) }))
                      }
                      className={inputClass}
                    />
                  </Field>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button onClick={saveWorkspace} disabled={savingWs}>
                    {savingWs ? 'Saving...' : 'Save Settings'}
                  </Button>
                  <span className="text-xs text-slate-500">
                    Tolerance is the default delta below which reconciliations are auto-accepted.
                  </span>
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {/* Billing */}
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Billing</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950 px-4 py-3">
              <div>
                <div className="text-sm text-slate-400">Current plan</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-lg font-semibold text-white">
                    {billing?.plan?.name ?? 'Free'}
                  </span>
                  {isPro ? <Badge tone="success">Pro</Badge> : <Badge tone="neutral">Free</Badge>}
                  {subStatus && <Badge tone={subStatus === 'active' ? 'success' : 'warning'}>{subStatus}</Badge>}
                </div>
              </div>
              <div className="text-right text-sm text-slate-400">{fmtPrice(billing?.plan?.price_cents)}</div>
            </div>

            {billing?.subscription?.current_period_end && (
              <p className="text-xs text-slate-500">
                Renews{' '}
                {new Date(billing.subscription.current_period_end).toLocaleDateString()}.
              </p>
            )}

            {!billing?.stripeEnabled && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Stripe billing is not configured for this deployment. Checkout and portal are disabled.
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {isPro ? (
                <Button
                  variant="secondary"
                  onClick={openPortal}
                  disabled={!billing?.stripeEnabled || billingBusy !== null}
                >
                  {billingBusy === 'portal' ? 'Opening...' : 'Manage Billing'}
                </Button>
              ) : (
                <Button onClick={startCheckout} disabled={!billing?.stripeEnabled || billingBusy !== null}>
                  {billingBusy === 'checkout' ? 'Redirecting...' : 'Upgrade to Pro'}
                </Button>
              )}
            </div>

            <ul className="space-y-1 pt-2 text-sm text-slate-400">
              <li className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span> Unlimited reconciliations &amp; derivation runs
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span> Dispute workflow &amp; finance accruals
              </li>
              <li className="flex items-center gap-2">
                <span className="text-emerald-400">✓</span> Audit log &amp; CSV/JSON exports
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>

      {/* Saved views */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Saved Views</h2>
            <p className="mt-1 text-sm text-slate-400">Reusable filters for your most-checked tables.</p>
          </div>
          <Button onClick={() => setViewModalOpen(true)} disabled={!workspaceId}>
            + New View
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {views.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No saved views"
                description="Save a filtered view of deals, disputes, or reconciliations to jump back to it fast."
                action={
                  <Button onClick={() => setViewModalOpen(true)} disabled={!workspaceId}>
                    + New View
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Resource</TH>
                  <TH>Filter</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {views.map((v) => (
                  <TR key={v.id}>
                    <TD className="font-medium text-white">{v.name}</TD>
                    <TD>
                      <Badge tone="info">{v.resource}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-500">
                      {v.filter && Object.keys(v.filter as object).length > 0
                        ? JSON.stringify(v.filter)
                        : 'no filter'}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">
                      {new Date(v.created_at).toLocaleDateString()}
                    </TD>
                    <TD className="text-right">
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                        onClick={() => setDeletingView(v)}
                      >
                        Delete
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* New view modal */}
      <Modal
        open={viewModalOpen}
        onClose={() => setViewModalOpen(false)}
        title="New Saved View"
        footer={
          <>
            <Button variant="secondary" onClick={() => setViewModalOpen(false)} disabled={viewSaving}>
              Cancel
            </Button>
            <Button onClick={submitView} disabled={viewSaving}>
              {viewSaving ? <Spinner className="h-4" /> : 'Create View'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {viewError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {viewError}
            </div>
          )}
          <Field label="Name *">
            <input
              value={viewForm.name}
              onChange={(e) => setViewForm((f) => ({ ...f, name: e.target.value }))}
              className={inputClass}
              placeholder="Open West-region disputes"
            />
          </Field>
          <Field label="Resource">
            <select
              value={viewForm.resource}
              onChange={(e) => setViewForm((f) => ({ ...f, resource: e.target.value }))}
              className={inputClass}
            >
              {RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Filter (JSON)">
            <textarea
              value={viewForm.filter}
              onChange={(e) => setViewForm((f) => ({ ...f, filter: e.target.value }))}
              rows={4}
              className={`${inputClass} font-mono`}
              placeholder='{"status":"open"}'
            />
          </Field>
        </div>
      </Modal>

      {/* Delete view modal */}
      <Modal
        open={!!deletingView}
        onClose={() => setDeletingView(null)}
        title="Delete Saved View"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingView(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteView} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{deletingView?.name}</span>? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}
