'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Modal } from '@/components/ui/Modal'

type Dispute = {
  id: string
  workspace_id: string
  rep_id: string | null
  period_id: string | null
  claimed_amount_cents: number
  narrative: string | null
  status: string
  assignee: string | null
  due_date: string | null
  resolution_amount_cents: number | null
  created_at?: string
}

type Rep = { id: string; name: string; email?: string | null }
type Period = { id: string; label: string; status?: string }

const STATUS_OPTIONS = ['open', 'investigating', 'resolved', 'rejected'] as const
const WS_KEY = 'cdl_workspace_id'

function money(cents: number | null | undefined) {
  return ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  switch ((status || '').toLowerCase()) {
    case 'resolved':
      return 'success'
    case 'rejected':
      return 'danger'
    case 'investigating':
      return 'info'
    case 'open':
      return 'warning'
    default:
      return 'neutral'
  }
}

function isOverdue(d: Dispute) {
  if (!d.due_date) return false
  if (['resolved', 'rejected'].includes((d.status || '').toLowerCase())) return false
  return new Date(d.due_date).getTime() < Date.now()
}

export default function DisputesListPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [reps, setReps] = useState<Rep[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [form, setForm] = useState({
    rep_id: '',
    period_id: '',
    claimed_amount: '',
    narrative: '',
    assignee: '',
    due_date: '',
  })

  // Resolve active workspace.
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        let wid: string | null = null
        try {
          wid = localStorage.getItem(WS_KEY)
        } catch {
          wid = null
        }
        if (!wid) {
          const ws = await api.listWorkspaces()
          const first = Array.isArray(ws) ? ws[0] : null
          wid = first?.id ?? null
          if (wid) {
            try {
              localStorage.setItem(WS_KEY, wid)
            } catch {
              /* ignore */
            }
          }
        }
        if (mounted) {
          if (!wid) {
            setError('No workspace found. Create a workspace first.')
            setLoading(false)
          } else {
            setWorkspaceId(wid)
          }
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
          setLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const [d, r, p] = await Promise.all([
        api.listDisputes(workspaceId, statusFilter ? { status: statusFilter } : undefined),
        api.listReps(workspaceId),
        api.listPeriods(workspaceId),
      ])
      setDisputes(Array.isArray(d) ? d : [])
      setReps(Array.isArray(r) ? r : [])
      setPeriods(Array.isArray(p) ? p : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  const repName = useCallback(
    (repId: string | null) => reps.find((r) => r.id === repId)?.name ?? '—',
    [reps],
  )
  const periodLabel = useCallback(
    (pid: string | null) => periods.find((p) => p.id === pid)?.label ?? '—',
    [periods],
  )

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceId) return
    setCreating(true)
    setCreateErr(null)
    try {
      const claimed = Math.round(parseFloat(form.claimed_amount || '0') * 100)
      if (!form.rep_id) throw new Error('Select a rep.')
      if (!Number.isFinite(claimed) || claimed <= 0) throw new Error('Enter a valid claimed amount.')
      await api.createDispute({
        workspace_id: workspaceId,
        rep_id: form.rep_id,
        period_id: form.period_id || null,
        claimed_amount_cents: claimed,
        narrative: form.narrative || null,
        assignee: form.assignee || null,
        due_date: form.due_date || null,
      })
      setCreateOpen(false)
      setForm({ rep_id: '', period_id: '', claimed_amount: '', narrative: '', assignee: '', due_date: '' })
      await load()
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to create dispute')
    } finally {
      setCreating(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return disputes
    return disputes.filter((d) => {
      const hay = `${d.narrative ?? ''} ${d.assignee ?? ''} ${repName(d.rep_id)} ${d.status}`.toLowerCase()
      return hay.includes(q)
    })
  }, [disputes, search, repName])

  const stats = useMemo(() => {
    let open = 0
    let claimed = 0
    let overdue = 0
    for (const d of disputes) {
      if (!['resolved', 'rejected'].includes((d.status || '').toLowerCase())) open += 1
      claimed += d.claimed_amount_cents
      if (isOverdue(d)) overdue += 1
    }
    return { total: disputes.length, open, claimed, overdue }
  }, [disputes])

  if (loading && !workspaceId && !error) return <PageSpinner label="Loading disputes..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Disputes</h1>
          <p className="mt-1 text-sm text-slate-500">Rep commission disputes and their resolution status.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
          New dispute
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total disputes" value={stats.total} />
        <Stat label="Open / active" value={stats.open} tone={stats.open ? 'warning' : 'success'} />
        <Stat label="Total claimed" value={money(stats.claimed)} />
        <Stat label="Overdue" value={stats.overdue} tone={stats.overdue ? 'danger' : 'default'} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search narrative / rep / assignee…"
              className="w-64 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          {loading && <Spinner />}
        </CardHeader>
        <CardBody className="p-0">
          {error ? (
            <div className="p-5">
              <EmptyState
                title="Could not load disputes"
                description={error}
                action={<Button onClick={load}>Retry</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={disputes.length === 0 ? 'No disputes yet' : 'No disputes match your filters'}
                description={
                  disputes.length === 0
                    ? 'Open a dispute when a rep contests a commission calculation.'
                    : 'Adjust the status filter or search query.'
                }
                action={
                  disputes.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
                      New dispute
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rep</TH>
                  <TH>Period</TH>
                  <TH className="text-right">Claimed</TH>
                  <TH>Assignee</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH></TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <div className="font-medium text-white">{repName(d.rep_id)}</div>
                      {d.narrative && (
                        <div className="max-w-xs truncate text-xs text-slate-500">{d.narrative}</div>
                      )}
                    </TD>
                    <TD className="text-slate-400">{periodLabel(d.period_id)}</TD>
                    <TD className="text-right tabular-nums">{money(d.claimed_amount_cents)}</TD>
                    <TD className="text-slate-400">{d.assignee || '—'}</TD>
                    <TD>
                      {d.due_date ? (
                        <span className={isOverdue(d) ? 'text-red-400' : 'text-slate-400'}>
                          {new Date(d.due_date).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-2">
                        <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                        {isOverdue(d) && <Badge tone="danger">overdue</Badge>}
                      </div>
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={`/dashboard/disputes/${d.id}`}
                        className="text-sm font-medium text-emerald-400 hover:text-emerald-300"
                      >
                        Open →
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={createOpen}
        onClose={() => (creating ? null : setCreateOpen(false))}
        title="New dispute"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button type="submit" form="dispute-create-form" disabled={creating}>
              {creating ? 'Creating…' : 'Create dispute'}
            </Button>
          </>
        }
      >
        <form id="dispute-create-form" onSubmit={submitCreate} className="space-y-4">
          {createErr && <p className="text-sm text-red-400">{createErr}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Rep</label>
            <select
              value={form.rep_id}
              onChange={(e) => setForm((f) => ({ ...f, rep_id: e.target.value }))}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">Select a rep…</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Period</label>
            <select
              value={form.period_id}
              onChange={(e) => setForm((f) => ({ ...f, period_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">No period</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Claimed amount (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.claimed_amount}
              onChange={(e) => setForm((f) => ({ ...f, claimed_amount: e.target.value }))}
              required
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Assignee
              </label>
              <input
                value={form.assignee}
                onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))}
                placeholder="user id / email"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                Due date
              </label>
              <input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Narrative
            </label>
            <textarea
              value={form.narrative}
              onChange={(e) => setForm((f) => ({ ...f, narrative: e.target.value }))}
              rows={3}
              placeholder="Describe what the rep is disputing…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
