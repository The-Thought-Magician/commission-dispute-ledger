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

interface SplitDeal {
  deal_id: string
  account_name?: string | null
  total: number // sum of split percentages
  ok: boolean
}

interface IntegrityResponse {
  deals?: SplitDeal[]
}

interface IntegritySummary {
  checked: number
  broken: number
  over: number
  under: number
}

function pct(total: number): string {
  return `${total.toFixed(1)}%`
}

function classify(total: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  if (Math.abs(total - 100) < 0.01) return { label: 'Balanced', tone: 'success' }
  if (total > 100) return { label: 'Over-credited', tone: 'danger' }
  return { label: 'Under-credited', tone: 'warning' }
}

export default function SplitsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')

  const [rows, setRows] = useState<SplitDeal[]>([])
  const [summary, setSummary] = useState<IntegritySummary | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'broken' | 'over' | 'under'>('all')

  const loadData = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const [integrity, sum] = await Promise.all([
        api.listSplitIntegrity(wsId) as Promise<IntegrityResponse>,
        api.getSplitIntegritySummary(wsId) as Promise<IntegritySummary>,
      ])
      setRows(integrity?.deals ?? [])
      setSummary(sum ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load split integrity')
      setRows([])
      setSummary(null)
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
        await loadData(active)
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
    setLoading(true)
    await loadData(id)
    setLoading(false)
  }

  const refresh = async () => {
    if (!workspaceId) return
    setLoading(true)
    await loadData(workspaceId)
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      const balanced = Math.abs(r.total - 100) < 0.01
      if (filter === 'broken' && balanced) return false
      if (filter === 'over' && r.total <= 100) return false
      if (filter === 'under' && r.total >= 100) return false
      if (!q) return true
      return (
        (r.account_name ?? '').toLowerCase().includes(q) || r.deal_id.toLowerCase().includes(q)
      )
    })
  }, [rows, search, filter])

  const computed = useMemo(() => {
    const checked = summary?.checked ?? rows.length
    const broken = summary?.broken ?? rows.filter((r) => Math.abs(r.total - 100) >= 0.01).length
    const over = summary?.over ?? rows.filter((r) => r.total > 100).length
    const under = summary?.under ?? rows.filter((r) => r.total < 100).length
    const rate = checked > 0 ? (broken / checked) * 100 : 0
    return { checked, broken, over, under, rate }
  }, [summary, rows])

  if (loading) return <PageSpinner label="Loading split integrity..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Split-Credit Reconciliation</h1>
          <p className="mt-1 text-sm text-slate-400">
            Every deal&apos;s credit splits should sum to exactly 100%. Deals that over- or under-credit signal
            payout errors.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button variant="secondary" onClick={refresh} disabled={!workspaceId}>
            Refresh
          </Button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace and add deals before reconciling splits."
          action={
            <Link href="/dashboard/workspaces">
              <Button variant="secondary">Go to Workspaces</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Deals Checked" value={computed.checked} />
            <Stat
              label="Broken Splits"
              value={computed.broken}
              tone={computed.broken ? 'danger' : 'success'}
              hint={`${computed.rate.toFixed(1)}% error rate`}
            />
            <Stat label="Over-credited" value={computed.over} tone={computed.over ? 'danger' : 'default'} />
            <Stat label="Under-credited" value={computed.under} tone={computed.under ? 'warning' : 'default'} />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Integrity bar */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-white">Integrity Overview</h2>
            </CardHeader>
            <CardBody>
              {computed.checked === 0 ? (
                <p className="text-sm text-slate-500">No deals to evaluate yet.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-800">
                    {(() => {
                      const balanced = Math.max(computed.checked - computed.broken, 0)
                      const seg = (n: number) => `${(n / computed.checked) * 100}%`
                      return (
                        <>
                          <div className="bg-fuchsia-500" style={{ width: seg(balanced) }} title={`${balanced} balanced`} />
                          <div className="bg-red-500" style={{ width: seg(computed.over) }} title={`${computed.over} over`} />
                          <div className="bg-amber-500" style={{ width: seg(computed.under) }} title={`${computed.under} under`} />
                        </>
                      )
                    })()}
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                    <LegendDot color="bg-fuchsia-500" label={`Balanced (${Math.max(computed.checked - computed.broken, 0)})`} />
                    <LegendDot color="bg-red-500" label={`Over-credited (${computed.over})`} />
                    <LegendDot color="bg-amber-500" label={`Under-credited (${computed.under})`} />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search deal or id..."
                  className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
                />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as typeof filter)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  <option value="all">All deals</option>
                  <option value="broken">Broken only</option>
                  <option value="over">Over-credited</option>
                  <option value="under">Under-credited</option>
                </select>
              </div>
              <span className="text-xs text-slate-500">
                {filtered.length} of {rows.length} shown
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {rows.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No deals to reconcile"
                    description="Add deals with credit assignments to evaluate split integrity."
                    action={
                      <Link href="/dashboard/deals">
                        <Button variant="secondary">Go to Deals</Button>
                      </Link>
                    }
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No matches" description="No deals match your search or filter." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Deal</TH>
                      <TH className="text-right">Split Total</TH>
                      <TH>Distribution</TH>
                      <TH>Classification</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => {
                      const c = classify(r.total)
                      const width = Math.min(Math.max(r.total, 0), 200) / 2 // 0-200% -> 0-100 px scale
                      return (
                        <TR key={r.deal_id}>
                          <TD className="font-medium text-slate-100">
                            {r.account_name || `Deal ${r.deal_id.slice(0, 8)}`}
                          </TD>
                          <TD className="text-right tabular-nums font-medium text-slate-100">{pct(r.total)}</TD>
                          <TD>
                            <div className="relative h-2.5 w-40 rounded-full bg-slate-800">
                              {/* 100% marker */}
                              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
                              <div
                                className={`h-2.5 rounded-full ${
                                  c.tone === 'success'
                                    ? 'bg-fuchsia-500'
                                    : c.tone === 'danger'
                                      ? 'bg-red-500'
                                      : 'bg-amber-500'
                                }`}
                                style={{ width: `${width}%` }}
                              />
                            </div>
                          </TD>
                          <TD>
                            <Badge tone={c.tone}>{c.label}</Badge>
                          </TD>
                          <TD className="text-right">
                            <Link href={`/dashboard/deals/${r.deal_id}`}>
                              <Button variant="ghost" className="px-2 py-1 text-xs">
                                Fix splits
                              </Button>
                            </Link>
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

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}
