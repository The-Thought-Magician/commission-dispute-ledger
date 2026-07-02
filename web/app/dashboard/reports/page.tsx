'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}
interface Rep {
  id: string
  name: string
}
interface Period {
  id: string
  label: string
}
interface Reconciliation {
  id: string
  period_id: string | null
  status: string | null
  net_delta_cents: number | null
  created_at: string
}
interface Dispute {
  id: string
  narrative: string | null
  status: string | null
  claimed_amount_cents: number | null
  created_at: string
}
interface AuditLog {
  id: string
  actor: string | null
  entity_type: string | null
  entity_id: string | null
  action: string | null
  before: unknown
  after: unknown
  created_at: string
}

type ReportKind =
  | 'reconciliation'
  | 'dispute'
  | 'cost-of-error'
  | 'statement'
  | 'accrual'

const REPORT_DEFS: { kind: ReportKind; title: string; desc: string }[] = [
  { kind: 'reconciliation', title: 'Reconciliation Export', desc: 'Line-by-line expected-vs-actual deltas for one reconciliation run.' },
  { kind: 'dispute', title: 'Dispute Resolution', desc: 'Full case record: snapshot, deals, comments, and resolution.' },
  { kind: 'cost-of-error', title: 'Cost of Error', desc: 'Over/underpaid totals and error rate for the workspace or a period.' },
  { kind: 'statement', title: 'Rep Statement', desc: 'Per-rep expected-vs-actual statement for a single period.' },
  { kind: 'accrual', title: 'Finance Accrual', desc: 'Liability / accrual summary for finance close.' },
]

function fmtCents(c: number | null | undefined): string {
  if (c == null) return '—'
  return (c / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function actionTone(action: string | null): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const a = (action ?? '').toLowerCase()
  if (a.includes('create') || a.includes('insert')) return 'success'
  if (a.includes('delete') || a.includes('remove')) return 'danger'
  if (a.includes('update') || a.includes('edit')) return 'warning'
  if (a.includes('resolve') || a.includes('lock') || a.includes('close')) return 'info'
  return 'neutral'
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')

  const [reps, setReps] = useState<Rep[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [recons, setRecons] = useState<Reconciliation[]>([])
  const [disputes, setDisputes] = useState<Dispute[]>([])

  // Report builder state
  const [kind, setKind] = useState<ReportKind>('reconciliation')
  const [reconId, setReconId] = useState('')
  const [disputeId, setDisputeId] = useState('')
  const [statementRep, setStatementRep] = useState('')
  const [statementPeriod, setStatementPeriod] = useState('')
  const [coePeriod, setCoePeriod] = useState('')
  const [accrualPeriod, setAccrualPeriod] = useState('')

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<unknown>(null)
  const [reportError, setReportError] = useState<string | null>(null)

  // Audit log
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditSearch, setAuditSearch] = useState('')
  const AUDIT_LIMIT = 25

  // Explain a number
  const [explainRun, setExplainRun] = useState('')
  const [explainLine, setExplainLine] = useState('')
  const [explainBusy, setExplainBusy] = useState(false)
  const [explainResult, setExplainResult] = useState<unknown>(null)
  const [explainError, setExplainError] = useState<string | null>(null)

  const loadAudit = useCallback(async (wsId: string, page: number) => {
    setAuditLoading(true)
    try {
      const data = await api.listAuditLogs(wsId, { page, limit: AUDIT_LIMIT })
      setLogs(data?.logs ?? [])
      setAuditTotal(data?.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
      setLogs([])
    } finally {
      setAuditLoading(false)
    }
  }, [])

  const loadWorkspaceData = useCallback(
    async (wsId: string) => {
      setError(null)
      try {
        const [r, p, rc, d] = await Promise.all([
          api.listReps(wsId),
          api.listPeriods(wsId),
          api.listReconciliations(wsId),
          api.listDisputes(wsId),
        ])
        setReps(r ?? [])
        setPeriods(p ?? [])
        setRecons(rc ?? [])
        setDisputes(d ?? [])
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load report inputs')
      }
      await loadAudit(wsId, 1)
      setAuditPage(1)
    },
    [loadAudit]
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
          setLoading(false)
          return
        }
        const stored = getActiveWorkspaceId()
        const active = (stored && ws.find((w) => w.id === stored)?.id) || ws[0].id
        if (active !== stored) setActiveWorkspaceId(active)
        setWorkspaceId(active)
        await loadWorkspaceData(active)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadWorkspaceData])

  const onSwitchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    setActiveWorkspaceId(id)
    setResult(null)
    setReportError(null)
    setLoading(true)
    await loadWorkspaceData(id)
    setLoading(false)
  }

  const runReport = async () => {
    setRunning(true)
    setReportError(null)
    setResult(null)
    try {
      let data: unknown
      if (kind === 'reconciliation') {
        if (!reconId) throw new Error('Select a reconciliation')
        data = await api.reportReconciliation(reconId)
      } else if (kind === 'dispute') {
        if (!disputeId) throw new Error('Select a dispute')
        data = await api.reportDispute(disputeId)
      } else if (kind === 'cost-of-error') {
        data = await api.reportCostOfError(workspaceId, { period_id: coePeriod || undefined })
      } else if (kind === 'statement') {
        if (!statementRep || !statementPeriod) throw new Error('Select a rep and a period')
        data = await api.reportStatement(workspaceId, statementRep, statementPeriod)
      } else {
        data = await api.reportAccrual(workspaceId, { period_id: accrualPeriod || undefined })
      }
      setResult(data)
    } catch (e) {
      setReportError(e instanceof Error ? e.message : 'Failed to generate report')
    } finally {
      setRunning(false)
    }
  }

  const downloadJson = () => {
    if (result == null) return
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${kind}-report-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadCsv = () => {
    // Best-effort CSV from a tabular result ({rows:[...]}) — falls back silently if not tabular.
    const rows = extractRows(result)
    if (!rows || rows.length === 0) return
    const cols = Array.from(
      rows.reduce((set, r) => {
        Object.keys(r).forEach((k) => set.add(k))
        return set
      }, new Set<string>())
    )
    const escape = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => escape(r[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${kind}-report-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const csvRows = useMemo(() => extractRows(result), [result])

  const runExplain = async () => {
    if (!explainRun || !explainLine) {
      setExplainError('Run id and line id are required')
      return
    }
    setExplainBusy(true)
    setExplainError(null)
    setExplainResult(null)
    try {
      const data = await api.explainNumber(explainRun.trim(), explainLine.trim())
      setExplainResult(data)
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : 'Failed to explain number')
    } finally {
      setExplainBusy(false)
    }
  }

  const filteredLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase()
    if (!q) return logs
    return logs.filter(
      (l) =>
        (l.actor ?? '').toLowerCase().includes(q) ||
        (l.entity_type ?? '').toLowerCase().includes(q) ||
        (l.entity_id ?? '').toLowerCase().includes(q) ||
        (l.action ?? '').toLowerCase().includes(q)
    )
  }, [logs, auditSearch])

  const totalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_LIMIT))

  const goPage = async (page: number) => {
    if (page < 1 || page > totalPages) return
    setAuditPage(page)
    await loadAudit(workspaceId, page)
  }

  if (loading) return <PageSpinner label="Loading reports..." />

  if (workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Reports &amp; Audit</h1>
        <EmptyState
          title="No workspace yet"
          description="Create a workspace to generate reports and view the audit log."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Reports &amp; Audit</h1>
          <p className="mt-1 text-sm text-slate-400">
            Generate finance-grade exports and trace every change in the workspace audit log.
          </p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={workspaceId}
            onChange={(e) => onSwitchWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
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

      {/* Export builder */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Exports Hub</h2>
          <p className="mt-1 text-sm text-slate-400">Pick a report type, set its inputs, and generate.</p>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {REPORT_DEFS.map((d) => (
              <button
                key={d.kind}
                onClick={() => {
                  setKind(d.kind)
                  setResult(null)
                  setReportError(null)
                }}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                  kind === d.kind
                    ? 'border-fuchsia-500 bg-fuchsia-500/10'
                    : 'border-slate-800 bg-slate-950 hover:border-slate-700'
                }`}
              >
                <div className="text-sm font-semibold text-white">{d.title}</div>
                <div className="mt-1 text-xs text-slate-500">{d.desc}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kind === 'reconciliation' && (
              <Field label="Reconciliation">
                <select
                  value={reconId}
                  onChange={(e) => setReconId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select reconciliation...</option>
                  {recons.map((r) => (
                    <option key={r.id} value={r.id}>
                      {periodLabel(periods, r.period_id)} · {r.status ?? 'open'} · {fmtCents(r.net_delta_cents)} ·{' '}
                      {new Date(r.created_at).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === 'dispute' && (
              <Field label="Dispute">
                <select
                  value={disputeId}
                  onChange={(e) => setDisputeId(e.target.value)}
                  className={selectClass}
                >
                  <option value="">Select dispute...</option>
                  {disputes.map((d) => (
                    <option key={d.id} value={d.id}>
                      {(d.narrative ?? 'Dispute').slice(0, 40)} · {d.status ?? 'open'} ·{' '}
                      {fmtCents(d.claimed_amount_cents)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === 'cost-of-error' && (
              <Field label="Period (optional)">
                <select value={coePeriod} onChange={(e) => setCoePeriod(e.target.value)} className={selectClass}>
                  <option value="">All periods</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {kind === 'statement' && (
              <>
                <Field label="Rep">
                  <select
                    value={statementRep}
                    onChange={(e) => setStatementRep(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select rep...</option>
                    {reps.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Period">
                  <select
                    value={statementPeriod}
                    onChange={(e) => setStatementPeriod(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select period...</option>
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            {kind === 'accrual' && (
              <Field label="Period (optional)">
                <select
                  value={accrualPeriod}
                  onChange={(e) => setAccrualPeriod(e.target.value)}
                  className={selectClass}
                >
                  <option value="">All periods</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runReport} disabled={running}>
              {running ? 'Generating...' : 'Generate Report'}
            </Button>
            {result != null && (
              <>
                <Button variant="secondary" onClick={downloadJson}>
                  Download JSON
                </Button>
                {csvRows && csvRows.length > 0 && (
                  <Button variant="secondary" onClick={downloadCsv}>
                    Download CSV ({csvRows.length} rows)
                  </Button>
                )}
              </>
            )}
          </div>

          {reportError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {reportError}
            </div>
          )}

          {result != null && (
            <div className="space-y-3">
              {csvRows && csvRows.length > 0 ? (
                <ResultTable rows={csvRows} />
              ) : (
                <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Explain a number */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-white">Explain a Number</h2>
          <p className="mt-1 text-sm text-slate-400">
            Decompose any payout amount by its derivation run id and line id.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Run ID">
              <input
                value={explainRun}
                onChange={(e) => setExplainRun(e.target.value)}
                placeholder="derivation run id"
                className={inputClass}
              />
            </Field>
            <Field label="Line ID">
              <input
                value={explainLine}
                onChange={(e) => setExplainLine(e.target.value)}
                placeholder="derivation line id"
                className={inputClass}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={runExplain} disabled={explainBusy}>
                {explainBusy ? 'Explaining...' : 'Explain'}
              </Button>
            </div>
          </div>
          {explainError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {explainError}
            </div>
          )}
          {explainResult != null && (
            <pre className="max-h-80 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(explainResult, null, 2)}
            </pre>
          )}
        </CardBody>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Audit Log</h2>
            <p className="mt-1 text-sm text-slate-400">Every create, update, and delete in this workspace.</p>
          </div>
          <input
            value={auditSearch}
            onChange={(e) => setAuditSearch(e.target.value)}
            placeholder="Filter actor, entity, action..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
          />
        </CardHeader>
        <CardBody className="p-0">
          {auditLoading ? (
            <div className="py-12">
              <Spinner label="Loading audit log..." />
            </div>
          ) : logs.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No audit entries" description="Activity will be recorded here as you make changes." />
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matches" description="No audit entries match your filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Actor</TH>
                  <TH>Entity</TH>
                  <TH>Action</TH>
                  <TH>Entity ID</TH>
                </TR>
              </THead>
              <TBody>
                {filteredLogs.map((l) => (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap text-slate-400">
                      {new Date(l.created_at).toLocaleString()}
                    </TD>
                    <TD className="text-slate-300">{l.actor || '—'}</TD>
                    <TD className="text-slate-300">{l.entity_type || '—'}</TD>
                    <TD>
                      <Badge tone={actionTone(l.action)}>{l.action || 'unknown'}</Badge>
                    </TD>
                    <TD className="font-mono text-xs text-slate-500">{l.entity_id || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
        {auditTotal > AUDIT_LIMIT && (
          <div className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-sm text-slate-400">
            <span>
              Page {auditPage} of {totalPages} · {auditTotal} entries
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="px-3 py-1 text-xs"
                onClick={() => goPage(auditPage - 1)}
                disabled={auditPage <= 1 || auditLoading}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                className="px-3 py-1 text-xs"
                onClick={() => goPage(auditPage + 1)}
                disabled={auditPage >= totalPages || auditLoading}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

const selectClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none'
const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none'

function periodLabel(periods: Period[], id: string | null): string {
  if (!id) return 'No period'
  return periods.find((p) => p.id === id)?.label ?? 'Period'
}

function extractRows(result: unknown): Record<string, unknown>[] | null {
  if (result == null || typeof result !== 'object') return null
  const obj = result as Record<string, unknown>
  if (Array.isArray(obj.rows) && obj.rows.every((r) => r && typeof r === 'object')) {
    return obj.rows as Record<string, unknown>[]
  }
  if (Array.isArray(result) && result.every((r) => r && typeof r === 'object')) {
    return result as Record<string, unknown>[]
  }
  return null
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Array.from(
    rows.reduce((set, r) => {
      Object.keys(r).forEach((k) => set.add(k))
      return set
    }, new Set<string>())
  )
  return (
    <Table>
      <THead>
        <TR>
          {cols.map((c) => (
            <TH key={c}>{c.replace(/_/g, ' ')}</TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {rows.slice(0, 200).map((r, i) => (
          <TR key={i}>
            {cols.map((c) => {
              const v = r[c]
              const display = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)
              return (
                <TD key={c} className="whitespace-nowrap">
                  {display}
                </TD>
              )
            })}
          </TR>
        ))}
      </TBody>
    </Table>
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
