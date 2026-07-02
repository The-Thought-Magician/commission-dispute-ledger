'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type AnyRecord = Record<string, any>

const money = (cents: unknown) => {
  const n = typeof cents === 'number' ? cents : Number(cents)
  if (!Number.isFinite(n)) return '$0.00'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100)
}

const pct = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = (status || '').toLowerCase()
  if (s === 'complete' || s === 'completed' || s === 'done') return 'success'
  if (s === 'running' || s === 'pending') return 'warning'
  if (s === 'failed' || s === 'error') return 'danger'
  return 'info'
}

export default function DerivationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<AnyRecord | null>(null)
  const [lines, setLines] = useState<AnyRecord[]>([])

  const [search, setSearch] = useState('')
  const [componentFilter, setComponentFilter] = useState('')

  const [explainOpen, setExplainOpen] = useState(false)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)
  const [explainLine, setExplainLine] = useState<AnyRecord | null>(null)
  const [explainData, setExplainData] = useState<AnyRecord | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getDerivation(id)
      setRun(data?.run ?? null)
      setLines(Array.isArray(data?.lines) ? data.lines : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load derivation run')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const openExplain = async (line: AnyRecord) => {
    setExplainOpen(true)
    setExplainLine(line)
    setExplainData(null)
    setExplainError(null)
    setExplainLoading(true)
    try {
      const data = await api.explainDerivationLine(id, line.id)
      setExplainData(data ?? null)
    } catch (e) {
      setExplainError(e instanceof Error ? e.message : 'Failed to explain line')
    } finally {
      setExplainLoading(false)
    }
  }

  const components = useMemo(() => {
    const set = new Set<string>()
    for (const l of lines) if (l.component) set.add(String(l.component))
    return Array.from(set).sort()
  }, [lines])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines.filter((l) => {
      if (componentFilter && String(l.component) !== componentFilter) return false
      if (!q) return true
      const hay = [
        l.rep_name,
        l.rep_id,
        l.deal_name,
        l.account_name,
        l.deal_id,
        l.component,
      ]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [lines, search, componentFilter])

  const totals = useMemo(() => {
    const lineTotal = filtered.reduce((acc, l) => acc + num(l.amount_cents), 0)
    const allTotal = lines.reduce((acc, l) => acc + num(l.amount_cents), 0)
    const expected = num(run?.expected_total_cents)
    return { lineTotal, allTotal, expected }
  }, [filtered, lines, run])

  // Per-component breakdown for the simple SVG/bar chart
  const componentBreakdown = useMemo(() => {
    const map = new Map<string, number>()
    for (const l of lines) {
      const key = String(l.component ?? 'other')
      map.set(key, (map.get(key) ?? 0) + num(l.amount_cents))
    }
    const rows = Array.from(map.entries()).map(([component, amount]) => ({ component, amount }))
    rows.sort((a, b) => b.amount - a.amount)
    const max = rows.reduce((m, r) => Math.max(m, Math.abs(r.amount)), 0) || 1
    return { rows, max }
  }, [lines])

  if (loading) return <PageSpinner label="Loading derivation run..." />

  if (error) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="Could not load derivation run"
          description={error}
          action={
            <div className="flex gap-2">
              <Button onClick={load}>Retry</Button>
              <Link href="/dashboard/derivations">
                <Button variant="secondary">Back to runs</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  if (!run) {
    return (
      <div className="mx-auto max-w-2xl py-12">
        <EmptyState
          title="Derivation run not found"
          description="This run may have been deleted."
          action={
            <Link href="/dashboard/derivations">
              <Button variant="secondary">Back to runs</Button>
            </Link>
          }
        />
      </div>
    )
  }

  const reconcileDelta = totals.allTotal - totals.expected

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/dashboard/derivations" className="hover:text-fuchsia-400">
              Derivations
            </Link>
            <span>/</span>
            <span className="font-mono">{String(run.id).slice(0, 8)}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">Calculation breakdown</h1>
          <p className="mt-1 text-sm text-slate-400">
            Decomposed re-derivation showing every component, tier, rate and multiplier applied.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(String(run.status ?? ''))}>{run.status ?? 'unknown'}</Badge>
          <Button variant="secondary" onClick={load}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Expected total" value={money(run.expected_total_cents)} />
        <Stat
          label="Sum of lines"
          value={money(totals.allTotal)}
          hint={`${lines.length} line${lines.length === 1 ? '' : 's'}`}
        />
        <Stat
          label="Line vs expected"
          value={money(reconcileDelta)}
          tone={reconcileDelta === 0 ? 'success' : Math.abs(reconcileDelta) > 0 ? 'warning' : 'default'}
          hint={reconcileDelta === 0 ? 'Balanced' : 'Recomputed delta'}
        />
        <Stat label="Components" value={componentBreakdown.rows.length} hint={components.join(', ') || '—'} />
      </div>

      {/* Run meta + component chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Run details</h2>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            <MetaRow label="Run ID" value={<span className="font-mono text-xs">{run.id}</span>} />
            <MetaRow label="Period" value={run.period_label ?? run.period_id ?? '—'} />
            <MetaRow
              label="Plan version"
              value={run.plan_version_label ?? run.plan_version_id ?? '—'}
            />
            <MetaRow
              label="Inputs hash"
              value={<span className="font-mono text-xs">{run.inputs_hash ?? '—'}</span>}
            />
            <MetaRow label="Created by" value={run.created_by ?? '—'} />
            <MetaRow
              label="Created"
              value={run.created_at ? new Date(run.created_at).toLocaleString() : '—'}
            />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="text-sm font-semibold text-white">Payout by component</h2>
          </CardHeader>
          <CardBody>
            {componentBreakdown.rows.length === 0 ? (
              <p className="text-sm text-slate-500">No component data.</p>
            ) : (
              <div className="space-y-3">
                {componentBreakdown.rows.map((r) => {
                  const width = Math.max(2, (Math.abs(r.amount) / componentBreakdown.max) * 100)
                  return (
                    <div key={r.component}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-300">{r.component}</span>
                        <span className="tabular-nums text-slate-400">{money(r.amount)}</span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            r.amount < 0 ? 'bg-red-500/70' : 'bg-fuchsia-500/80'
                          }`}
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rep, deal, account, component..."
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-fuchsia-500 focus:outline-none sm:max-w-xs"
        />
        <select
          value={componentFilter}
          onChange={(e) => setComponentFilter(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
        >
          <option value="">All components</option>
          {components.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <div className="text-xs text-slate-500 sm:ml-auto">
          Showing {filtered.length} of {lines.length} lines · {money(totals.lineTotal)}
        </div>
      </div>

      {/* Lines table */}
      {lines.length === 0 ? (
        <EmptyState
          title="No derivation lines"
          description="This run produced no decomposed lines."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No lines match your filters" description="Try clearing the search or component filter." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Rep</TH>
              <TH>Deal / Account</TH>
              <TH>Component</TH>
              <TH className="text-right">Split %</TH>
              <TH>Tier</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Multiplier</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Explain</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((l) => (
              <TR key={l.id}>
                <TD>{l.rep_name ?? l.rep_id ?? '—'}</TD>
                <TD>
                  <div className="text-slate-200">{l.deal_name ?? l.account_name ?? '—'}</div>
                  {l.deal_id && (
                    <div className="font-mono text-[10px] text-slate-500">
                      {String(l.deal_id).slice(0, 8)}
                    </div>
                  )}
                </TD>
                <TD>
                  <Badge tone="neutral">{l.component ?? '—'}</Badge>
                </TD>
                <TD className="text-right tabular-nums">
                  {l.split_pct != null ? pct(l.split_pct) : '—'}
                </TD>
                <TD>{l.tier_applied ?? '—'}</TD>
                <TD className="text-right tabular-nums">
                  {l.rate_applied != null ? pct(l.rate_applied) : '—'}
                </TD>
                <TD className="text-right tabular-nums">
                  {l.multiplier_applied != null ? `${num(l.multiplier_applied).toFixed(2)}×` : '—'}
                </TD>
                <TD className="text-right font-medium tabular-nums text-white">
                  {money(l.amount_cents)}
                </TD>
                <TD className="text-right">
                  <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openExplain(l)}>
                    Explain
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Explain modal */}
      <Modal
        open={explainOpen}
        onClose={() => setExplainOpen(false)}
        title="Line explanation"
        footer={
          <Button variant="secondary" onClick={() => setExplainOpen(false)}>
            Close
          </Button>
        }
      >
        {explainLine && (
          <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">Rep</div>
              <div className="text-slate-200">{explainLine.rep_name ?? explainLine.rep_id ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Component</div>
              <div className="text-slate-200">{explainLine.component ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Amount</div>
              <div className="font-medium text-white">{money(explainLine.amount_cents)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Rate / Mult</div>
              <div className="text-slate-200">
                {explainLine.rate_applied != null ? pct(explainLine.rate_applied) : '—'} ·{' '}
                {explainLine.multiplier_applied != null
                  ? `${num(explainLine.multiplier_applied).toFixed(2)}×`
                  : '—'}
              </div>
            </div>
          </div>
        )}

        {explainLoading ? (
          <div className="py-8">
            <PageSpinner label="Computing explanation..." />
          </div>
        ) : explainError ? (
          <p className="text-sm text-red-400">{explainError}</p>
        ) : explainData ? (
          <ExplainView data={explainData} />
        ) : (
          <p className="text-sm text-slate-500">No explanation available.</p>
        )}
      </Modal>
    </div>
  )
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-200">{value}</span>
    </div>
  )
}

function ExplainView({ data }: { data: Record<string, any> }) {
  // The explain endpoint returns { line, explain }. The explain blob is freeform jsonb,
  // typically an ordered list of calculation steps. Render structured steps when present,
  // otherwise fall back to a labeled key/value list, then raw JSON.
  const explain = data.explain ?? data
  const steps: any[] | null = Array.isArray(explain)
    ? explain
    : Array.isArray(explain?.steps)
      ? explain.steps
      : null

  if (steps && steps.length > 0) {
    return (
      <ol className="space-y-2">
        {steps.map((step, i) => {
          if (step && typeof step === 'object') {
            const label = step.label ?? step.name ?? step.step ?? `Step ${i + 1}`
            const value =
              step.value ?? step.amount_cents != null
                ? typeof step.amount_cents === 'number'
                  ? money(step.amount_cents)
                  : step.value
                : step.result ?? step.detail
            return (
              <li
                key={i}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
              >
                <div>
                  <div className="text-sm font-medium text-slate-200">{String(label)}</div>
                  {step.note && <div className="text-xs text-slate-500">{String(step.note)}</div>}
                  {step.formula && (
                    <div className="mt-0.5 font-mono text-xs text-slate-400">{String(step.formula)}</div>
                  )}
                </div>
                {value != null && (
                  <div className="shrink-0 text-right text-sm tabular-nums text-fuchsia-300">
                    {String(value)}
                  </div>
                )}
              </li>
            )
          }
          return (
            <li
              key={i}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-sm text-slate-200"
            >
              {String(step)}
            </li>
          )
        })}
      </ol>
    )
  }

  if (explain && typeof explain === 'object') {
    const entries = Object.entries(explain)
    if (entries.length > 0) {
      return (
        <div className="space-y-2">
          {entries.map(([k, v]) => (
            <div
              key={k}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
            >
              <span className="text-sm text-slate-400">{k}</span>
              <span className="text-right text-sm text-slate-200">
                {typeof v === 'object' ? (
                  <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(v, null, 2)}</pre>
                ) : (
                  String(v)
                )}
              </span>
            </div>
          ))}
        </div>
      )
    }
  }

  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}
