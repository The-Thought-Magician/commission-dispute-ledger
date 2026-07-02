'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type DerivationRun = {
  id: string
  workspace_id: string
  period_id: string | null
  plan_version_id: string | null
  status: string
  inputs_hash: string | null
  expected_total_cents: number | null
  created_by: string | null
  created_at: string
}

type Period = { id: string; label: string; status: string }
type Plan = { id: string; name: string }
type PlanVersion = { id: string; version_number: number; base_rate?: number | null; notes?: string | null }

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  completed: 'success',
  complete: 'success',
  succeeded: 'success',
  running: 'info',
  pending: 'warning',
  failed: 'danger',
  error: 'danger',
}

function dollars(cents: number | null | undefined) {
  if (cents == null) return '—'
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function fmtDateTime(d: string | null) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('cdl_workspace')
    if (stored) return stored
  }
  const ws = await api.listWorkspaces()
  const first = Array.isArray(ws) && ws.length > 0 ? ws[0].id : null
  if (first && typeof window !== 'undefined') window.localStorage.setItem('cdl_workspace', first)
  return first ?? null
}

export default function DerivationsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [runs, setRuns] = useState<DerivationRun[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('all')

  const [runOpen, setRunOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runForm, setRunForm] = useState({ period_id: '', plan_id: '', plan_version_id: '' })
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const periodLabel = useCallback(
    (id: string | null) => (id ? periods.find((p) => p.id === id)?.label ?? id.slice(0, 8) : '—'),
    [periods],
  )

  const loadRuns = useCallback(async (wsId: string) => {
    const rows = await api.listDerivations(wsId)
    setRuns(Array.isArray(rows) ? rows : [])
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const wsId = await resolveWorkspaceId()
        if (!mounted) return
        setWorkspaceId(wsId)
        if (!wsId) {
          setError('No workspace found. Create a workspace first.')
          return
        }
        const [, ps, pl] = await Promise.all([
          loadRuns(wsId),
          api.listPeriods(wsId).catch(() => []),
          api.listPlans(wsId).catch(() => []),
        ])
        if (!mounted) return
        setPeriods(Array.isArray(ps) ? ps : [])
        setPlans(Array.isArray(pl) ? pl : [])
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load derivations')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadRuns])

  // Load plan versions when a plan is selected in the run modal.
  useEffect(() => {
    let active = true
    if (!runForm.plan_id) {
      setVersions([])
      return
    }
    setVersionsLoading(true)
    api
      .listPlanVersions(runForm.plan_id)
      .then((v) => {
        if (!active) return
        const list: PlanVersion[] = Array.isArray(v) ? v : []
        setVersions(list)
        // Default to latest version.
        if (list.length > 0) {
          const latest = [...list].sort((a, b) => b.version_number - a.version_number)[0]
          setRunForm((f) => ({ ...f, plan_version_id: latest.id }))
        } else {
          setRunForm((f) => ({ ...f, plan_version_id: '' }))
        }
      })
      .catch(() => {
        if (active) setVersions([])
      })
      .finally(() => {
        if (active) setVersionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [runForm.plan_id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (periodFilter !== 'all' && r.period_id !== periodFilter) return false
      if (q) {
        const hay = `${r.id} ${r.inputs_hash ?? ''} ${periodLabel(r.period_id)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [runs, search, statusFilter, periodFilter, periodLabel])

  const stats = useMemo(() => {
    const total = runs.length
    const completed = runs.filter((r) => STATUS_TONE[r.status] === 'success').length
    const failed = runs.filter((r) => STATUS_TONE[r.status] === 'danger').length
    const latest = runs
      .filter((r) => r.expected_total_cents != null)
      .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]
    return { total, completed, failed, latestTotal: latest?.expected_total_cents ?? null }
  }, [runs])

  const statusOptions = useMemo(() => {
    const s = new Set<string>()
    runs.forEach((r) => s.add(r.status))
    return Array.from(s)
  }, [runs])

  function openRun() {
    setRunForm({ period_id: periods[0]?.id ?? '', plan_id: plans[0]?.id ?? '', plan_version_id: '' })
    setRunError(null)
    setRunOpen(true)
  }

  async function submitRun(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    if (!runForm.period_id) {
      setRunError('Select a period')
      return
    }
    if (!runForm.plan_version_id) {
      setRunError('Select a plan version')
      return
    }
    setRunning(true)
    setRunError(null)
    try {
      await api.runDerivation({
        workspace_id: workspaceId,
        period_id: runForm.period_id,
        plan_version_id: runForm.plan_version_id,
      })
      setRunOpen(false)
      await loadRuns(workspaceId)
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Failed to run derivation')
    } finally {
      setRunning(false)
    }
  }

  async function deleteRun(r: DerivationRun) {
    if (!workspaceId) return
    if (typeof window !== 'undefined' && !window.confirm('Delete this derivation run? This cannot be undone.'))
      return
    setDeletingId(r.id)
    setError(null)
    try {
      await api.deleteDerivation(r.id)
      await loadRuns(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete run')
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading derivations..." />

  const maxTotal = Math.max(1, ...runs.map((r) => r.expected_total_cents ?? 0))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Re-derivations</h1>
          <p className="mt-1 text-sm text-slate-400">
            Independently recompute expected payouts from closed deals and a pinned comp-plan version.
          </p>
        </div>
        <Button onClick={openRun} disabled={!workspaceId}>
          + Run Derivation
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total Runs" value={stats.total} />
        <Stat label="Completed" value={stats.completed} tone="success" />
        <Stat label="Failed" value={stats.failed} tone={stats.failed > 0 ? 'danger' : 'default'} />
        <Stat label="Latest Expected" value={dollars(stats.latestTotal)} />
      </div>

      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-white">Expected total by run</h2>
            <p className="text-xs text-slate-500">Most recent runs, oldest to newest.</p>
          </CardHeader>
          <CardBody>
            <div className="flex h-40 items-end gap-2 overflow-x-auto">
              {[...runs]
                .sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at))
                .slice(-24)
                .map((r) => {
                  const v = r.expected_total_cents ?? 0
                  const h = Math.max(4, Math.round((v / maxTotal) * 140))
                  const tone = STATUS_TONE[r.status]
                  const color =
                    tone === 'danger' ? 'bg-red-500/70' : tone === 'success' ? 'bg-fuchsia-500/70' : 'bg-slate-600'
                  return (
                    <div key={r.id} className="flex min-w-[28px] flex-1 flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-t ${color}`}
                        style={{ height: `${h}px` }}
                        title={`${dollars(r.expected_total_cents)} · ${r.status} · ${periodLabel(r.period_id)}`}
                      />
                      <span className="text-[10px] text-slate-500">{periodLabel(r.period_id).slice(0, 6)}</span>
                    </div>
                  )
                })}
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by id / hash / period..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="all">All periods</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statusOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={runs.length === 0 ? 'No derivation runs yet' : 'No runs match your filters'}
              description={
                runs.length === 0
                  ? 'Run a re-derivation to compute expected payouts for a period against a comp-plan version.'
                  : 'Try clearing the search or filters.'
              }
              action={
                runs.length === 0 ? (
                  <Button onClick={openRun} disabled={!workspaceId}>
                    + Run Derivation
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Run</TH>
                  <TH>Period</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Expected Total</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs text-slate-300">
                      <Link href={`/dashboard/derivations/${r.id}`} className="hover:text-fuchsia-300">
                        {r.id.slice(0, 8)}
                      </Link>
                      {r.inputs_hash && (
                        <div className="text-[10px] text-slate-600">hash {r.inputs_hash.slice(0, 12)}</div>
                      )}
                    </TD>
                    <TD className="text-slate-300">{periodLabel(r.period_id)}</TD>
                    <TD>
                      <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums text-slate-200">
                      {dollars(r.expected_total_cents)}
                    </TD>
                    <TD className="text-slate-400">{fmtDateTime(r.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/dashboard/derivations/${r.id}`}>
                          <Button variant="secondary">View</Button>
                        </Link>
                        <Button
                          variant="danger"
                          onClick={() => deleteRun(r)}
                          disabled={deletingId === r.id}
                        >
                          {deletingId === r.id ? 'Deleting...' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={runOpen}
        onClose={() => !running && setRunOpen(false)}
        title="Run Re-derivation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button type="submit" form="run-form" disabled={running}>
              {running ? 'Running...' : 'Run Derivation'}
            </Button>
          </>
        }
      >
        <form id="run-form" onSubmit={submitRun} className="space-y-4">
          {runError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {runError}
            </div>
          )}
          {periods.length === 0 || plans.length === 0 ? (
            <p className="text-sm text-slate-400">
              You need at least one period and one comp plan before running a derivation.
            </p>
          ) : (
            <>
              <Field label="Period">
                <select
                  value={runForm.period_id}
                  onChange={(e) => setRunForm({ ...runForm, period_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  <option value="">Select period...</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.status})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Comp Plan">
                <select
                  value={runForm.plan_id}
                  onChange={(e) => setRunForm({ ...runForm, plan_id: e.target.value, plan_version_id: '' })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  <option value="">Select plan...</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Plan Version">
                <select
                  value={runForm.plan_version_id}
                  onChange={(e) => setRunForm({ ...runForm, plan_version_id: e.target.value })}
                  disabled={versionsLoading || !runForm.plan_id}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none disabled:opacity-50"
                >
                  {versionsLoading && <option value="">Loading versions...</option>}
                  {!versionsLoading && versions.length === 0 && (
                    <option value="">No versions for this plan</option>
                  )}
                  {!versionsLoading &&
                    [...versions]
                      .sort((a, b) => b.version_number - a.version_number)
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          v{v.version_number}
                          {v.notes ? ` — ${v.notes}` : ''}
                        </option>
                      ))}
                </select>
              </Field>
              <p className="text-xs text-slate-500">
                The derivation pins to this immutable version so the math is reproducible and traceable.
              </p>
            </>
          )}
        </form>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}
