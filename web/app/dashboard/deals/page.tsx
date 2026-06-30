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
  currency?: string
}

interface Period {
  id: string
  label: string
  status: string | null
}

interface Deal {
  id: string
  workspace_id: string
  account_name: string
  amount_cents: number
  margin_cents: number | null
  product: string | null
  close_date: string | null
  currency: string | null
  status: string | null
  external_id: string | null
  period_id: string | null
  created_at: string
}

function fmtUsd(cents: number | null | undefined) {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger' | 'info'> = {
  closed_won: 'success',
  won: 'success',
  open: 'info',
  pending: 'warning',
  closed_lost: 'danger',
  lost: 'danger',
}

function statusTone(s: string | null) {
  return STATUS_TONE[(s ?? '').toLowerCase()] ?? 'neutral'
}

export default function DealsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [periods, setPeriods] = useState<Period[]>([])
  const [deals, setDeals] = useState<Deal[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    account_name: '',
    amount: '',
    margin: '',
    product: '',
    close_date: '',
    status: 'closed_won',
    external_id: '',
    period_id: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importPeriod, setImportPeriod] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Deal | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadDeals = useCallback(async (wsId: string) => {
    const [d, p]: [Deal[], Period[]] = await Promise.all([api.listDeals(wsId), api.listPeriods(wsId)])
    setDeals(d ?? [])
    setPeriods(p ?? [])
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
        await loadDeals(active)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load deals')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadDeals])

  const onSwitchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    setActiveWorkspaceId(id)
    setLoading(true)
    try {
      await loadDeals(id)
    } finally {
      setLoading(false)
    }
  }

  const periodLabel = useCallback(
    (id: string | null) => (id ? periods.find((p) => p.id === id)?.label ?? id.slice(0, 8) : '—'),
    [periods],
  )

  const submitCreate = async () => {
    if (!form.account_name.trim()) {
      setFormError('Account name is required')
      return
    }
    const amt = Number(form.amount)
    if (form.amount === '' || Number.isNaN(amt) || amt < 0) {
      setFormError('Amount must be a non-negative number')
      return
    }
    const marginNum = form.margin === '' ? null : Number(form.margin)
    if (marginNum != null && Number.isNaN(marginNum)) {
      setFormError('Margin must be a number')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createDeal({
        workspace_id: workspaceId,
        account_name: form.account_name.trim(),
        amount_cents: Math.round(amt * 100),
        margin_cents: marginNum == null ? undefined : Math.round(marginNum * 100),
        product: form.product.trim() || undefined,
        close_date: form.close_date || undefined,
        status: form.status,
        external_id: form.external_id.trim() || undefined,
        period_id: form.period_id || undefined,
      })
      setCreateOpen(false)
      setForm({
        account_name: '',
        amount: '',
        margin: '',
        product: '',
        close_date: '',
        status: 'closed_won',
        external_id: '',
        period_id: '',
      })
      await loadDeals(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create deal')
    } finally {
      setSaving(false)
    }
  }

  // CSV: account_name,amount,margin,product,close_date,status,external_id
  const parseCsv = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return { deals: [], errors: ['No rows found'] }
    let start = 0
    const first = lines[0].toLowerCase()
    if (first.includes('account') && first.includes('amount')) start = 1
    const out: Record<string, unknown>[] = []
    const errors: string[] = []
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim())
      const [account_name, amount, margin, product, close_date, status, external_id] = cols
      if (!account_name) {
        errors.push(`Row ${i + 1}: missing account name`)
        continue
      }
      const amt = Number(amount)
      if (Number.isNaN(amt)) {
        errors.push(`Row ${i + 1}: invalid amount "${amount}"`)
        continue
      }
      const marginNum = margin === '' || margin === undefined ? null : Number(margin)
      out.push({
        account_name,
        amount_cents: Math.round(amt * 100),
        margin_cents: marginNum == null || Number.isNaN(marginNum) ? undefined : Math.round(marginNum * 100),
        product: product || undefined,
        close_date: close_date || undefined,
        status: status || 'closed_won',
        external_id: external_id || undefined,
        period_id: importPeriod || undefined,
      })
    }
    return { deals: out, errors }
  }

  const submitImport = async () => {
    setImportError(null)
    setImportResult(null)
    const { deals: parsed, errors } = parseCsv(importText)
    if (parsed.length === 0) {
      setImportError(errors.length ? errors.join('; ') : 'No valid rows to import')
      return
    }
    setImportBusy(true)
    try {
      const res = await api.bulkImportDeals({ workspace_id: workspaceId, deals: parsed })
      const created = (res && (res.created as number)) ?? parsed.length
      const warn = errors.length ? ` (${errors.length} row(s) skipped)` : ''
      setImportResult(`Imported ${created} deal(s)${warn}.`)
      setImportText('')
      await loadDeals(workspaceId)
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Bulk import failed')
    } finally {
      setImportBusy(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteDeal(deleting.id)
      setDeleting(null)
      await loadDeals(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete deal')
    } finally {
      setDeleteBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deals.filter((d) => {
      if (statusFilter !== 'all' && (d.status ?? '').toLowerCase() !== statusFilter) return false
      if (periodFilter !== 'all' && (d.period_id ?? '') !== periodFilter) return false
      if (!q) return true
      return (
        d.account_name.toLowerCase().includes(q) ||
        (d.product ?? '').toLowerCase().includes(q) ||
        (d.external_id ?? '').toLowerCase().includes(q)
      )
    })
  }, [deals, search, statusFilter, periodFilter])

  const stats = useMemo(() => {
    const count = deals.length
    const total = deals.reduce((s, d) => s + (d.amount_cents ?? 0), 0)
    const margin = deals.reduce((s, d) => s + (d.margin_cents ?? 0), 0)
    const won = deals.filter((d) => (d.status ?? '').toLowerCase().includes('won')).length
    return { count, total, margin, won }
  }, [deals])

  const statusOptions = useMemo(() => {
    const set = new Set<string>()
    deals.forEach((d) => d.status && set.add(d.status.toLowerCase()))
    return Array.from(set).sort()
  }, [deals])

  if (loading) return <PageSpinner label="Loading deals..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Deals</h1>
          <p className="mt-1 text-sm text-slate-400">
            Source revenue events that feed commission derivation and reconciliation.
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
          <Button
            variant="secondary"
            onClick={() => {
              setImportError(null)
              setImportResult(null)
              setImportPeriod('')
              setImportOpen(true)
            }}
            disabled={!workspaceId}
          >
            Bulk Import
          </Button>
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            + New Deal
          </Button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace before adding deals."
          action={
            <Link href="/dashboard/workspaces">
              <Button variant="secondary">Go to Workspaces</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Deals" value={stats.count} />
            <Stat label="Total Bookings" value={fmtUsd(stats.total)} tone="success" />
            <Stat label="Total Margin" value={fmtUsd(stats.margin)} />
            <Stat label="Closed Won" value={stats.won} />
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-1 flex-wrap items-center gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search account, product, external id..."
                  className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  {statusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={periodFilter}
                  onChange={(e) => setPeriodFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All periods</option>
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-xs text-slate-500">
                {filtered.length} of {deals.length} shown
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {deals.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No deals yet"
                    description="Create a deal or bulk import from CSV to populate this workspace."
                    action={
                      <div className="flex gap-2">
                        <Button onClick={() => setCreateOpen(true)}>+ New Deal</Button>
                        <Button variant="secondary" onClick={() => setImportOpen(true)}>
                          Bulk Import
                        </Button>
                      </div>
                    }
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No matches" description="No deals match your filters." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Account</TH>
                      <TH>Product</TH>
                      <TH className="text-right">Amount</TH>
                      <TH className="text-right">Margin</TH>
                      <TH>Period</TH>
                      <TH>Close Date</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((d) => (
                      <TR key={d.id}>
                        <TD>
                          <Link
                            href={`/dashboard/deals/${d.id}`}
                            className="font-medium text-emerald-300 hover:text-emerald-200"
                          >
                            {d.account_name}
                          </Link>
                          {d.external_id && (
                            <span className="ml-2 text-xs text-slate-500">#{d.external_id}</span>
                          )}
                        </TD>
                        <TD className="text-slate-400">{d.product || '—'}</TD>
                        <TD className="text-right tabular-nums text-slate-100">{fmtUsd(d.amount_cents)}</TD>
                        <TD className="text-right tabular-nums text-slate-400">{fmtUsd(d.margin_cents)}</TD>
                        <TD className="text-slate-400">{periodLabel(d.period_id)}</TD>
                        <TD className="text-slate-400">{d.close_date ? d.close_date.slice(0, 10) : '—'}</TD>
                        <TD>
                          <Badge tone={statusTone(d.status)}>{d.status || 'unknown'}</Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/dashboard/deals/${d.id}`}>
                              <Button variant="ghost" className="px-2 py-1 text-xs">
                                View
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                              onClick={() => setDeleting(d)}
                            >
                              Delete
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      {/* Create deal modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Deal"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? 'Saving...' : 'Create Deal'}
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
          <Field label="Account Name *">
            <input
              value={form.account_name}
              onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="Acme Corp"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Amount (USD) *">
              <input
                type="number"
                min="0"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                placeholder="50000"
              />
            </Field>
            <Field label="Margin (USD)">
              <input
                type="number"
                value={form.margin}
                onChange={(e) => setForm((f) => ({ ...f, margin: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                placeholder="20000"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Product">
              <input
                value={form.product}
                onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                placeholder="Platform"
              />
            </Field>
            <Field label="Close Date">
              <input
                type="date"
                value={form.close_date}
                onChange={(e) => setForm((f) => ({ ...f, close_date: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="closed_won">closed_won</option>
                <option value="open">open</option>
                <option value="pending">pending</option>
                <option value="closed_lost">closed_lost</option>
              </select>
            </Field>
            <Field label="Period">
              <select
                value={form.period_id}
                onChange={(e) => setForm((f) => ({ ...f, period_id: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                <option value="">No period</option>
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="External ID">
            <input
              value={form.external_id}
              onChange={(e) => setForm((f) => ({ ...f, external_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="CRM-1234"
            />
          </Field>
        </div>
      </Modal>

      {/* Bulk import modal */}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Bulk Import Deals"
        footer={
          <>
            <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importBusy}>
              Close
            </Button>
            <Button onClick={submitImport} disabled={importBusy || !importText.trim()}>
              {importBusy ? 'Importing...' : 'Import'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-400">
            Paste CSV rows. Columns:{' '}
            <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-emerald-300">
              account_name, amount, margin, product, close_date, status, external_id
            </code>
            . A header row is auto-detected. Amount/margin are in dollars.
          </p>
          <Field label="Apply Period (optional)">
            <select
              value={importPeriod}
              onChange={(e) => setImportPeriod(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="">No period</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="CSV Data">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder={'account_name,amount,margin,product,close_date,status,external_id\nAcme Corp,50000,20000,Platform,2026-03-15,closed_won,CRM-1\nGlobex,120000,55000,Enterprise,2026-03-20,closed_won,CRM-2'}
            />
          </Field>
          {importError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {importError}
            </div>
          )}
          {importResult && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {importResult}
            </div>
          )}
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Deal"
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
          Delete deal <span className="font-semibold text-white">{deleting?.account_name}</span> (
          {fmtUsd(deleting?.amount_cents)})? This removes it from derivation and reconciliation inputs.
        </p>
      </Modal>
    </div>
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
