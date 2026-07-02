'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

type Recon = {
  id: string
  workspace_id: string
  period_id: string | null
  derivation_run_id: string | null
  actual_run_id: string | null
  expected_total_cents: number
  actual_total_cents: number
  net_delta_cents: number
  tolerance_cents: number
  status: string
  created_at?: string
}

type ReconLine = {
  id: string
  rep_id: string | null
  deal_id: string | null
  expected_cents: number
  actual_cents: number
  delta_cents: number
  classification: string | null
}

const STATUSES = ['open', 'reviewed', 'accepted'] as const

function money(cents: number | null | undefined) {
  const n = (cents ?? 0) / 100
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function signedMoney(cents: number | null | undefined) {
  const n = cents ?? 0
  const s = money(Math.abs(n))
  if (n > 0) return `+${s}`
  if (n < 0) return `-${s}`
  return s
}

function deltaTone(cents: number, tolerance: number): 'success' | 'warning' | 'danger' {
  const abs = Math.abs(cents)
  if (abs === 0) return 'success'
  if (abs <= tolerance) return 'warning'
  return 'danger'
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' {
  if (status === 'accepted') return 'success'
  if (status === 'reviewed') return 'info'
  return 'warning'
}

function classificationTone(c: string | null): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch ((c || '').toLowerCase()) {
    case 'match':
    case 'matched':
    case 'ok':
      return 'success'
    case 'overpaid':
    case 'over':
      return 'danger'
    case 'underpaid':
    case 'under':
      return 'warning'
    case 'missing':
    case 'unexpected':
      return 'info'
    default:
      return 'neutral'
  }
}

export default function ReconciliationDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [recon, setRecon] = useState<Recon | null>(null)
  const [lines, setLines] = useState<ReconLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [savingStatus, setSavingStatus] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'mismatch' | 'within_tol' | 'out_of_tol'>('all')

  const [reportOpen, setReportOpen] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportData, setReportData] = useState<unknown>(null)
  const [reportErr, setReportErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getReconciliation(id)
      const r: Recon = res?.recon ?? res
      const l: ReconLine[] = res?.lines ?? []
      setRecon(r)
      setLines(Array.isArray(l) ? l : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reconciliation')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const changeStatus = async (status: string) => {
    if (!id) return
    setSavingStatus(true)
    setActionMsg(null)
    try {
      await api.setReconciliationStatus(id, { status })
      setRecon((prev) => (prev ? { ...prev, status } : prev))
      setActionMsg(`Status set to ${status}.`)
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to update status')
    } finally {
      setSavingStatus(false)
    }
  }

  const openReport = async () => {
    if (!id) return
    setReportOpen(true)
    setReportLoading(true)
    setReportErr(null)
    setReportData(null)
    try {
      const res = await api.reportReconciliation(id)
      setReportData(res)
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : 'Failed to build report')
    } finally {
      setReportLoading(false)
    }
  }

  const downloadReport = () => {
    if (reportData == null) return
    const rows = (reportData as { rows?: unknown }).rows ?? reportData
    let blob: Blob
    let filename: string
    if (Array.isArray(rows)) {
      const cols = Array.from(
        rows.reduce<Set<string>>((set, row) => {
          if (row && typeof row === 'object') Object.keys(row).forEach((k) => set.add(k))
          return set
        }, new Set<string>()),
      )
      const header = cols.join(',')
      const body = (rows as Record<string, unknown>[])
        .map((row) =>
          cols
            .map((c) => {
              const v = row[c]
              const s = v == null ? '' : String(v)
              return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
            })
            .join(','),
        )
        .join('\n')
      blob = new Blob([`${header}\n${body}`], { type: 'text/csv' })
      filename = `reconciliation-${id}.csv`
    } else {
      blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' })
      filename = `reconciliation-${id}.json`
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = useMemo(() => {
    const tol = recon?.tolerance_cents ?? 0
    const q = search.trim().toLowerCase()
    return lines.filter((ln) => {
      if (q) {
        const hay = `${ln.rep_id ?? ''} ${ln.deal_id ?? ''} ${ln.classification ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const abs = Math.abs(ln.delta_cents)
      if (filter === 'mismatch' && abs === 0) return false
      if (filter === 'within_tol' && !(abs > 0 && abs <= tol)) return false
      if (filter === 'out_of_tol' && !(abs > tol)) return false
      return true
    })
  }, [lines, search, filter, recon])

  const stats = useMemo(() => {
    let over = 0
    let under = 0
    let matched = 0
    let mismatched = 0
    for (const ln of lines) {
      if (ln.delta_cents > 0) over += ln.delta_cents
      else if (ln.delta_cents < 0) under += ln.delta_cents
      if (ln.delta_cents === 0) matched += 1
      else mismatched += 1
    }
    return { over, under, matched, mismatched }
  }, [lines])

  const maxAbsDelta = useMemo(
    () => Math.max(1, ...lines.map((l) => Math.abs(l.delta_cents))),
    [lines],
  )

  if (loading) return <PageSpinner label="Loading reconciliation..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/reconciliations" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to reconciliations
        </Link>
        <EmptyState
          title="Could not load reconciliation"
          description={error}
          action={<Button onClick={load}>Retry</Button>}
        />
      </div>
    )
  }

  if (!recon) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/reconciliations" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to reconciliations
        </Link>
        <EmptyState title="Reconciliation not found" />
      </div>
    )
  }

  const net = recon.net_delta_cents
  const withinTol = Math.abs(net) <= recon.tolerance_cents

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            href="/dashboard/reconciliations"
            className="text-sm text-fuchsia-400 hover:text-fuchsia-300"
          >
            ← Back to reconciliations
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold text-white">
            Reconciliation
            <Badge tone={statusTone(recon.status)}>{recon.status}</Badge>
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{recon.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={openReport}>
            Export report
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Expected" value={money(recon.expected_total_cents)} />
        <Stat label="Actual" value={money(recon.actual_total_cents)} />
        <Stat
          label="Net delta"
          value={signedMoney(net)}
          tone={net === 0 ? 'success' : withinTol ? 'warning' : 'danger'}
          hint={withinTol ? 'Within tolerance' : 'Exceeds tolerance'}
        />
        <Stat label="Tolerance" value={money(recon.tolerance_cents)} />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Lines matched" value={stats.matched} tone="success" />
        <Stat label="Lines mismatched" value={stats.mismatched} tone={stats.mismatched ? 'warning' : 'default'} />
        <Stat label="Total overpaid" value={money(stats.over)} tone={stats.over ? 'danger' : 'default'} />
        <Stat label="Total underpaid" value={money(Math.abs(stats.under))} tone={stats.under ? 'warning' : 'default'} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Status workflow</h2>
            <p className="text-sm text-slate-500">Move this reconciliation through review.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUSES.map((s) => (
              <Button
                key={s}
                variant={recon.status === s ? 'primary' : 'secondary'}
                disabled={savingStatus || recon.status === s}
                onClick={() => changeStatus(s)}
              >
                {s}
              </Button>
            ))}
            {savingStatus && <Spinner />}
          </div>
        </CardHeader>
        {actionMsg && (
          <CardBody className="border-t border-slate-800 py-3 text-sm text-slate-300">{actionMsg}</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Line-by-line deltas</h2>
            <p className="text-sm text-slate-500">{lines.length} line(s) compared expected vs actual.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search rep / deal / class…"
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="all">All lines</option>
              <option value="mismatch">Mismatches only</option>
              <option value="within_tol">Within tolerance</option>
              <option value="out_of_tol">Out of tolerance</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={lines.length === 0 ? 'No reconciliation lines' : 'No lines match your filters'}
                description={
                  lines.length === 0
                    ? 'This reconciliation produced no per-line deltas.'
                    : 'Adjust the search or filter to see more lines.'
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rep</TH>
                  <TH>Deal</TH>
                  <TH className="text-right">Expected</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">Delta</TH>
                  <TH>Magnitude</TH>
                  <TH>Classification</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((ln) => {
                  const tone = deltaTone(ln.delta_cents, recon.tolerance_cents)
                  const pct = Math.round((Math.abs(ln.delta_cents) / maxAbsDelta) * 100)
                  const barColor =
                    tone === 'success' ? 'bg-fuchsia-500' : tone === 'warning' ? 'bg-amber-500' : 'bg-red-500'
                  return (
                    <TR key={ln.id}>
                      <TD className="font-mono text-xs text-slate-400">{ln.rep_id ?? '—'}</TD>
                      <TD className="font-mono text-xs text-slate-400">{ln.deal_id ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{money(ln.expected_cents)}</TD>
                      <TD className="text-right tabular-nums">{money(ln.actual_cents)}</TD>
                      <TD
                        className={`text-right font-medium tabular-nums ${
                          ln.delta_cents === 0
                            ? 'text-slate-400'
                            : tone === 'danger'
                              ? 'text-red-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {signedMoney(ln.delta_cents)}
                      </TD>
                      <TD>
                        <div className="h-2 w-28 overflow-hidden rounded-full bg-slate-800">
                          <div className={`h-full ${barColor}`} style={{ width: `${pct}%` }} />
                        </div>
                      </TD>
                      <TD>
                        <Badge tone={classificationTone(ln.classification)}>
                          {ln.classification ?? (ln.delta_cents === 0 ? 'match' : 'delta')}
                        </Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Reconciliation report"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReportOpen(false)}>
              Close
            </Button>
            <Button onClick={downloadReport} disabled={reportData == null}>
              Download
            </Button>
          </>
        }
      >
        {reportLoading ? (
          <Spinner label="Building report…" />
        ) : reportErr ? (
          <p className="text-sm text-red-400">{reportErr}</p>
        ) : (
          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">
            {JSON.stringify(reportData, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}
