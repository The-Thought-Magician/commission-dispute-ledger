'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Deal = {
  id: string
  workspace_id: string
  account_name: string
  amount_cents: number
  margin_cents: number | null
  product: string | null
  close_date: string | null
  currency: string
  status: string
  external_id: string | null
  period_id: string | null
  created_at: string
}

type Credit = {
  id: string
  deal_id: string
  rep_id: string
  role: string
  split_pct: number
  created_at: string
}

type DealDetail = { deal?: Deal; credits?: Credit[] } & Partial<Deal>

type Rep = { id: string; name: string; email: string | null; role: string | null }

const DEAL_STATUSES = ['open', 'closed_won', 'closed_lost', 'refunded', 'churned']
const ROLES = ['primary', 'secondary', 'overlay', 'manager', 'sdr']
const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  closed_won: 'success',
  open: 'info',
  closed_lost: 'neutral',
  refunded: 'warning',
  churned: 'danger',
}

function dollars(cents: number | null | undefined, currency = 'USD') {
  if (cents == null) return '—'
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function DealDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const dealId = params.id

  const [deal, setDeal] = useState<Deal | null>(null)
  const [credits, setCredits] = useState<Credit[]>([])
  const [reps, setReps] = useState<Rep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    account_name: '',
    amount: '',
    margin: '',
    product: '',
    close_date: '',
    currency: 'USD',
    status: 'closed_won',
    external_id: '',
  })

  const [creditOpen, setCreditOpen] = useState(false)
  const [creditSaving, setCreditSaving] = useState(false)
  const [creditError, setCreditError] = useState<string | null>(null)
  const [creditForm, setCreditForm] = useState({ rep_id: '', role: 'primary', split_pct: '100' })
  const [removingId, setRemovingId] = useState<string | null>(null)

  const repName = useCallback(
    (id: string) => reps.find((r) => r.id === id)?.name ?? id.slice(0, 8),
    [reps],
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const detail: DealDetail = await api.getDeal(dealId)
      const d: Deal | null = (detail?.deal as Deal) ?? (detail?.id ? (detail as Deal) : null)
      const c: Credit[] = detail?.credits ?? []
      setDeal(d)
      setCredits(Array.isArray(c) ? c : [])
      if (d?.workspace_id) {
        try {
          const r = await api.listReps(d.workspace_id)
          setReps(Array.isArray(r) ? r : [])
        } catch {
          setReps([])
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load deal')
    }
  }, [dealId])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      await load()
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [load])

  const splitTotal = useMemo(
    () => credits.reduce((sum, c) => sum + (Number(c.split_pct) || 0), 0),
    [credits],
  )
  const splitOk = Math.abs(splitTotal - 100) < 0.001
  const availableReps = useMemo(
    () => reps.filter((r) => !credits.some((c) => c.rep_id === r.id)),
    [reps, credits],
  )

  function openEdit() {
    if (!deal) return
    setForm({
      account_name: deal.account_name ?? '',
      amount: deal.amount_cents != null ? (deal.amount_cents / 100).toString() : '',
      margin: deal.margin_cents != null ? (deal.margin_cents / 100).toString() : '',
      product: deal.product ?? '',
      close_date: deal.close_date ? deal.close_date.slice(0, 10) : '',
      currency: deal.currency ?? 'USD',
      status: deal.status ?? 'closed_won',
      external_id: deal.external_id ?? '',
    })
    setFormError(null)
    setEditOpen(true)
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!deal) return
    if (!form.account_name.trim()) {
      setFormError('Account name is required')
      return
    }
    const amount = Math.round(parseFloat(form.amount || '0') * 100)
    if (isNaN(amount)) {
      setFormError('Amount must be a number')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.updateDeal(deal.id, {
        account_name: form.account_name.trim(),
        amount_cents: amount,
        margin_cents: form.margin === '' ? null : Math.round(parseFloat(form.margin) * 100),
        product: form.product.trim() || null,
        close_date: form.close_date || null,
        currency: form.currency,
        status: form.status,
        external_id: form.external_id.trim() || null,
      })
      setEditOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update deal')
    } finally {
      setSaving(false)
    }
  }

  function openCredit() {
    setCreditForm({
      rep_id: availableReps[0]?.id ?? '',
      role: 'primary',
      split_pct: splitOk ? '0' : (100 - splitTotal).toString(),
    })
    setCreditError(null)
    setCreditOpen(true)
  }

  async function submitCredit(e: React.FormEvent) {
    e.preventDefault()
    if (!deal) return
    if (!creditForm.rep_id) {
      setCreditError('Select a rep')
      return
    }
    const pct = parseFloat(creditForm.split_pct || '0')
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setCreditError('Split % must be between 0 and 100')
      return
    }
    setCreditSaving(true)
    setCreditError(null)
    try {
      await api.addDealCredit(deal.id, {
        rep_id: creditForm.rep_id,
        role: creditForm.role,
        split_pct: pct,
      })
      setCreditOpen(false)
      await load()
    } catch (e) {
      setCreditError(e instanceof Error ? e.message : 'Failed to add credit')
    } finally {
      setCreditSaving(false)
    }
  }

  async function removeCredit(c: Credit) {
    if (!deal) return
    setRemovingId(c.id)
    setError(null)
    try {
      await api.removeDealCredit(deal.id, c.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove credit')
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading deal..." />

  if (error && !deal) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/deals" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← Back to Deals
        </Link>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      </div>
    )
  }

  if (!deal) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/deals" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← Back to Deals
        </Link>
        <EmptyState title="Deal not found" description="This deal may have been deleted." />
      </div>
    )
  }

  const cur = deal.currency || 'USD'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/dashboard/deals" className="text-sm text-emerald-400 hover:text-emerald-300">
            ← Back to Deals
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{deal.account_name}</h1>
            <Badge tone={STATUS_TONE[deal.status] ?? 'neutral'}>{deal.status}</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {deal.product || 'No product'} · Closed {fmtDate(deal.close_date)}
            {deal.external_id ? ` · ext ${deal.external_id}` : ''}
          </p>
        </div>
        <Button onClick={openEdit}>Edit Deal</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Amount" value={dollars(deal.amount_cents, cur)} />
        <Stat label="Margin" value={dollars(deal.margin_cents, cur)} />
        <Stat label="Credit Assignments" value={credits.length} />
        <Stat
          label="Split Total"
          value={`${splitTotal}%`}
          tone={splitOk ? 'success' : 'danger'}
          hint={splitOk ? 'Sums to 100%' : 'Does not sum to 100%'}
        />
      </div>

      {!splitOk && credits.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          Split credit sums to {splitTotal}% — this deal will be flagged in split-credit reconciliation
          until it reaches 100%.
        </div>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Credit Assignments</h2>
            <p className="text-xs text-slate-500">Who gets credited, in what role, at what split.</p>
          </div>
          <Button onClick={openCredit} disabled={availableReps.length === 0}>
            + Add Credit
          </Button>
        </CardHeader>
        <CardBody>
          {credits.length === 0 ? (
            <EmptyState
              title="No credit assignments"
              description="Assign one or more reps to this deal. Splits should sum to 100%."
              action={
                <Button onClick={openCredit} disabled={availableReps.length === 0}>
                  + Add Credit
                </Button>
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Rep</TH>
                  <TH>Role</TH>
                  <TH className="text-right">Split %</TH>
                  <TH className="text-right">Credited Amount</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {credits.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium text-white">
                      <Link
                        href={`/dashboard/reps/${c.rep_id}`}
                        className="hover:text-emerald-300"
                      >
                        {repName(c.rep_id)}
                      </Link>
                    </TD>
                    <TD className="capitalize text-slate-300">{c.role}</TD>
                    <TD className="text-right tabular-nums text-slate-200">{c.split_pct}%</TD>
                    <TD className="text-right tabular-nums text-slate-300">
                      {dollars(Math.round((deal.amount_cents * (Number(c.split_pct) || 0)) / 100), cur)}
                    </TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        onClick={() => removeCredit(c)}
                        disabled={removingId === c.id}
                      >
                        {removingId === c.id ? 'Removing...' : 'Remove'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {credits.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>Split coverage</span>
                <span className={splitOk ? 'text-emerald-400' : 'text-red-400'}>{splitTotal}% / 100%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full ${splitOk ? 'bg-emerald-500' : splitTotal > 100 ? 'bg-red-500' : 'bg-amber-500'}`}
                  style={{ width: `${Math.min(100, splitTotal)}%` }}
                />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        open={editOpen}
        onClose={() => !saving && setEditOpen(false)}
        title="Edit Deal"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="deal-edit-form" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <form id="deal-edit-form" onSubmit={submitEdit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Account name">
            <input
              value={form.account_name}
              onChange={(e) => setForm({ ...form, account_name: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount">
              <input
                type="number"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
            <Field label="Margin">
              <input
                type="number"
                step="0.01"
                value={form.margin}
                onChange={(e) => setForm({ ...form, margin: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Product">
              <input
                value={form.product}
                onChange={(e) => setForm({ ...form, product: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
            <Field label="Close date">
              <input
                type="date"
                value={form.close_date}
                onChange={(e) => setForm({ ...form, close_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              >
                {DEAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
          <Field label="External ID">
            <input
              value={form.external_id}
              onChange={(e) => setForm({ ...form, external_id: e.target.value })}
              placeholder="CRM opportunity id"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </Field>
        </form>
      </Modal>

      <Modal
        open={creditOpen}
        onClose={() => !creditSaving && setCreditOpen(false)}
        title="Add Credit Assignment"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreditOpen(false)} disabled={creditSaving}>
              Cancel
            </Button>
            <Button type="submit" form="credit-form" disabled={creditSaving}>
              {creditSaving ? 'Adding...' : 'Add Credit'}
            </Button>
          </>
        }
      >
        <form id="credit-form" onSubmit={submitCredit} className="space-y-4">
          {creditError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {creditError}
            </div>
          )}
          {availableReps.length === 0 ? (
            <p className="text-sm text-slate-400">All reps are already credited on this deal.</p>
          ) : (
            <>
              <Field label="Rep">
                <select
                  value={creditForm.rep_id}
                  onChange={(e) => setCreditForm({ ...creditForm, rep_id: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  {availableReps.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {r.role ? ` (${r.role})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Role">
                  <select
                    value={creditForm.role}
                    onChange={(e) => setCreditForm({ ...creditForm, role: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Split %">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={creditForm.split_pct}
                    onChange={(e) => setCreditForm({ ...creditForm, split_pct: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                  />
                </Field>
              </div>
              <p className="text-xs text-slate-500">
                Current total {splitTotal}%. Remaining to reach 100%: {Math.max(0, 100 - splitTotal)}%.
              </p>
            </>
          )}
        </form>
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
