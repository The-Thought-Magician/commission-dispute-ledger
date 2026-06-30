'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Period {
  id: string
  label: string
}

interface Rep {
  id: string
  name: string
}

interface CostOfError {
  overpaid: number
  underpaid: number
  error_rate: number
  by_type?: Record<string, number> | { type: string; amount: number }[]
}

interface TrendPoint {
  period: string
  error_rate: number
  net_delta: number
}

interface QuotaRow {
  rep_id: string
  quota_cents: number
  attainment_pct: number
  attained_cents?: number
}

interface LeaderRow {
  rep_id: string
  name?: string
  attainment_pct: number
  quota_cents?: number
  attained_cents?: number
}

function dollars(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function normalizeByType(by: CostOfError['by_type']): { type: string; amount: number }[] {
  if (!by) return []
  if (Array.isArray(by)) return by
  return Object.entries(by).map(([type, amount]) => ({ type, amount: Number(amount) }))
}

export default function CostOfErrorPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [periods, setPeriods] = useState<Period[]>([])
  const [periodId, setPeriodId] = useState('')

  const [coe, setCoe] = useState<CostOfError | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [quota, setQuota] = useState<QuotaRow[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([])
  const [reps, setReps] = useState<Rep[]>([])

  const [exporting, setExporting] = useState(false)
  const [exportRows, setExportRows] = useState<Record<string, unknown>[] | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const repName = useCallback(
    (id: string) => reps.find((r) => r.id === id)?.name ?? `Rep ${id.slice(0, 8)}`,
    [reps],
  )

  const loadData = useCallback(async (wsId: string, pId: string) => {
    setError(null)
    try {
      const opts = pId ? { period_id: pId } : undefined
      const [coeRes, trendRes, quotaRes, lbRes, repsRes] = await Promise.all([
        api.getCostOfError(wsId, opts) as Promise<CostOfError>,
        api.getCostOfErrorTrend(wsId) as Promise<{ points?: TrendPoint[] }>,
        api.getQuota(wsId, opts) as Promise<{ rows?: QuotaRow[] }>,
        api.getQuotaLeaderboard(wsId, opts) as Promise<LeaderRow[] | { rows?: LeaderRow[] }>,
        api.listReps(wsId) as Promise<Rep[]>,
      ])
      setCoe(coeRes ?? null)
      setTrend(trendRes?.points ?? [])
      setQuota(quotaRes?.rows ?? [])
      setLeaderboard(Array.isArray(lbRes) ? lbRes : (lbRes?.rows ?? []))
      setReps(repsRes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cost-of-error report')
      setCoe(null)
      setTrend([])
      setQuota([])
      setLeaderboard([])
    }
  }, [])

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
        const ps: Period[] = (await api.listPeriods(active)) ?? []
        if (!mounted) return
        setPeriods(ps)
        await loadData(active, '')
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadData])

  const onSwitchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    setActiveWorkspaceId(id)
    setPeriodId('')
    setExportRows(null)
    setLoading(true)
    const ps: Period[] = (await api.listPeriods(id)) ?? []
    setPeriods(ps)
    await loadData(id, '')
    setLoading(false)
  }

  const onSwitchPeriod = async (id: string) => {
    setPeriodId(id)
    setExportRows(null)
    setLoading(true)
    await loadData(workspaceId, id)
    setLoading(false)
  }

  const runExport = async () => {
    setExporting(true)
    setExportError(null)
    try {
      const res = await api.reportCostOfError(workspaceId, periodId ? { period_id: periodId } : undefined)
      const rows = (res?.rows ?? []) as Record<string, unknown>[]
      setExportRows(rows)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Failed to build export')
    } finally {
      setExporting(false)
    }
  }

  const downloadCsv = () => {
    if (!exportRows || exportRows.length === 0) return
    const cols = Array.from(new Set(exportRows.flatMap((r) => Object.keys(r))))
    const esc = (v: unknown) => {
      const s = v == null ? '' : String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [cols.join(','), ...exportRows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `cost-of-error-${periodId || 'all'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const byType = useMemo(() => normalizeByType(coe?.by_type), [coe])
  const byTypeMax = useMemo(() => Math.max(1, ...byType.map((b) => Math.abs(b.amount))), [byType])

  const netDelta = useMemo(() => (coe ? coe.overpaid - coe.underpaid : 0), [coe])

  const trendMax = useMemo(
    () => Math.max(0.01, ...trend.map((t) => Math.abs(t.error_rate))),
    [trend],
  )

  if (loading) return <PageSpinner label="Loading cost-of-error report..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Cost of Error</h1>
          <p className="mt-1 text-sm text-slate-400">
            What commission mistakes actually cost: overpayments, clawback exposure, and how it trends against
            quota attainment.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <select
            value={periodId}
            onChange={(e) => onSwitchPeriod(e.target.value)}
            disabled={!workspaceId}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
          >
            <option value="">All periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <Button onClick={runExport} disabled={!workspaceId || exporting}>
            {exporting ? 'Building...' : 'Export'}
          </Button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace and run reconciliations to measure cost of error."
          action={
            <Link href="/dashboard/workspaces">
              <Button variant="secondary">Go to Workspaces</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Overpaid" value={dollars(coe?.overpaid)} tone="danger" />
            <Stat label="Underpaid" value={dollars(coe?.underpaid)} tone="warning" />
            <Stat label="Net Delta" value={dollars(netDelta)} tone={netDelta >= 0 ? 'danger' : 'success'} />
            <Stat
              label="Error Rate"
              value={`${((coe?.error_rate ?? 0) * (coe && coe.error_rate <= 1 ? 100 : 1)).toFixed(1)}%`}
              tone={(coe?.error_rate ?? 0) > 0 ? 'warning' : 'success'}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {exportError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {exportError}
            </div>
          )}

          {exportRows && (
            <Card>
              <CardHeader className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white">
                  Export Preview ({exportRows.length} rows)
                </h2>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={downloadCsv} disabled={exportRows.length === 0}>
                    Download CSV
                  </Button>
                  <Button variant="ghost" onClick={() => setExportRows(null)}>
                    Dismiss
                  </Button>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                {exportRows.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="Nothing to export" description="No cost-of-error rows for this scope." />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        {Object.keys(exportRows[0]).map((k) => (
                          <TH key={k}>{k}</TH>
                        ))}
                      </TR>
                    </THead>
                    <TBody>
                      {exportRows.slice(0, 50).map((row, i) => (
                        <TR key={i}>
                          {Object.keys(exportRows[0]).map((k) => (
                            <TD key={k} className="tabular-nums text-slate-300">
                              {String(row[k] ?? '—')}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* By type breakdown */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Error by Type</h2>
              </CardHeader>
              <CardBody>
                {byType.length === 0 ? (
                  <p className="text-sm text-slate-500">No error breakdown available.</p>
                ) : (
                  <div className="space-y-3">
                    {byType.map((b) => (
                      <div key={b.type}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="capitalize text-slate-300">{b.type.replace(/_/g, ' ')}</span>
                          <span className="tabular-nums text-slate-400">{dollars(b.amount)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                          <div
                            className="h-2 rounded-full bg-emerald-500"
                            style={{ width: `${(Math.abs(b.amount) / byTypeMax) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Trend chart (SVG) */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-white">Error-Rate Trend</h2>
              </CardHeader>
              <CardBody>
                {trend.length === 0 ? (
                  <p className="text-sm text-slate-500">No trend data across periods yet.</p>
                ) : (
                  <TrendChart trend={trend} max={trendMax} />
                )}
              </CardBody>
            </Card>
          </div>

          {/* Quota attainment */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Quota & Attainment</h2>
              <span className="text-xs text-slate-500">{quota.length} reps</span>
            </CardHeader>
            <CardBody className="p-0">
              {quota.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No quota assignments"
                    description="Assign plans and quotas to reps to track attainment."
                    action={
                      <Link href="/dashboard/reps">
                        <Button variant="secondary">Go to Reps</Button>
                      </Link>
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Rep</TH>
                      <TH className="text-right">Quota</TH>
                      <TH className="text-right">Attainment</TH>
                      <TH>Progress</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {quota.map((q) => {
                      const attPct = q.attainment_pct <= 1 ? q.attainment_pct * 100 : q.attainment_pct
                      const tone =
                        attPct >= 100 ? 'text-emerald-300' : attPct >= 70 ? 'text-amber-300' : 'text-red-300'
                      return (
                        <TR key={q.rep_id}>
                          <TD className="font-medium text-slate-100">{repName(q.rep_id)}</TD>
                          <TD className="text-right tabular-nums text-slate-400">{dollars(q.quota_cents)}</TD>
                          <TD className={`text-right tabular-nums font-medium ${tone}`}>
                            {attPct.toFixed(1)}%
                          </TD>
                          <TD>
                            <div className="h-2 w-40 overflow-hidden rounded-full bg-slate-800">
                              <div
                                className={`h-2 rounded-full ${
                                  attPct >= 100
                                    ? 'bg-emerald-500'
                                    : attPct >= 70
                                      ? 'bg-amber-500'
                                      : 'bg-red-500'
                                }`}
                                style={{ width: `${Math.min(attPct, 100)}%` }}
                              />
                            </div>
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Leaderboard */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Attainment Leaderboard</h2>
            </CardHeader>
            <CardBody className="p-0">
              {leaderboard.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No leaderboard yet" description="Reps with quota attainment will rank here." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="w-12">#</TH>
                      <TH>Rep</TH>
                      <TH className="text-right">Quota</TH>
                      <TH className="text-right">Attainment</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {leaderboard.map((l, i) => {
                      const attPct = l.attainment_pct <= 1 ? l.attainment_pct * 100 : l.attainment_pct
                      return (
                        <TR key={l.rep_id}>
                          <TD>
                            <Badge tone={i === 0 ? 'success' : i < 3 ? 'info' : 'neutral'}>#{i + 1}</Badge>
                          </TD>
                          <TD className="font-medium text-slate-100">{l.name || repName(l.rep_id)}</TD>
                          <TD className="text-right tabular-nums text-slate-400">
                            {l.quota_cents != null ? dollars(l.quota_cents) : '—'}
                          </TD>
                          <TD className="text-right tabular-nums font-medium text-emerald-300">
                            {attPct.toFixed(1)}%
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function TrendChart({ trend, max }: { trend: TrendPoint[]; max: number }) {
  const W = 520
  const H = 160
  const pad = { l: 8, r: 8, t: 12, b: 24 }
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b
  const n = trend.length
  const x = (i: number) => pad.l + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW)
  const rate = (t: TrendPoint) => (t.error_rate <= 1 ? t.error_rate * 100 : t.error_rate)
  const scaledMax = max <= 1 ? max * 100 : max
  const y = (v: number) => pad.t + innerH - (v / (scaledMax || 1)) * innerH

  const points = trend.map((t, i) => `${x(i)},${y(rate(t))}`).join(' ')

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full min-w-[420px]" preserveAspectRatio="none">
        {/* gridlines */}
        {[0, 0.5, 1].map((g) => (
          <line
            key={g}
            x1={pad.l}
            x2={W - pad.r}
            y1={pad.t + innerH * (1 - g)}
            y2={pad.t + innerH * (1 - g)}
            stroke="#1e293b"
            strokeWidth={1}
          />
        ))}
        {/* area */}
        <polyline
          points={`${pad.l},${pad.t + innerH} ${points} ${pad.l + innerW},${pad.t + innerH}`}
          fill="rgba(16,185,129,0.12)"
          stroke="none"
        />
        {/* line */}
        <polyline points={points} fill="none" stroke="#10b981" strokeWidth={2} />
        {/* dots */}
        {trend.map((t, i) => (
          <circle key={i} cx={x(i)} cy={y(rate(t))} r={3} fill="#10b981" />
        ))}
        {/* x labels */}
        {trend.map((t, i) => (
          <text
            key={`l${i}`}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            fontSize={9}
            fill="#64748b"
          >
            {t.period.length > 8 ? t.period.slice(0, 8) : t.period}
          </text>
        ))}
      </svg>
    </div>
  )
}
