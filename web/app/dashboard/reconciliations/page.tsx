'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type AnyRecord = Record<string, any>

const WS_KEY = 'cdl_workspace'

const money = (cents: unknown) => {
  const n = typeof cents === 'number' ? cents : Number(cents)
  if (!Number.isFinite(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100)
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = (status || '').toLowerCase()
  if (s === 'accepted' || s === 'closed') return 'success'
  if (s === 'reviewed') return 'info'
  if (s === 'open') return 'warning'
  return 'neutral'
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(WS_KEY)
    if (stored) return stored
  }
  const workspaces = await api.listWorkspaces().catch(() => [])
  const first = Array.isArray(workspaces) ? workspaces[0] : null
  if (first?.id) {
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, first.id)
    return first.id
  }
  return null
}

export default function ReconciliationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [recons, setRecons] = useState<AnyRecord[]>([])
  const [derivations, setDerivations] = useState<AnyRecord[]>([])
  const [actuals, setActuals] = useState<AnyRecord[]>([])
  const [periods, setPeriods] = useState<AnyRecord[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Run-new modal
  const [runOpen, setRunOpen] = useState(false)
  const [runPeriod, setRunPeriod] = useState('')
  const [runDerivation, setRunDerivation] = useState('')
  const [runActual, setRunActual] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = useCallback(async (ws: string) => {
    setError(null)
    try {
      const [rec, der, act, per] = await Promise.all([
        api.listReconciliations(ws),
        api.listDerivations(ws),
        api.listActuals(ws),
        api.listPeriods(ws),
      ])
      setRecons(Array.isArray(rec) ? rec : [])
      setDerivations(Array.isArray(der) ? der : [])
      setActuals(Array.isArray(act) ? act : [])
      setPeriods(Array.isArray(per) ? per : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reconciliations')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      const ws = await resolveWorkspaceId()
      if (!mounted) return
      setWorkspaceId(ws)
      if (ws) await loadData(ws)
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [loadData])

  const periodLabel = useCallback(
    (pid: unknown) => {
      const p = periods.find((x) => x.id === pid)
      return p?.label ?? (pid ? String(pid).slice(0, 8) : '—')
    },
    [periods],
  )

  // Filter derivation / actual options to the chosen period when one is set.
  const derivationOptions = useMemo(
    () => (runPeriod ? derivations.filter((d) => d.period_id === runPeriod) : derivations),
    [derivations, runPeriod],
  )
  const actualOptions = useMemo(
    () => (runPeriod ? actuals.filter((a) => a.period_id === runPeriod) : actuals),
    [actuals, runPeriod],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return recons.filter((r) => {
      if (statusFilter && String(r.status) !== statusFilter) return false
      if (!q) return true
      const hay = [r.id, periodLabel(r.period_id), r.status]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [recons, search, statusFilter, periodLabel])

  const stats = useMemo(() => {
    const open = recons.filter((r) => String(r.status).toLowerCase() === 'open').length
    const netAbs = recons.reduce((acc, r) => acc + Math.abs(num(r.net_delta_cents)), 0)
    const outOfTolerance = recons.filter(
      (r) => Math.abs(num(r.net_delta_cents)) > num(r.tolerance_cents),
    ).length
    return { total: recons.length, open, netAbs, outOfTolerance }
  }, [recons])

  const resetRun = () => {
    setRunPeriod('')
    setRunDerivation('')
    setRunActual('')
    setSubmitError(null)
  }

  const submitRun = async () => {
    if (!workspaceId) return
    setSubmitError(null)
    if (!runPeriod || !runDerivation || !runActual) {
      setSubmitError('Select a period, a derivation run, and an actual run.')
      return
    }
    setSubmitting(true)
    try {
      const created = await api.runReconciliation({
        workspace_id: workspaceId,
        period_id: runPeriod,
        derivation_run_id: runDerivation,
        actual_run_id: runActual,
      })
      setRecons((prev) => [created, ...prev])
      setRunOpen(false)
      resetRun()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to run reconciliation')
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async (r: AnyRecord) => {
    if (!window.confirm('Delete this reconciliation? This cannot be undone.')) return
    setDeletingId(r.id)
    try {
      await api.deleteReconciliation(r.id)
      setRecons((prev) => prev.filter((x) => x.id !== r.id))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading reconciliations..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace first to run reconciliations."
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const canRun = derivations.length > 0 && actuals.length > 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Reconciliations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Compare derived expected payouts against imported actuals to surface every discrepancy.
          </p>
        </div>
        <Button onClick={() => setRunOpen(true)} disabled={!canRun} title={canRun ? '' : 'Need a derivation run and an actual run first'}>
          Run reconciliation
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}{' '}
          <button className="underline" onClick={() => loadData(workspaceId)}>
            Retry
          </button>
        </div>
      )}

      {!canRun && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          You need at least one{' '}
          <Link href="/dashboard/derivations" className="underline">
            derivation run
          </Link>{' '}
          and one{' '}
          <Link href="/dashboard/actuals" className="underline">
            actual run
          </Link>{' '}
          before you can reconcile.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Reconciliations" value={stats.total} />
        <Stat label="Open" value={stats.open} tone={stats.open > 0 ? 'warning' : 'default'} />
        <Stat
          label="Out of tolerance"
          value={stats.outOfTolerance}
          tone={stats.outOfTolerance > 0 ? 'danger' : 'success'}
        />
        <Stat label="Absolute net delta" value={money(stats.netAbs)} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by period or id..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-emerald-500 focus:outline-none sm:max-w-xs"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="reviewed">Reviewed</option>
          <option value="accepted">Accepted</option>
        </select>
        <div className="text-xs text-slate-500 sm:ml-auto">
          Showing {filtered.length} of {recons.length}
        </div>
      </div>

      {recons.length === 0 ? (
        <EmptyState
          title="No reconciliations yet"
          description="Run a reconciliation to compare a derivation run against an imported actual run and find the dollar deltas."
          action={
            <Button onClick={() => setRunOpen(true)} disabled={!canRun}>
              Run reconciliation
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No reconciliations match your filters" description="Try clearing the search or status filter." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Period</TH>
              <TH className="text-right">Expected</TH>
              <TH className="text-right">Actual</TH>
              <TH className="text-right">Net delta</TH>
              <TH className="text-right">Tolerance</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((r) => {
              const delta = num(r.net_delta_cents)
              const outOfTol = Math.abs(delta) > num(r.tolerance_cents)
              return (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/dashboard/reconciliations/${r.id}`}
                      className="font-medium text-emerald-300 hover:underline"
                    >
                      {periodLabel(r.period_id)}
                    </Link>
                    <div className="font-mono text-[10px] text-slate-500">{String(r.id).slice(0, 8)}</div>
                  </TD>
                  <TD className="text-right tabular-nums">{money(r.expected_total_cents)}</TD>
                  <TD className="text-right tabular-nums">{money(r.actual_total_cents)}</TD>
                  <TD
                    className={`text-right font-medium tabular-nums ${
                      delta === 0 ? 'text-slate-300' : delta > 0 ? 'text-amber-300' : 'text-red-300'
                    }`}
                  >
                    {delta > 0 ? '+' : ''}
                    {money(delta)}
                  </TD>
                  <TD className="text-right tabular-nums text-slate-400">{money(r.tolerance_cents)}</TD>
                  <TD>
                    <div className="flex items-center gap-1.5">
                      <Badge tone={statusTone(String(r.status ?? ''))}>{r.status ?? 'open'}</Badge>
                      {outOfTol && <Badge tone="danger">over tolerance</Badge>}
                    </div>
                  </TD>
                  <TD className="text-slate-400">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/dashboard/reconciliations/${r.id}`}>
                        <Button variant="ghost" className="px-2 py-1 text-xs">
                          View
                        </Button>
                      </Link>
                      <Button
                        variant="danger"
                        className="px-2 py-1 text-xs"
                        disabled={deletingId === r.id}
                        onClick={() => onDelete(r)}
                      >
                        {deletingId === r.id ? '...' : 'Delete'}
                      </Button>
                    </div>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* Run-new modal */}
      <Modal
        open={runOpen}
        onClose={() => (submitting ? null : (setRunOpen(false), resetRun()))}
        title="Run a new reconciliation"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setRunOpen(false)
                resetRun()
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitRun} disabled={submitting}>
              {submitting ? 'Running...' : 'Run reconciliation'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Pick a period, then choose the derivation run (expected) and actual run (paid) to compare.
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Period</span>
            <select
              value={runPeriod}
              onChange={(e) => {
                setRunPeriod(e.target.value)
                setRunDerivation('')
                setRunActual('')
              }}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select period...</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Derivation run (expected)</span>
            <select
              value={runDerivation}
              onChange={(e) => setRunDerivation(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select derivation run...</option>
              {derivationOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {String(d.id).slice(0, 8)} · {periodLabel(d.period_id)} · {money(d.expected_total_cents)}
                </option>
              ))}
            </select>
            {runPeriod && derivationOptions.length === 0 && (
              <span className="mt-1 block text-xs text-amber-300">No derivation runs for this period.</span>
            )}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-slate-400">Actual run (paid)</span>
            <select
              value={runActual}
              onChange={(e) => setRunActual(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select actual run...</option>
              {actualOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.source_label ?? String(a.id).slice(0, 8)} · {money(a.actual_total_cents)}
                </option>
              ))}
            </select>
            {runPeriod && actualOptions.length === 0 && (
              <span className="mt-1 block text-xs text-amber-300">No actual runs for this period.</span>
            )}
          </label>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>
      </Modal>
    </div>
  )
}
