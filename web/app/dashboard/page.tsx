'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Workspace = {
  id: string
  name: string
  currency?: string
}

type DashboardData = {
  net_delta?: number
  recoverable?: number
  open_disputes?: number
  error_rate?: number
  recent?: RecentItem[]
}

type RecentItem = {
  id?: string
  kind?: string
  title?: string
  body?: string
  created_at?: string
  amount_cents?: number
}

type CostOfError = {
  overpaid?: number
  underpaid?: number
  error_rate?: number
  by_type?: Record<string, number> | Array<{ type: string; amount_cents: number; count?: number }>
}

type TrendPoint = {
  period?: string
  error_rate?: number
  net_delta?: number
}

function centsToCurrency(cents: number | undefined | null, currency = 'USD'): string {
  const v = typeof cents === 'number' ? cents : 0
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(v / 100)
  } catch {
    return `$${(v / 100).toFixed(0)}`
  }
}

function pct(n: number | undefined | null): string {
  const v = typeof n === 'number' ? n : 0
  // accept either a fraction (0.12) or a whole percent (12)
  const asPct = v > 0 && v <= 1 ? v * 100 : v
  return `${asPct.toFixed(1)}%`
}

function relativeTime(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function normalizeByType(
  byType: CostOfError['by_type'],
): Array<{ type: string; amount_cents: number; count?: number }> {
  if (!byType) return []
  if (Array.isArray(byType)) return byType
  return Object.entries(byType).map(([type, amount_cents]) => ({
    type,
    amount_cents: Number(amount_cents) || 0,
  }))
}

export default function DashboardHome() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [cost, setCost] = useState<CostOfError | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])

  const activeWorkspace = useMemo(
    () => workspaces.find((w) => w.id === activeId) ?? null,
    [workspaces, activeId],
  )
  const currency = activeWorkspace?.currency || 'USD'

  const loadWorkspaceData = useCallback(async (wsId: string) => {
    // dashboard + cost-of-error are public reads; trend is best-effort.
    const [dash, costRes, trendRes] = await Promise.allSettled([
      api.getDashboard(wsId),
      api.getCostOfError(wsId),
      api.getCostOfErrorTrend(wsId),
    ])
    setDashboard(dash.status === 'fulfilled' ? (dash.value as DashboardData) : null)
    setCost(costRes.status === 'fulfilled' ? (costRes.value as CostOfError) : null)
    if (trendRes.status === 'fulfilled') {
      const points = (trendRes.value as { points?: TrendPoint[] })?.points ?? []
      setTrend(Array.isArray(points) ? points : [])
    } else {
      setTrend([])
    }
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = (await api.listWorkspaces()) as Workspace[]
      const ws = Array.isArray(list) ? list : []
      setWorkspaces(ws)

      if (ws.length === 0) {
        setActiveId(null)
        setLoading(false)
        return
      }

      const stored = getActiveWorkspaceId()
      const chosen = ws.find((w) => w.id === stored)?.id ?? ws[0].id
      setActiveId(chosen)
      setActiveWorkspaceId(chosen)
      await loadWorkspaceData(chosen)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [loadWorkspaceData])

  useEffect(() => {
    init()
  }, [init])

  const switchWorkspace = useCallback(
    async (id: string) => {
      setActiveId(id)
      setActiveWorkspaceId(id)
      setLoading(true)
      setError(null)
      try {
        await loadWorkspaceData(id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load workspace')
      } finally {
        setLoading(false)
      }
    },
    [loadWorkspaceData],
  )

  if (loading && workspaces.length === 0) {
    return <PageSpinner label="Loading dashboard…" />
  }

  if (error && !dashboard) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <Card>
          <CardBody>
            <div className="text-sm text-red-300">{error}</div>
            <Button className="mt-4" variant="secondary" onClick={init}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <EmptyState
          icon="🗂"
          title="No workspaces yet"
          description="Create your first workspace or load demo data to start auditing commission payouts."
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to Workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const netDelta = dashboard?.net_delta ?? 0
  const recoverable = dashboard?.recoverable ?? 0
  const openDisputes = dashboard?.open_disputes ?? 0
  const errorRate = dashboard?.error_rate ?? cost?.error_rate ?? 0
  const recent = dashboard?.recent ?? []
  const byType = normalizeByType(cost?.by_type)

  // Trend chart geometry (simple inline SVG, no chart lib).
  const trendVals = trend.map((p) => Math.abs(p.error_rate ?? 0))
  const maxTrend = Math.max(0.0001, ...trendVals)
  const chartW = 640
  const chartH = 160
  const padX = 8
  const padY = 12
  const stepX = trend.length > 1 ? (chartW - padX * 2) / (trend.length - 1) : 0
  const points = trend.map((p, i) => {
    const x = padX + i * stepX
    const norm = Math.abs(p.error_rate ?? 0) / maxTrend
    const y = chartH - padY - norm * (chartH - padY * 2)
    return { x, y, p }
  })
  const linePath = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ')
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${chartH - padY} L ${points[0].x.toFixed(
          1,
        )} ${chartH - padY} Z`
      : ''

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Commission audit overview for{' '}
            <span className="text-emerald-300">{activeWorkspace?.name ?? 'workspace'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs uppercase tracking-wide text-slate-500">Workspace</label>
          <select
            value={activeId ?? ''}
            onChange={(e) => switchWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Net delta"
          value={centsToCurrency(netDelta, currency)}
          hint="Expected vs actual across reconciled periods"
          tone={netDelta === 0 ? 'default' : netDelta > 0 ? 'warning' : 'danger'}
        />
        <Stat
          label="Recoverable"
          value={centsToCurrency(recoverable, currency)}
          hint="Overpayments eligible for clawback"
          tone={recoverable > 0 ? 'success' : 'default'}
        />
        <Stat
          label="Open disputes"
          value={openDisputes}
          hint="Cases awaiting resolution"
          tone={openDisputes > 0 ? 'warning' : 'default'}
        />
        <Stat
          label="Error rate"
          value={pct(errorRate)}
          hint="Share of payout dollars in error"
          tone={errorRate > 0 ? 'danger' : 'success'}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Error-rate trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-white">Error-rate trend</h2>
              <p className="text-xs text-slate-500">Across periods (latest on the right)</p>
            </div>
            <Link href="/dashboard/cost-of-error" className="text-xs text-emerald-400 hover:text-emerald-300">
              Cost of error →
            </Link>
          </CardHeader>
          <CardBody>
            {trend.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No trend data yet. Run reconciliations across periods to populate this chart.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="w-full overflow-x-auto">
                  <svg
                    viewBox={`0 0 ${chartW} ${chartH}`}
                    className="h-40 w-full min-w-[480px]"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {areaPath && <path d={areaPath} fill="url(#trendFill)" />}
                    {linePath && (
                      <path d={linePath} fill="none" stroke="rgb(16 185 129)" strokeWidth="2" />
                    )}
                    {points.map((pt, i) => (
                      <circle key={i} cx={pt.x} cy={pt.y} r="3" fill="rgb(52 211 153)" />
                    ))}
                  </svg>
                </div>
                <div className="flex justify-between text-[10px] text-slate-500">
                  {points.map((pt, i) => (
                    <span key={i} className="truncate" title={pt.p.period}>
                      {pt.p.period ?? `P${i + 1}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Cost-of-error breakdown */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Cost of error</h2>
            <p className="text-xs text-slate-500">Current period breakdown</p>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3">
                <div className="text-xs text-slate-500">Overpaid</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-amber-400">
                  {centsToCurrency(cost?.overpaid, currency)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-3">
                <div className="text-xs text-slate-500">Underpaid</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-red-400">
                  {centsToCurrency(cost?.underpaid, currency)}
                </div>
              </div>
            </div>
            {byType.length > 0 ? (
              <div className="space-y-2">
                {(() => {
                  const maxAmt = Math.max(1, ...byType.map((b) => Math.abs(b.amount_cents)))
                  return byType.map((b) => (
                    <div key={b.type}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="capitalize text-slate-300">{b.type.replace(/_/g, ' ')}</span>
                        <span className="tabular-nums text-slate-400">
                          {centsToCurrency(b.amount_cents, currency)}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-emerald-500/70"
                          style={{ width: `${(Math.abs(b.amount_cents) / maxAmt) * 100}%` }}
                        />
                      </div>
                    </div>
                  ))
                })()}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No error breakdown available yet.</p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Recent activity</h2>
            <p className="text-xs text-slate-500">Latest events in this workspace</p>
          </div>
          <Link href="/dashboard/reports" className="text-xs text-emerald-400 hover:text-emerald-300">
            Audit log →
          </Link>
        </CardHeader>
        <CardBody>
          {recent.length === 0 ? (
            <EmptyState
              icon="🕓"
              title="No recent activity"
              description="Once you import deals, run derivations, or open disputes, activity will appear here."
            />
          ) : (
            <ul className="divide-y divide-slate-800">
              {recent.slice(0, 12).map((item, i) => (
                <li key={item.id ?? i} className="flex items-start justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {item.kind && (
                        <Badge tone="info" className="capitalize">
                          {item.kind.replace(/_/g, ' ')}
                        </Badge>
                      )}
                      <span className="truncate text-sm font-medium text-slate-200">
                        {item.title ?? item.kind ?? 'Event'}
                      </span>
                    </div>
                    {item.body && <p className="mt-1 truncate text-xs text-slate-500">{item.body}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    {typeof item.amount_cents === 'number' && (
                      <div className="text-sm font-semibold tabular-nums text-slate-200">
                        {centsToCurrency(item.amount_cents, currency)}
                      </div>
                    )}
                    <div className="text-xs text-slate-500">{relativeTime(item.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Reconciliations', href: '/dashboard/reconciliations' },
          { label: 'Disputes', href: '/dashboard/disputes' },
          { label: 'Deals', href: '/dashboard/deals' },
          { label: 'Plans', href: '/dashboard/plans' },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-white"
          >
            {l.label} →
          </Link>
        ))}
      </div>
    </div>
  )
}
