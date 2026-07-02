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
  resolution_note: string | null
  calc_snapshot: unknown
  created_at?: string
  updated_at?: string
}

type DisputeDeal = {
  id?: string
  deal_id: string
  account_name?: string | null
  amount_cents?: number | null
  product?: string | null
  status?: string | null
}

type Comment = { id: string; author: string | null; body: string; created_at: string }
type Deal = { id: string; account_name: string; amount_cents: number; product?: string | null; status?: string | null }

const STATUS_OPTIONS = ['open', 'investigating', 'resolved', 'rejected'] as const
const RESOLVED_STATES = ['resolved', 'rejected']

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

export default function DisputeDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [dispute, setDispute] = useState<Dispute | null>(null)
  const [deals, setDeals] = useState<DisputeDeal[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [allDeals, setAllDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  // edit form
  const [edit, setEdit] = useState({ status: '', assignee: '', due_date: '', narrative: '' })

  // comments
  const [commentBody, setCommentBody] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // attach deal
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachId, setAttachId] = useState('')
  const [attaching, setAttaching] = useState(false)
  const [attachErr, setAttachErr] = useState<string | null>(null)

  // resolve
  const [resolveOpen, setResolveOpen] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveErr, setResolveErr] = useState<string | null>(null)
  const [resolveForm, setResolveForm] = useState({ amount: '', note: '', create_adjustment: true })

  // report
  const [reportOpen, setReportOpen] = useState(false)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportData, setReportData] = useState<unknown>(null)
  const [reportErr, setReportErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.getDispute(id)
      const d: Dispute = res?.dispute ?? res
      const dd: DisputeDeal[] = res?.deals ?? []
      const cc: Comment[] = res?.comments ?? []
      setDispute(d)
      setDeals(Array.isArray(dd) ? dd : [])
      setEdit({
        status: d.status ?? 'open',
        assignee: d.assignee ?? '',
        due_date: d.due_date ? d.due_date.slice(0, 10) : '',
        narrative: d.narrative ?? '',
      })
      // Comments may come from detail payload; also load thread explicitly to be safe.
      try {
        const thread = await api.listDisputeComments(id)
        setComments(Array.isArray(thread) ? thread : Array.isArray(cc) ? cc : [])
      } catch {
        setComments(Array.isArray(cc) ? cc : [])
      }
      // Load deal catalog for attach picker (workspace from dispute).
      if (d?.workspace_id) {
        try {
          const ds = await api.listDeals(d.workspace_id)
          setAllDeals(Array.isArray(ds) ? ds : [])
        } catch {
          setAllDeals([])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dispute')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const isResolved = useMemo(
    () => (dispute ? RESOLVED_STATES.includes((dispute.status || '').toLowerCase()) : false),
    [dispute],
  )

  const saveEdit = async () => {
    if (!id) return
    setBusy(true)
    setActionMsg(null)
    try {
      const updated = await api.updateDispute(id, {
        status: edit.status,
        assignee: edit.assignee || null,
        due_date: edit.due_date || null,
        narrative: edit.narrative || null,
      })
      setDispute((prev) => ({ ...(prev as Dispute), ...(updated?.dispute ?? updated) }))
      setActionMsg('Dispute updated.')
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to update dispute')
    } finally {
      setBusy(false)
    }
  }

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !commentBody.trim()) return
    setPostingComment(true)
    try {
      await api.addDisputeComment(id, { body: commentBody.trim() })
      setCommentBody('')
      const thread = await api.listDisputeComments(id)
      setComments(Array.isArray(thread) ? thread : [])
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to add comment')
    } finally {
      setPostingComment(false)
    }
  }

  const attachDeal = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id || !attachId) return
    setAttaching(true)
    setAttachErr(null)
    try {
      await api.attachDisputeDeal(id, { deal_id: attachId })
      setAttachOpen(false)
      setAttachId('')
      await load()
    } catch (err) {
      setAttachErr(err instanceof Error ? err.message : 'Failed to attach deal')
    } finally {
      setAttaching(false)
    }
  }

  const detachDeal = async (dealId: string) => {
    if (!id) return
    setBusy(true)
    setActionMsg(null)
    try {
      await api.detachDisputeDeal(id, dealId)
      setDeals((prev) => prev.filter((d) => d.deal_id !== dealId))
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : 'Failed to detach deal')
    } finally {
      setBusy(false)
    }
  }

  const submitResolve = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!id) return
    setResolving(true)
    setResolveErr(null)
    try {
      const amount = Math.round(parseFloat(resolveForm.amount || '0') * 100)
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Enter a valid resolution amount.')
      const updated = await api.resolveDispute(id, {
        resolution_amount_cents: amount,
        resolution_note: resolveForm.note || null,
        create_adjustment: resolveForm.create_adjustment,
      })
      setDispute((prev) => ({ ...(prev as Dispute), ...(updated?.dispute ?? updated) }))
      setResolveOpen(false)
      await load()
    } catch (err) {
      setResolveErr(err instanceof Error ? err.message : 'Failed to resolve dispute')
    } finally {
      setResolving(false)
    }
  }

  const openReport = async () => {
    if (!id) return
    setReportOpen(true)
    setReportLoading(true)
    setReportErr(null)
    setReportData(null)
    try {
      const res = await api.reportDispute(id)
      setReportData(res)
    } catch (e) {
      setReportErr(e instanceof Error ? e.message : 'Failed to build report')
    } finally {
      setReportLoading(false)
    }
  }

  const downloadReport = () => {
    if (reportData == null) return
    const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dispute-${id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const attachedIds = useMemo(() => new Set(deals.map((d) => d.deal_id)), [deals])
  const attachable = useMemo(
    () => allDeals.filter((d) => !attachedIds.has(d.id)),
    [allDeals, attachedIds],
  )

  const dealLabel = useCallback(
    (dd: DisputeDeal) => {
      if (dd.account_name) return dd.account_name
      const match = allDeals.find((d) => d.id === dd.deal_id)
      return match?.account_name ?? dd.deal_id
    },
    [allDeals],
  )

  const dealAmount = useCallback(
    (dd: DisputeDeal) => {
      if (dd.amount_cents != null) return dd.amount_cents
      return allDeals.find((d) => d.id === dd.deal_id)?.amount_cents ?? null
    },
    [allDeals],
  )

  if (loading) return <PageSpinner label="Loading dispute..." />

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/disputes" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to disputes
        </Link>
        <EmptyState
          title="Could not load dispute"
          description={error}
          action={<Button onClick={load}>Retry</Button>}
        />
      </div>
    )
  }

  if (!dispute) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/disputes" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to disputes
        </Link>
        <EmptyState title="Dispute not found" />
      </div>
    )
  }

  const snapshot = dispute.calc_snapshot
  const delta =
    dispute.resolution_amount_cents != null
      ? dispute.resolution_amount_cents - dispute.claimed_amount_cents
      : null

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/dashboard/disputes" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
            ← Back to disputes
          </Link>
          <h1 className="mt-2 flex items-center gap-3 text-2xl font-bold text-white">
            Dispute
            <Badge tone={statusTone(dispute.status)}>{dispute.status}</Badge>
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">{dispute.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={openReport}>
            Export report
          </Button>
          {!isResolved && (
            <Button
              onClick={() => {
                setResolveForm({
                  amount: (dispute.claimed_amount_cents / 100).toFixed(2),
                  note: '',
                  create_adjustment: true,
                })
                setResolveOpen(true)
              }}
            >
              Resolve
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Claimed" value={money(dispute.claimed_amount_cents)} />
        <Stat
          label="Resolved at"
          value={dispute.resolution_amount_cents != null ? money(dispute.resolution_amount_cents) : '—'}
          tone={dispute.resolution_amount_cents != null ? 'success' : 'default'}
        />
        <Stat
          label="Net adjustment"
          value={delta == null ? '—' : `${delta >= 0 ? '+' : '-'}${money(Math.abs(delta))}`}
          tone={delta == null ? 'default' : delta === 0 ? 'success' : delta > 0 ? 'warning' : 'danger'}
        />
        <Stat label="Disputed deals" value={deals.length} />
      </div>

      {actionMsg && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-4 py-2 text-sm text-slate-300">
          {actionMsg}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Disputed deals */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Disputed deals</h2>
                <p className="text-sm text-slate-500">Deals attached to this dispute.</p>
              </div>
              <Button variant="secondary" onClick={() => setAttachOpen(true)} disabled={isResolved}>
                Attach deal
              </Button>
            </CardHeader>
            <CardBody className="p-0">
              {deals.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No deals attached"
                    description="Attach the deals this dispute concerns to ground the discussion."
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Deal ID</TH>
                      <TH></TH>
                    </TR>
                  </THead>
                  <TBody>
                    {deals.map((dd) => (
                      <TR key={dd.deal_id}>
                        <TD className="font-medium text-white">{dealLabel(dd)}</TD>
                        <TD className="text-right tabular-nums">
                          {dealAmount(dd) != null ? money(dealAmount(dd)) : '—'}
                        </TD>
                        <TD className="font-mono text-xs text-slate-500">{dd.deal_id}</TD>
                        <TD className="text-right">
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-red-400 hover:text-red-300"
                            onClick={() => detachDeal(dd.deal_id)}
                            disabled={busy || isResolved}
                          >
                            Detach
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {/* Calc snapshot */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Calculation snapshot</h2>
              <p className="text-sm text-slate-500">Frozen state of the comp calculation at dispute time.</p>
            </CardHeader>
            <CardBody>
              {snapshot == null || (typeof snapshot === 'object' && Object.keys(snapshot).length === 0) ? (
                <EmptyState title="No snapshot captured" description="No calculation snapshot was stored for this dispute." />
              ) : (
                <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">
                  {JSON.stringify(snapshot, null, 2)}
                </pre>
              )}
            </CardBody>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Discussion</h2>
              <p className="text-sm text-slate-500">{comments.length} comment(s).</p>
            </CardHeader>
            <CardBody className="space-y-4">
              <form onSubmit={postComment} className="flex flex-col gap-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  placeholder="Add a comment…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
                />
                <div className="flex justify-end">
                  <Button type="submit" disabled={postingComment || !commentBody.trim()}>
                    {postingComment ? 'Posting…' : 'Post comment'}
                  </Button>
                </div>
              </form>
              {comments.length === 0 ? (
                <EmptyState title="No comments yet" description="Start the conversation about this dispute." />
              ) : (
                <ul className="space-y-3">
                  {comments.map((c) => (
                    <li key={c.id} className="rounded-lg border border-slate-800 bg-slate-900/50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-fuchsia-300">{c.author || 'Unknown'}</span>
                        <span className="text-xs text-slate-500">
                          {c.created_at ? new Date(c.created_at).toLocaleString() : ''}
                        </span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right column: details / edit / resolution */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Case fields</h2>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Status
                </label>
                <select
                  value={edit.status}
                  onChange={(e) => setEdit((s) => ({ ...s, status: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Assignee
                </label>
                <input
                  value={edit.assignee}
                  onChange={(e) => setEdit((s) => ({ ...s, assignee: e.target.value }))}
                  placeholder="user id / email"
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Due date
                </label>
                <input
                  type="date"
                  value={edit.due_date}
                  onChange={(e) => setEdit((s) => ({ ...s, due_date: e.target.value }))}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
                  Narrative
                </label>
                <textarea
                  value={edit.narrative}
                  onChange={(e) => setEdit((s) => ({ ...s, narrative: e.target.value }))}
                  rows={4}
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={saveEdit} disabled={busy}>
                  {busy ? 'Saving…' : 'Save changes'}
                </Button>
              </div>
            </CardBody>
          </Card>

          {dispute.resolution_amount_cents != null && (
            <Card>
              <CardHeader>
                <h2 className="text-base font-semibold text-white">Resolution</h2>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-medium tabular-nums text-fuchsia-300">
                    {money(dispute.resolution_amount_cents)}
                  </span>
                </div>
                {dispute.resolution_note && (
                  <p className="rounded-lg bg-slate-950 px-3 py-2 text-slate-300">{dispute.resolution_note}</p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-white">Metadata</h2>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Rep</span>
                <span className="font-mono text-xs text-slate-300">{dispute.rep_id ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Period</span>
                <span className="font-mono text-xs text-slate-300">{dispute.period_id ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-300">
                  {dispute.created_at ? new Date(dispute.created_at).toLocaleString() : '—'}
                </span>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Attach deal modal */}
      <Modal
        open={attachOpen}
        onClose={() => (attaching ? null : setAttachOpen(false))}
        title="Attach deal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAttachOpen(false)} disabled={attaching}>
              Cancel
            </Button>
            <Button type="submit" form="attach-deal-form" disabled={attaching || !attachId}>
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </>
        }
      >
        <form id="attach-deal-form" onSubmit={attachDeal} className="space-y-4">
          {attachErr && <p className="text-sm text-red-400">{attachErr}</p>}
          {attachable.length === 0 ? (
            <p className="text-sm text-slate-400">No more deals available to attach.</p>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Deal</label>
              <select
                value={attachId}
                onChange={(e) => setAttachId(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="">Select a deal…</option>
                {attachable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.account_name} — {money(d.amount_cents)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form>
      </Modal>

      {/* Resolve modal */}
      <Modal
        open={resolveOpen}
        onClose={() => (resolving ? null : setResolveOpen(false))}
        title="Resolve dispute"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveOpen(false)} disabled={resolving}>
              Cancel
            </Button>
            <Button type="submit" form="resolve-form" disabled={resolving}>
              {resolving ? 'Resolving…' : 'Resolve dispute'}
            </Button>
          </>
        }
      >
        <form id="resolve-form" onSubmit={submitResolve} className="space-y-4">
          {resolveErr && <p className="text-sm text-red-400">{resolveErr}</p>}
          <p className="text-sm text-slate-400">
            Claimed amount: <span className="font-medium text-slate-200">{money(dispute.claimed_amount_cents)}</span>
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Resolution amount (USD)
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={resolveForm.amount}
              onChange={(e) => setResolveForm((f) => ({ ...f, amount: e.target.value }))}
              required
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Resolution note
            </label>
            <textarea
              value={resolveForm.note}
              onChange={(e) => setResolveForm((f) => ({ ...f, note: e.target.value }))}
              rows={3}
              placeholder="Explain the resolution decision…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={resolveForm.create_adjustment}
              onChange={(e) => setResolveForm((f) => ({ ...f, create_adjustment: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-fuchsia-500 focus:ring-fuchsia-500"
            />
            Create a payout adjustment for the resolved amount
          </label>
        </form>
      </Modal>

      {/* Report modal */}
      <Modal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        title="Dispute resolution report"
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
