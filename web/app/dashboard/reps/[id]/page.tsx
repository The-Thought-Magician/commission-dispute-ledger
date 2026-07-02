'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Rep {
  id: string
  workspace_id: string
  name: string
  email: string | null
  role: string | null
  territory: string | null
  status: string | null
  hire_date: string | null
  tags: string[] | null
  created_at: string
}

interface Plan {
  id: string
  name: string
}

interface Period {
  id: string
  label: string
  kind: string | null
  start_date: string | null
  end_date: string | null
  status: string | null
}

interface Assignment {
  id: string
  rep_id: string
  comp_plan_id: string
  period_id: string
  quota_cents: number
  created_at: string
}

function fmtUsd(cents: number | null | undefined) {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  active: 'success',
  inactive: 'neutral',
  leave: 'warning',
  terminated: 'danger',
}

export default function RepDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const repId = params.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rep, setRep] = useState<Rep | null>(null)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [periods, setPeriods] = useState<Period[]>([])

  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', territory: '', status: 'active' })
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const [assignOpen, setAssignOpen] = useState(false)
  const [assignForm, setAssignForm] = useState({ comp_plan_id: '', period_id: '', quota: '' })
  const [assignBusy, setAssignBusy] = useState(false)
  const [assignError, setAssignError] = useState<string | null>(null)

  const loadRepData = useCallback(async (rid: string) => {
    const repData: Rep = await api.getRep(rid)
    setRep(repData)
    const [asn, pls, pers] = await Promise.all([
      api.listRepAssignments(rid),
      api.listPlans(repData.workspace_id),
      api.listPeriods(repData.workspace_id),
    ])
    setAssignments(asn ?? [])
    setPlans(pls ?? [])
    setPeriods(pers ?? [])
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        await loadRepData(repId)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load rep')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [repId, loadRepData])

  const planName = useCallback(
    (id: string) => plans.find((p) => p.id === id)?.name ?? id.slice(0, 8),
    [plans],
  )
  const periodLabel = useCallback(
    (id: string) => periods.find((p) => p.id === id)?.label ?? id.slice(0, 8),
    [periods],
  )

  const openEdit = () => {
    if (!rep) return
    setEditForm({
      name: rep.name,
      email: rep.email ?? '',
      role: rep.role ?? '',
      territory: rep.territory ?? '',
      status: rep.status ?? 'active',
    })
    setEditError(null)
    setEditOpen(true)
  }

  const submitEdit = async () => {
    if (!editForm.name.trim()) {
      setEditError('Name is required')
      return
    }
    setEditBusy(true)
    setEditError(null)
    try {
      await api.updateRep(repId, {
        name: editForm.name.trim(),
        email: editForm.email.trim() || null,
        role: editForm.role.trim() || null,
        territory: editForm.territory.trim() || null,
        status: editForm.status,
      })
      setEditOpen(false)
      await loadRepData(repId)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update rep')
    } finally {
      setEditBusy(false)
    }
  }

  const submitAssign = async () => {
    if (!assignForm.comp_plan_id || !assignForm.period_id) {
      setAssignError('Plan and period are required')
      return
    }
    const quotaNum = Number(assignForm.quota)
    if (assignForm.quota && (Number.isNaN(quotaNum) || quotaNum < 0)) {
      setAssignError('Quota must be a non-negative number')
      return
    }
    setAssignBusy(true)
    setAssignError(null)
    try {
      await api.assignRepPlan(repId, {
        comp_plan_id: assignForm.comp_plan_id,
        period_id: assignForm.period_id,
        quota_cents: Math.round((quotaNum || 0) * 100),
      })
      setAssignOpen(false)
      setAssignForm({ comp_plan_id: '', period_id: '', quota: '' })
      await loadRepData(repId)
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : 'Failed to assign plan')
    } finally {
      setAssignBusy(false)
    }
  }

  const totalQuota = useMemo(
    () => assignments.reduce((s, a) => s + (a.quota_cents ?? 0), 0),
    [assignments],
  )

  if (loading) return <PageSpinner label="Loading rep..." />

  if (error || !rep) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/reps" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
          ← Back to roster
        </Link>
        <EmptyState
          title="Rep not found"
          description={error ?? 'This rep does not exist or you do not have access.'}
          action={
            <Button variant="secondary" onClick={() => router.push('/dashboard/reps')}>
              Back to Roster
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/dashboard/reps" className="text-sm text-fuchsia-400 hover:text-fuchsia-300">
        ← Back to roster
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{rep.name}</h1>
            <Badge tone={STATUS_TONE[(rep.status ?? '').toLowerCase()] ?? 'neutral'}>
              {rep.status || 'unknown'}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            {rep.role || 'No role'} {rep.territory ? `· ${rep.territory}` : ''}
          </p>
        </div>
        <Button variant="secondary" onClick={openEdit}>
          Edit Rep
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Assignments" value={assignments.length} />
        <Stat label="Total Quota" value={fmtUsd(totalQuota)} tone="success" />
        <Stat label="Email" value={<span className="text-base">{rep.email || '—'}</span>} />
        <Stat
          label="Hire Date"
          value={<span className="text-base">{rep.hire_date ? rep.hire_date.slice(0, 10) : '—'}</span>}
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Profile</h2>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <Detail label="Name" value={rep.name} />
            <Detail label="Email" value={rep.email || '—'} />
            <Detail label="Role" value={rep.role || '—'} />
            <Detail label="Territory" value={rep.territory || '—'} />
            <Detail label="Status" value={rep.status || '—'} />
            <Detail label="Created" value={rep.created_at ? rep.created_at.slice(0, 10) : '—'} />
          </dl>
          {rep.tags && rep.tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {rep.tags.map((t) => (
                <Badge key={t} tone="info">
                  {t}
                </Badge>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Plan Assignments & Quota</h2>
            <p className="mt-0.5 text-xs text-slate-500">Comp plan + quota per period for this rep.</p>
          </div>
          <Button
            onClick={() => {
              setAssignError(null)
              setAssignForm({ comp_plan_id: '', period_id: '', quota: '' })
              setAssignOpen(true)
            }}
            disabled={plans.length === 0 || periods.length === 0}
          >
            + Assign Plan
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {plans.length === 0 || periods.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Setup required"
                description="You need at least one comp plan and one period before assigning quota."
                action={
                  <div className="flex gap-2">
                    <Link href="/dashboard/plans">
                      <Button variant="secondary">Plans</Button>
                    </Link>
                    <Link href="/dashboard/periods">
                      <Button variant="secondary">Periods</Button>
                    </Link>
                  </div>
                }
              />
            </div>
          ) : assignments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No assignments"
                description="Assign a comp plan and quota for a period to start deriving commissions."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Comp Plan</TH>
                  <TH className="text-right">Quota</TH>
                  <TH>Assigned</TH>
                </TR>
              </THead>
              <TBody>
                {assignments.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium text-slate-100">{periodLabel(a.period_id)}</TD>
                    <TD>
                      <Link
                        href={`/dashboard/plans/${a.comp_plan_id}`}
                        className="text-fuchsia-300 hover:text-fuchsia-200"
                      >
                        {planName(a.comp_plan_id)}
                      </Link>
                    </TD>
                    <TD className="text-right tabular-nums text-slate-100">{fmtUsd(a.quota_cents)}</TD>
                    <TD className="text-slate-400">{a.created_at ? a.created_at.slice(0, 10) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Rep"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)} disabled={editBusy}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={editBusy}>
              {editBusy ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {editError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {editError}
            </div>
          )}
          <Field label="Name *">
            <input
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <Field label="Email">
            <input
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <input
                value={editForm.role}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
            <Field label="Territory">
              <input
                value={editForm.territory}
                onChange={(e) => setEditForm((f) => ({ ...f, territory: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Status">
            <select
              value={editForm.status}
              onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="leave">Leave</option>
              <option value="terminated">Terminated</option>
            </select>
          </Field>
        </div>
      </Modal>

      {/* Assign modal */}
      <Modal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        title="Assign Plan & Quota"
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignOpen(false)} disabled={assignBusy}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={assignBusy}>
              {assignBusy ? 'Assigning...' : 'Assign'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {assignError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {assignError}
            </div>
          )}
          <Field label="Comp Plan *">
            <select
              value={assignForm.comp_plan_id}
              onChange={(e) => setAssignForm((f) => ({ ...f, comp_plan_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="">Select a plan...</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period *">
            <select
              value={assignForm.period_id}
              onChange={(e) => setAssignForm((f) => ({ ...f, period_id: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            >
              <option value="">Select a period...</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quota (USD)">
            <input
              type="number"
              min="0"
              step="1000"
              value={assignForm.quota}
              onChange={(e) => setAssignForm((f) => ({ ...f, quota: e.target.value }))}
              placeholder="250000"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
            />
            <span className="mt-1 block text-xs text-slate-500">Stored in cents. One assignment per period.</span>
          </Field>
        </div>
      </Modal>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-200">{value}</dd>
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
