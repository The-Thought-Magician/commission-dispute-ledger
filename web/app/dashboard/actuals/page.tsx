'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

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

type ImportLine = { rep_id: string; deal_id: string; amount: string }

export default function ActualsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [actuals, setActuals] = useState<AnyRecord[]>([])
  const [periods, setPeriods] = useState<AnyRecord[]>([])
  const [reps, setReps] = useState<AnyRecord[]>([])

  const [search, setSearch] = useState('')
  const [periodFilter, setPeriodFilter] = useState('')

  // Detail drawer
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ run: AnyRecord; lines: AnyRecord[] } | null>(null)

  // Import modal
  const [importOpen, setImportOpen] = useState(false)
  const [importPeriod, setImportPeriod] = useState('')
  const [importLabel, setImportLabel] = useState('')
  const [importLines, setImportLines] = useState<ImportLine[]>([{ rep_id: '', deal_id: '', amount: '' }])
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadData = useCallback(async (ws: string) => {
    setError(null)
    try {
      const [a, p, r] = await Promise.all([
        api.listActuals(ws),
        api.listPeriods(ws),
        api.listReps(ws),
      ])
      setActuals(Array.isArray(a) ? a : [])
      setPeriods(Array.isArray(p) ? p : [])
      setReps(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load actuals')
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

  const repLabel = useCallback(
    (rid: unknown) => {
      const r = reps.find((x) => x.id === rid)
      return r?.name ?? (rid ? String(rid).slice(0, 8) : '—')
    },
    [reps],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return actuals.filter((a) => {
      if (periodFilter && a.period_id !== periodFilter) return false
      if (!q) return true
      const hay = [a.source_label, a.id, periodLabel(a.period_id)]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [actuals, search, periodFilter, periodLabel])

  const totals = useMemo(() => {
    const grand = actuals.reduce((acc, a) => acc + num(a.actual_total_cents), 0)
    return { count: actuals.length, grand }
  }, [actuals])

  const openDetail = async (run: AnyRecord) => {
    setDetailOpen(true)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const data = await api.getActual(run.id)
      setDetail({ run: data?.run ?? run, lines: Array.isArray(data?.lines) ? data.lines : [] })
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : 'Failed to load run')
    } finally {
      setDetailLoading(false)
    }
  }

  const onDelete = async (run: AnyRecord) => {
    if (!window.confirm(`Delete actual run "${run.source_label ?? run.id}"? This cannot be undone.`)) return
    setDeletingId(run.id)
    try {
      await api.deleteActual(run.id)
      setActuals((prev) => prev.filter((a) => a.id !== run.id))
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeletingId(null)
    }
  }

  const addLine = () => setImportLines((prev) => [...prev, { rep_id: '', deal_id: '', amount: '' }])
  const removeLine = (i: number) =>
    setImportLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)))
  const updateLine = (i: number, key: keyof ImportLine, value: string) =>
    setImportLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)))

  const resetImport = () => {
    setImportPeriod('')
    setImportLabel('')
    setImportLines([{ rep_id: '', deal_id: '', amount: '' }])
    setSubmitError(null)
  }

  const importTotal = useMemo(
    () => importLines.reduce((acc, l) => acc + Math.round(num(l.amount) * 100), 0),
    [importLines],
  )

  const submitImport = async () => {
    if (!workspaceId) return
    setSubmitError(null)
    if (!importPeriod) {
      setSubmitError('Select a period.')
      return
    }
    const lines = importLines
      .filter((l) => l.rep_id || l.deal_id || l.amount)
      .map((l) => ({
        rep_id: l.rep_id || null,
        deal_id: l.deal_id || null,
        amount_cents: Math.round(num(l.amount) * 100),
      }))
    if (lines.length === 0) {
      setSubmitError('Add at least one line.')
      return
    }
    setSubmitting(true)
    try {
      const created = await api.importActual({
        workspace_id: workspaceId,
        period_id: importPeriod,
        source_label: importLabel.trim() || 'Imported run',
        lines,
      })
      setActuals((prev) => [created, ...prev])
      setImportOpen(false)
      resetImport()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Failed to import actual run')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <PageSpinner label="Loading actuals..." />

  if (!workspaceId) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="No workspace selected"
          description="Create or select a workspace first to import commission runs."
          action={
            <a href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </a>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Actuals</h1>
          <p className="mt-1 text-sm text-slate-400">
            Imported commission runs from payroll or your comp system, ready to reconcile against derivations.
          </p>
        </div>
        <Button onClick={() => setImportOpen(true)}>Import run</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}{' '}
          <button className="underline" onClick={() => loadData(workspaceId)}>
            Retry
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Imported runs" value={totals.count} />
        <Stat label="Total actual paid" value={money(totals.grand)} />
        <Stat label="Periods covered" value={new Set(actuals.map((a) => a.period_id)).size} />
        <Stat label="Reps in roster" value={reps.length} />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by source label..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none sm:max-w-xs"
        />
        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
        >
          <option value="">All periods</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="text-xs text-slate-500 sm:ml-auto">
          Showing {filtered.length} of {actuals.length}
        </div>
      </div>

      {actuals.length === 0 ? (
        <EmptyState
          title="No actual runs imported yet"
          description="Import the commission amounts your payroll or comp system actually paid, then reconcile them against the derived expected payouts."
          action={<Button onClick={() => setImportOpen(true)}>Import your first run</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No runs match your filters" description="Try clearing the search or period filter." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Source label</TH>
              <TH>Period</TH>
              <TH className="text-right">Actual total</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((a) => (
              <TR key={a.id}>
                <TD>
                  <button
                    className="font-medium text-fuchsia-300 hover:underline"
                    onClick={() => openDetail(a)}
                  >
                    {a.source_label ?? 'Untitled run'}
                  </button>
                  <div className="font-mono text-[10px] text-slate-500">{String(a.id).slice(0, 8)}</div>
                </TD>
                <TD>
                  <Badge tone="info">{periodLabel(a.period_id)}</Badge>
                </TD>
                <TD className="text-right font-medium tabular-nums text-white">
                  {money(a.actual_total_cents)}
                </TD>
                <TD className="text-slate-400">
                  {a.created_at ? new Date(a.created_at).toLocaleDateString() : '—'}
                </TD>
                <TD>
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openDetail(a)}>
                      View
                    </Button>
                    <Button
                      variant="danger"
                      className="px-2 py-1 text-xs"
                      disabled={deletingId === a.id}
                      onClick={() => onDelete(a)}
                    >
                      {deletingId === a.id ? '...' : 'Delete'}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Detail modal */}
      <Modal
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        title={detail?.run?.source_label ?? 'Actual run'}
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setDetailOpen(false)}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <div className="py-8">
            <Spinner label="Loading lines..." />
          </div>
        ) : detailError ? (
          <p className="text-sm text-red-400">{detailError}</p>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs text-slate-500">Period</div>
                <div className="text-slate-200">{periodLabel(detail.run.period_id)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Actual total</div>
                <div className="font-medium text-white">{money(detail.run.actual_total_cents)}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Lines</div>
                <div className="text-slate-200">{detail.lines.length}</div>
              </div>
            </div>
            {detail.lines.length === 0 ? (
              <p className="text-sm text-slate-500">No line items in this run.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <THead>
                    <TR>
                      <TH>Rep</TH>
                      <TH>Deal</TH>
                      <TH className="text-right">Amount</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {detail.lines.map((l) => (
                      <TR key={l.id}>
                        <TD>{l.rep_name ?? repLabel(l.rep_id)}</TD>
                        <TD className="font-mono text-xs text-slate-400">
                          {l.deal_id ? String(l.deal_id).slice(0, 8) : '—'}
                        </TD>
                        <TD className="text-right tabular-nums">{money(l.amount_cents)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      {/* Import modal */}
      <Modal
        open={importOpen}
        onClose={() => (submitting ? null : (setImportOpen(false), resetImport()))}
        title="Import commission run"
        className="max-w-2xl"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setImportOpen(false)
                resetImport()
              }}
            >
              Cancel
            </Button>
            <Button onClick={submitImport} disabled={submitting}>
              {submitting ? 'Importing...' : `Import (${money(importTotal)})`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-slate-400">Period</span>
              <select
                value={importPeriod}
                onChange={(e) => setImportPeriod(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
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
              <span className="mb-1 block text-slate-400">Source label</span>
              <input
                value={importLabel}
                onChange={(e) => setImportLabel(e.target.value)}
                placeholder="e.g. Payroll Q1 export"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none"
              />
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-300">Line items</span>
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={addLine}>
                + Add line
              </Button>
            </div>
            <div className="space-y-2">
              {importLines.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2">
                  <select
                    value={l.rep_id}
                    onChange={(e) => updateLine(i, 'rep_id', e.target.value)}
                    className="col-span-5 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                  >
                    <option value="">Rep (optional)</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <input
                    value={l.deal_id}
                    onChange={(e) => updateLine(i, 'deal_id', e.target.value)}
                    placeholder="Deal ID (optional)"
                    className="col-span-4 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none"
                  />
                  <input
                    value={l.amount}
                    onChange={(e) => updateLine(i, 'amount', e.target.value)}
                    placeholder="Amount $"
                    inputMode="decimal"
                    className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-right text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none"
                  />
                  <button
                    onClick={() => removeLine(i)}
                    aria-label="Remove line"
                    className="col-span-1 rounded-lg text-slate-500 hover:text-red-400"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 text-right text-xs text-slate-500">
              Run total: <span className="font-medium text-slate-300">{money(importTotal)}</span>
            </div>
          </div>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </div>
      </Modal>
    </div>
  )
}
