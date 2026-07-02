'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type PlanVersion = {
  id: string
  version_number: number
  base_rate?: number | string | null
  rate_basis?: string | null
  notes?: string | null
  created_at?: string | null
}

type DiffEntry = {
  field?: string
  path?: string
  a?: unknown
  b?: unknown
  before?: unknown
  after?: unknown
  change?: string
  status?: string
}

type CompareResult = {
  a?: Record<string, unknown>
  b?: Record<string, unknown>
  diff?: DiffEntry[] | Record<string, { a?: unknown; b?: unknown }>
}

const inputCls =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none'

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}

function renderVal(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Normalize the various shapes the backend diff may take into a flat list. */
function normalizeDiff(diff: CompareResult['diff']): DiffEntry[] {
  if (!diff) return []
  if (Array.isArray(diff)) {
    return diff.map((d) => ({
      field: d.field ?? d.path,
      a: 'a' in d ? d.a : d.before,
      b: 'b' in d ? d.b : d.after,
      change: d.change ?? d.status,
    }))
  }
  // object map: { field: { a, b } }
  return Object.entries(diff).map(([field, v]) => ({
    field,
    a: (v as { a?: unknown }).a,
    b: (v as { b?: unknown }).b,
  }))
}

export default function ComparePlanVersionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [aId, setAId] = useState<string>('')
  const [bId, setBId] = useState<string>('')

  const [result, setResult] = useState<CompareResult | null>(null)
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const vers = (await api.listPlanVersions(id)) as PlanVersion[]
        if (!mounted) return
        const sorted = [...(Array.isArray(vers) ? vers : [])].sort(
          (x, y) => num(y.version_number) - num(x.version_number),
        )
        setVersions(sorted)
        if (sorted.length >= 2) {
          setBId(sorted[0].id) // newest as "b"
          setAId(sorted[1].id) // previous as "a"
        } else if (sorted.length === 1) {
          setAId(sorted[0].id)
          setBId(sorted[0].id)
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load versions')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [id])

  const runCompare = useCallback(async () => {
    if (!aId || !bId) return
    setComparing(true)
    setCompareError(null)
    setResult(null)
    try {
      const res = (await api.comparePlanVersions(id, aId, bId)) as CompareResult
      setResult(res ?? null)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to compare versions')
    } finally {
      setComparing(false)
    }
  }, [id, aId, bId])

  // auto-run when both selections present
  useEffect(() => {
    if (aId && bId) runCompare()
  }, [aId, bId, runCompare])

  const diffRows = useMemo(() => normalizeDiff(result?.diff), [result])

  const verLabel = useCallback(
    (vid: string) => {
      const v = versions.find((x) => x.id === vid)
      return v ? `v${v.version_number}` : vid.slice(0, 8)
    },
    [versions],
  )

  if (loading) return <PageSpinner label="Loading versions..." />

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/dashboard/plans/${id}`} className="text-sm text-fuchsia-400 hover:underline">
          ← Back to plan
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-white">Compare versions</h1>
        <p className="mt-1 text-sm text-slate-400">Diff two plan versions field by field.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {versions.length < 2 ? (
        <EmptyState
          title="Not enough versions to compare"
          description={
            <>
              This plan has {versions.length} version{versions.length === 1 ? '' : 's'}. Create at least
              two versions on the{' '}
              <Link href={`/dashboard/plans/${id}`} className="text-fuchsia-400 hover:underline">
                plan detail page
              </Link>{' '}
              to compare them.
            </>
          }
        />
      ) : (
        <>
          <Card>
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Version A (base)</span>
                <select value={aId} onChange={(e) => setAId(e.target.value)} className={inputCls}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version_number}
                    </option>
                  ))}
                </select>
              </label>
              <div className="pb-2 text-center text-slate-500">→</div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Version B (compare)</span>
                <select value={bId} onChange={(e) => setBId(e.target.value)} className={inputCls}>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version_number}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sm:ml-auto">
                <Button onClick={runCompare} disabled={comparing || !aId || !bId}>
                  {comparing ? 'Comparing...' : 'Compare'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {compareError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {compareError}
            </div>
          )}

          {comparing && (
            <div className="py-10">
              <Spinner label="Computing diff..." />
            </div>
          )}

          {!comparing && result && (
            <>
              {aId === bId && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                  Comparing a version against itself. Pick two different versions to see changes.
                </div>
              )}

              {/* Side-by-side snapshot */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <VersionCard title={`${verLabel(aId)} (A)`} data={result.a} />
                <VersionCard title={`${verLabel(bId)} (B)`} data={result.b} accent />
              </div>

              {/* Field diff */}
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold text-white">Field-by-field diff</h2>
                </CardHeader>
                <CardBody className="p-0">
                  {diffRows.length === 0 ? (
                    <div className="px-5 py-6">
                      <EmptyState
                        title="No differences"
                        description="These two versions are identical across compared fields."
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Field</TH>
                          <TH>{verLabel(aId)} (A)</TH>
                          <TH>{verLabel(bId)} (B)</TH>
                          <TH>Change</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {diffRows.map((d, i) => {
                          const aVal = renderVal(d.a)
                          const bVal = renderVal(d.b)
                          const changed = aVal !== bVal
                          return (
                            <TR key={d.field ?? i}>
                              <TD className="font-medium text-slate-100">{d.field ?? `field ${i + 1}`}</TD>
                              <TD className={changed ? 'text-red-300' : 'text-slate-400'}>{aVal}</TD>
                              <TD className={changed ? 'text-fuchsia-300' : 'text-slate-400'}>{bVal}</TD>
                              <TD>
                                {d.change ? (
                                  <Badge tone={badgeTone(d.change)}>{d.change}</Badge>
                                ) : changed ? (
                                  <Badge tone="warning">changed</Badge>
                                ) : (
                                  <Badge tone="neutral">same</Badge>
                                )}
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
        </>
      )}
    </div>
  )
}

function badgeTone(change: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const c = change.toLowerCase()
  if (c.includes('add')) return 'success'
  if (c.includes('remov') || c.includes('delet')) return 'danger'
  if (c.includes('chang') || c.includes('modif') || c.includes('updat')) return 'warning'
  if (c.includes('same') || c.includes('unchang')) return 'neutral'
  return 'info'
}

function VersionCard({
  title,
  data,
  accent,
}: {
  title: string
  data?: Record<string, unknown>
  accent?: boolean
}) {
  const entries = data ? Object.entries(data) : []
  return (
    <Card className={accent ? 'border-fuchsia-500/30' : ''}>
      <CardHeader className={accent ? 'border-fuchsia-500/20' : ''}>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </CardHeader>
      <CardBody>
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">No snapshot data returned.</p>
        ) : (
          <dl className="space-y-2">
            {entries.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-slate-800/60 pb-1 text-sm last:border-0">
                <dt className="text-slate-400">{k}</dt>
                <dd className="text-right font-mono text-slate-200">{renderVal(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardBody>
    </Card>
  )
}
