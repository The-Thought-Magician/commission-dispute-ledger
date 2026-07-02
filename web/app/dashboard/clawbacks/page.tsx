'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Workspace {
  id: string
  name: string
}

interface Rep {
  id: string
  name: string
}

interface Deal {
  id: string
  account_name: string
  amount_cents: number
}

interface Clawback {
  id: string
  workspace_id: string
  deal_id: string | null
  rep_id: string | null
  original_payout_cents: number | null
  amount_cents: number
  reason: string | null
  status: string | null
  created_at: string
}

interface Adjustment {
  id: string
  workspace_id: string
  rep_id: string | null
  period_id: string | null
  amount_cents: number
  direction: string | null
  reason: string | null
  status: string | null
  dispute_id: string | null
  created_at: string
}

type Tab = 'clawbacks' | 'adjustments'

const CLAWBACK_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  pending: 'warning',
  applied: 'success',
  waived: 'neutral',
}

const ADJ_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  applied: 'success',
  rejected: 'danger',
}

function dollars(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function dollarsToCents(input: string): number {
  const n = Number(input.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

export default function ClawbacksPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [tab, setTab] = useState<Tab>('clawbacks')

  const [clawbacks, setClawbacks] = useState<Clawback[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [reps, setReps] = useState<Rep[]>([])
  const [deals, setDeals] = useState<Deal[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Clawback create/edit
  const [cbModalOpen, setCbModalOpen] = useState(false)
  const [cbEditing, setCbEditing] = useState<Clawback | null>(null)
  const [cbForm, setCbForm] = useState({
    deal_id: '',
    rep_id: '',
    original_payout: '',
    amount: '',
    reason: '',
    status: 'pending',
  })

  // Adjustment create/edit
  const [adjModalOpen, setAdjModalOpen] = useState(false)
  const [adjEditing, setAdjEditing] = useState<Adjustment | null>(null)
  const [adjForm, setAdjForm] = useState({
    rep_id: '',
    amount: '',
    direction: 'credit',
    reason: '',
    status: 'pending',
  })

  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<{ kind: Tab; id: string; label: string } | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const repName = useCallback(
    (id: string | null) => (id ? reps.find((r) => r.id === id)?.name ?? '—' : '—'),
    [reps],
  )
  const dealName = useCallback(
    (id: string | null) => (id ? deals.find((d) => d.id === id)?.account_name ?? '—' : '—'),
    [deals],
  )

  const loadData = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const [cb, adj, rp, dl] = await Promise.all([
        api.listClawbacks(wsId),
        api.listAdjustments(wsId),
        api.listReps(wsId),
        api.listDeals(wsId),
      ])
      setClawbacks(cb ?? [])
      setAdjustments(adj ?? [])
      setReps(rp ?? [])
      setDeals(dl ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clawbacks & adjustments')
      setClawbacks([])
      setAdjustments([])
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

  // ---- Clawback handlers ----
  const openCbCreate = () => {
    setCbEditing(null)
    setCbForm({ deal_id: '', rep_id: '', original_payout: '', amount: '', reason: '', status: 'pending' })
    setFormError(null)
    setCbModalOpen(true)
  }

  const openCbEdit = (c: Clawback) => {
    setCbEditing(c)
    setCbForm({
      deal_id: c.deal_id ?? '',
      rep_id: c.rep_id ?? '',
      original_payout: c.original_payout_cents != null ? String(c.original_payout_cents / 100) : '',
      amount: String(c.amount_cents / 100),
      reason: c.reason ?? '',
      status: c.status ?? 'pending',
    })
    setFormError(null)
    setCbModalOpen(true)
  }

  const submitClawback = async () => {
    if (!cbForm.amount.trim()) {
      setFormError('Amount is required')
      return
    }
    if (!cbForm.deal_id) {
      setFormError('Deal is required')
      return
    }
    if (!cbForm.rep_id) {
      setFormError('Rep is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        workspace_id: workspaceId,
        deal_id: cbForm.deal_id || undefined,
        rep_id: cbForm.rep_id || undefined,
        original_payout_cents: cbForm.original_payout.trim()
          ? dollarsToCents(cbForm.original_payout)
          : undefined,
        amount_cents: dollarsToCents(cbForm.amount),
        reason: cbForm.reason.trim() || undefined,
        status: cbForm.status,
      }
      if (cbEditing) await api.updateClawback(cbEditing.id, body)
      else await api.createClawback(body)
      setCbModalOpen(false)
      await loadData(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save clawback')
    } finally {
      setSaving(false)
    }
  }

  const setClawbackStatus = async (c: Clawback, status: string) => {
    try {
      await api.updateClawback(c.id, { status })
      await loadData(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  // ---- Adjustment handlers ----
  const openAdjCreate = () => {
    setAdjEditing(null)
    setAdjForm({ rep_id: '', amount: '', direction: 'credit', reason: '', status: 'pending' })
    setFormError(null)
    setAdjModalOpen(true)
  }

  const openAdjEdit = (a: Adjustment) => {
    setAdjEditing(a)
    setAdjForm({
      rep_id: a.rep_id ?? '',
      amount: String(a.amount_cents / 100),
      direction: a.direction ?? 'credit',
      reason: a.reason ?? '',
      status: a.status ?? 'pending',
    })
    setFormError(null)
    setAdjModalOpen(true)
  }

  const submitAdjustment = async () => {
    if (!adjForm.amount.trim()) {
      setFormError('Amount is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const body = {
        workspace_id: workspaceId,
        rep_id: adjForm.rep_id || undefined,
        amount_cents: dollarsToCents(adjForm.amount),
        direction: adjForm.direction,
        reason: adjForm.reason.trim() || undefined,
        status: adjForm.status,
      }
      if (adjEditing) await api.updateAdjustment(adjEditing.id, body)
      else await api.createAdjustment(body)
      setAdjModalOpen(false)
      await loadData(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save adjustment')
    } finally {
      setSaving(false)
    }
  }

  const setAdjustmentStatus = async (a: Adjustment, status: string) => {
    try {
      await api.updateAdjustment(a.id, { status })
      await loadData(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update status')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      if (deleting.kind === 'clawbacks') await api.deleteClawback(deleting.id)
      else await api.deleteAdjustment(deleting.id)
      setDeleting(null)
      await loadData(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setDeleteBusy(false)
    }
  }

  const filteredClawbacks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return clawbacks.filter((c) => {
      if (statusFilter !== 'all' && (c.status ?? '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return (
        (c.reason ?? '').toLowerCase().includes(q) ||
        repName(c.rep_id).toLowerCase().includes(q) ||
        dealName(c.deal_id).toLowerCase().includes(q)
      )
    })
  }, [clawbacks, search, statusFilter, repName, dealName])

  const filteredAdjustments = useMemo(() => {
    const q = search.trim().toLowerCase()
    return adjustments.filter((a) => {
      if (statusFilter !== 'all' && (a.status ?? '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return (
        (a.reason ?? '').toLowerCase().includes(q) ||
        (a.direction ?? '').toLowerCase().includes(q) ||
        repName(a.rep_id).toLowerCase().includes(q)
      )
    })
  }, [adjustments, search, statusFilter, repName])

  const stats = useMemo(() => {
    const cbTotal = clawbacks.reduce((s, c) => s + (c.amount_cents ?? 0), 0)
    const cbPending = clawbacks.filter((c) => (c.status ?? '').toLowerCase() === 'pending').length
    const adjCredit = adjustments
      .filter((a) => (a.direction ?? '').toLowerCase() === 'credit')
      .reduce((s, a) => s + (a.amount_cents ?? 0), 0)
    const adjDebit = adjustments
      .filter((a) => (a.direction ?? '').toLowerCase() === 'debit')
      .reduce((s, a) => s + (a.amount_cents ?? 0), 0)
    return {
      cbTotal,
      cbPending,
      cbCount: clawbacks.length,
      adjCount: adjustments.length,
      adjNet: adjCredit - adjDebit,
    }
  }, [clawbacks, adjustments])

  if (loading) return <PageSpinner label="Loading clawbacks & adjustments..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Clawbacks & Adjustments</h1>
          <p className="mt-1 text-sm text-slate-400">
            Recover overpaid commissions and post manual credit/debit adjustments per rep.
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
          {tab === 'clawbacks' ? (
            <Button onClick={openCbCreate} disabled={!workspaceId}>
              + New Clawback
            </Button>
          ) : (
            <Button onClick={openAdjCreate} disabled={!workspaceId}>
              + New Adjustment
            </Button>
          )}
        </div>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace before tracking clawbacks."
          action={
            <Link href="/dashboard/workspaces">
              <Button variant="secondary">Go to Workspaces</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Clawbacks" value={stats.cbCount} />
            <Stat label="Recoverable" value={dollars(stats.cbTotal)} tone="warning" />
            <Stat label="Pending Clawbacks" value={stats.cbPending} tone={stats.cbPending ? 'warning' : 'default'} />
            <Stat
              label="Net Adjustments"
              value={dollars(stats.adjNet)}
              tone={stats.adjNet >= 0 ? 'success' : 'danger'}
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center gap-2 border-b border-slate-800">
            <TabButton active={tab === 'clawbacks'} onClick={() => setTab('clawbacks')}>
              Clawbacks ({clawbacks.length})
            </TabButton>
            <TabButton active={tab === 'adjustments'} onClick={() => setTab('adjustments')}>
              Adjustments ({adjustments.length})
            </TabButton>
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search reason, rep, deal..."
                  className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  {tab === 'clawbacks' ? (
                    <>
                      <option value="pending">Pending</option>
                      <option value="applied">Applied</option>
                      <option value="waived">Waived</option>
                    </>
                  ) : (
                    <>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="applied">Applied</option>
                      <option value="rejected">Rejected</option>
                    </>
                  )}
                </select>
              </div>
              <span className="text-xs text-slate-500">
                {tab === 'clawbacks'
                  ? `${filteredClawbacks.length} of ${clawbacks.length} shown`
                  : `${filteredAdjustments.length} of ${adjustments.length} shown`}
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {tab === 'clawbacks' ? (
                clawbacks.length === 0 ? (
                  <div className="p-6">
                    <EmptyState
                      title="No clawbacks yet"
                      description="Record a clawback when an overpaid commission needs to be recovered from a rep."
                      action={<Button onClick={openCbCreate}>+ New Clawback</Button>}
                    />
                  </div>
                ) : filteredClawbacks.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No matches" description="No clawbacks match your search or filter." />
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Rep</TH>
                        <TH>Deal</TH>
                        <TH className="text-right">Original Payout</TH>
                        <TH className="text-right">Clawback</TH>
                        <TH>Reason</TH>
                        <TH>Status</TH>
                        <TH className="text-right">Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {filteredClawbacks.map((c) => (
                        <TR key={c.id}>
                          <TD className="font-medium text-slate-100">{repName(c.rep_id)}</TD>
                          <TD className="text-slate-400">{dealName(c.deal_id)}</TD>
                          <TD className="text-right tabular-nums text-slate-400">
                            {c.original_payout_cents != null ? dollars(c.original_payout_cents) : '—'}
                          </TD>
                          <TD className="text-right tabular-nums font-medium text-amber-300">
                            {dollars(c.amount_cents)}
                          </TD>
                          <TD className="max-w-[16rem] truncate text-slate-400" title={c.reason ?? ''}>
                            {c.reason || '—'}
                          </TD>
                          <TD>
                            <Badge tone={CLAWBACK_TONE[(c.status ?? '').toLowerCase()] ?? 'neutral'}>
                              {c.status || 'pending'}
                            </Badge>
                          </TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-1">
                              {(c.status ?? 'pending').toLowerCase() === 'pending' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    className="px-2 py-1 text-xs text-fuchsia-400 hover:text-fuchsia-300"
                                    onClick={() => setClawbackStatus(c, 'applied')}
                                  >
                                    Apply
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="px-2 py-1 text-xs"
                                    onClick={() => setClawbackStatus(c, 'waived')}
                                  >
                                    Waive
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                className="px-2 py-1 text-xs"
                                onClick={() => openCbEdit(c)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                                onClick={() =>
                                  setDeleting({ kind: 'clawbacks', id: c.id, label: dollars(c.amount_cents) })
                                }
                              >
                                Delete
                              </Button>
                            </div>
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )
              ) : adjustments.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No adjustments yet"
                    description="Post a manual credit or debit adjustment to correct a rep's payout."
                    action={<Button onClick={openAdjCreate}>+ New Adjustment</Button>}
                  />
                </div>
              ) : filteredAdjustments.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No matches" description="No adjustments match your search or filter." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Rep</TH>
                      <TH>Direction</TH>
                      <TH className="text-right">Amount</TH>
                      <TH>Reason</TH>
                      <TH>Linked Dispute</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filteredAdjustments.map((a) => {
                      const dir = (a.direction ?? 'credit').toLowerCase()
                      return (
                        <TR key={a.id}>
                          <TD className="font-medium text-slate-100">{repName(a.rep_id)}</TD>
                          <TD>
                            <Badge tone={dir === 'credit' ? 'success' : 'danger'}>
                              {dir === 'credit' ? '+ credit' : '− debit'}
                            </Badge>
                          </TD>
                          <TD
                            className={`text-right tabular-nums font-medium ${
                              dir === 'credit' ? 'text-fuchsia-300' : 'text-red-300'
                            }`}
                          >
                            {dir === 'credit' ? '+' : '−'}
                            {dollars(a.amount_cents)}
                          </TD>
                          <TD className="max-w-[16rem] truncate text-slate-400" title={a.reason ?? ''}>
                            {a.reason || '—'}
                          </TD>
                          <TD className="text-slate-400">
                            {a.dispute_id ? (
                              <Link
                                href={`/dashboard/disputes/${a.dispute_id}`}
                                className="text-fuchsia-300 hover:text-fuchsia-200"
                              >
                                View
                              </Link>
                            ) : (
                              '—'
                            )}
                          </TD>
                          <TD>
                            <Badge tone={ADJ_TONE[(a.status ?? '').toLowerCase()] ?? 'neutral'}>
                              {a.status || 'pending'}
                            </Badge>
                          </TD>
                          <TD className="text-right">
                            <div className="flex justify-end gap-1">
                              {(a.status ?? 'pending').toLowerCase() === 'pending' && (
                                <>
                                  <Button
                                    variant="ghost"
                                    className="px-2 py-1 text-xs text-fuchsia-400 hover:text-fuchsia-300"
                                    onClick={() => setAdjustmentStatus(a, 'approved')}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                                    onClick={() => setAdjustmentStatus(a, 'rejected')}
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                className="px-2 py-1 text-xs"
                                onClick={() => openAdjEdit(a)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                                onClick={() =>
                                  setDeleting({ kind: 'adjustments', id: a.id, label: dollars(a.amount_cents) })
                                }
                              >
                                Delete
                              </Button>
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
        </>
      )}

      {/* Clawback modal */}
      <Modal
        open={cbModalOpen}
        onClose={() => setCbModalOpen(false)}
        title={cbEditing ? 'Edit Clawback' : 'New Clawback'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCbModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitClawback} disabled={saving}>
              {saving ? 'Saving...' : cbEditing ? 'Save Changes' : 'Create Clawback'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Rep *">
              <select
                value={cbForm.rep_id}
                onChange={(e) => setCbForm((f) => ({ ...f, rep_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="">— None —</option>
                {reps.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deal *">
              <select
                value={cbForm.deal_id}
                onChange={(e) => setCbForm((f) => ({ ...f, deal_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="">— None —</option>
                {deals.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.account_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Original Payout ($)">
              <input
                value={cbForm.original_payout}
                onChange={(e) => setCbForm((f) => ({ ...f, original_payout: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />
            </Field>
            <Field label="Clawback Amount ($) *">
              <input
                value={cbForm.amount}
                onChange={(e) => setCbForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />
            </Field>
          </div>
          <Field label="Reason">
            <textarea
              value={cbForm.reason}
              onChange={(e) => setCbForm((f) => ({ ...f, reason: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              placeholder="Deal returned / overpayment on Q2 acceleration..."
            />
          </Field>
          <Field label="Status">
            <select
              value={cbForm.status}
              onChange={(e) => setCbForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="pending">Pending</option>
              <option value="applied">Applied</option>
              <option value="waived">Waived</option>
            </select>
          </Field>
        </div>
      </Modal>

      {/* Adjustment modal */}
      <Modal
        open={adjModalOpen}
        onClose={() => setAdjModalOpen(false)}
        title={adjEditing ? 'Edit Adjustment' : 'New Adjustment'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdjModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitAdjustment} disabled={saving}>
              {saving ? 'Saving...' : adjEditing ? 'Save Changes' : 'Create Adjustment'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Rep">
            <select
              value={adjForm.rep_id}
              onChange={(e) => setAdjForm((f) => ({ ...f, rep_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="">— None —</option>
              {reps.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Direction">
              <select
                value={adjForm.direction}
                onChange={(e) => setAdjForm((f) => ({ ...f, direction: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="credit">Credit (+)</option>
                <option value="debit">Debit (−)</option>
              </select>
            </Field>
            <Field label="Amount ($) *">
              <input
                value={adjForm.amount}
                onChange={(e) => setAdjForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
                placeholder="0.00"
                inputMode="decimal"
              />
            </Field>
          </div>
          <Field label="Reason">
            <textarea
              value={adjForm.reason}
              onChange={(e) => setAdjForm((f) => ({ ...f, reason: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              placeholder="True-up for late-posted split credit..."
            />
          </Field>
          <Field label="Status">
            <select
              value={adjForm.status}
              onChange={(e) => setAdjForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="applied">Applied</option>
              <option value="rejected">Rejected</option>
            </select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={deleting?.kind === 'clawbacks' ? 'Delete Clawback' : 'Delete Adjustment'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleteBusy}>
              {deleteBusy ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete this {deleting?.kind === 'clawbacks' ? 'clawback' : 'adjustment'} of{' '}
          <span className="font-semibold text-white">{deleting?.label}</span>? This action cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border-fuchsia-500 text-fuchsia-300'
          : 'border-transparent text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
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
