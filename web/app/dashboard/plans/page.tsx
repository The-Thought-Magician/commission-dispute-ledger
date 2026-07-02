'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'cdl_workspace_id'

type Plan = {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  currency?: string | null
  effective_start?: string | null
  effective_end?: string | null
  created_at?: string | null
}

function fmtDate(v?: string | null) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(WS_KEY)
    if (stored) return stored
  }
  const list = (await api.listWorkspaces()) as Array<{ id: string }>
  const first = Array.isArray(list) && list.length > 0 ? list[0].id : null
  if (first && typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, first)
  return first
}

export default function PlansPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    description: '',
    currency: 'USD',
    effective_start: '',
    effective_end: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // row actions
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Plan | null>(null)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const rows = (await api.listPlans(wsId)) as Plan[]
      setPlans(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load comp plans')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const wsId = await resolveWorkspaceId()
        if (!mounted) return
        setWorkspaceId(wsId)
        if (wsId) await load(wsId)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to resolve workspace')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return plans
    return plans.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q),
    )
  }, [plans, search])

  const activeCount = useMemo(() => {
    const now = Date.now()
    return plans.filter((p) => {
      const end = p.effective_end ? new Date(p.effective_end).getTime() : null
      return end === null || end >= now
    }).length
  }, [plans])

  const currencies = useMemo(
    () => new Set(plans.map((p) => p.currency || 'USD')).size,
    [plans],
  )

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Plan name is required')
      return
    }
    setSaving(true)
    try {
      await api.createPlan({
        workspace_id: workspaceId,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        currency: form.currency.trim() || 'USD',
        effective_start: form.effective_start || undefined,
        effective_end: form.effective_end || undefined,
      })
      setCreateOpen(false)
      setForm({ name: '', description: '', currency: 'USD', effective_start: '', effective_end: '' })
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create plan')
    } finally {
      setSaving(false)
    }
  }

  async function handleClone(plan: Plan) {
    if (!workspaceId) return
    setBusyId(plan.id)
    setError(null)
    try {
      await api.clonePlan(plan.id, { name: `${plan.name} (copy)` })
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clone plan')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete() {
    if (!confirmDelete || !workspaceId) return
    const plan = confirmDelete
    setBusyId(plan.id)
    setError(null)
    try {
      await api.deletePlan(plan.id)
      setConfirmDelete(null)
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete plan')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading comp plans..." />

  if (!workspaceId) {
    return (
      <div className="space-y-6">
        <Header onCreate={() => setCreateOpen(true)} disabled />
        <EmptyState
          title="No workspace selected"
          description={
            <>
              Create or select a workspace first, then return here to build comp plans.{' '}
              <Link href="/dashboard/workspaces" className="text-fuchsia-400 hover:underline">
                Go to workspaces
              </Link>
            </>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header onCreate={() => setCreateOpen(true)} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Total plans" value={plans.length} />
        <Stat label="Active" value={activeCount} tone="success" hint="Not past effective end" />
        <Stat label="Currencies" value={currencies} />
      </div>

      <Card>
        <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plans..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
            />
          </div>
          <span className="text-xs text-slate-500">
            {filtered.length} of {plans.length} shown
          </span>
        </div>

        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-5 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={plans.length === 0 ? 'No comp plans yet' : 'No plans match your search'}
                description={
                  plans.length === 0
                    ? 'Create your first comp plan to model rates, tiers, accelerators, and splits.'
                    : 'Try a different search term.'
                }
                action={
                  plans.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>New comp plan</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Plan</TH>
                  <TH>Currency</TH>
                  <TH>Effective</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((plan) => {
                  const end = plan.effective_end ? new Date(plan.effective_end).getTime() : null
                  const active = end === null || end >= Date.now()
                  return (
                    <TR key={plan.id}>
                      <TD>
                        <Link
                          href={`/dashboard/plans/${plan.id}`}
                          className="font-medium text-fuchsia-300 hover:underline"
                        >
                          {plan.name}
                        </Link>
                        {plan.description && (
                          <div className="mt-0.5 max-w-md truncate text-xs text-slate-500">
                            {plan.description}
                          </div>
                        )}
                      </TD>
                      <TD>{plan.currency || 'USD'}</TD>
                      <TD className="whitespace-nowrap text-slate-400">
                        {fmtDate(plan.effective_start)} → {fmtDate(plan.effective_end)}
                      </TD>
                      <TD>
                        {active ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Badge tone="neutral">Expired</Badge>
                        )}
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-2">
                          <Link href={`/dashboard/plans/${plan.id}`}>
                            <Button variant="ghost" className="px-2.5 py-1">
                              Open
                            </Button>
                          </Link>
                          <Link href={`/dashboard/plans/${plan.id}/compare`}>
                            <Button variant="ghost" className="px-2.5 py-1">
                              Compare
                            </Button>
                          </Link>
                          <Button
                            variant="secondary"
                            className="px-2.5 py-1"
                            disabled={busyId === plan.id}
                            onClick={() => handleClone(plan)}
                          >
                            {busyId === plan.id ? '...' : 'Clone'}
                          </Button>
                          <Button
                            variant="danger"
                            className="px-2.5 py-1"
                            disabled={busyId === plan.id}
                            onClick={() => setConfirmDelete(plan)}
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New comp plan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="create-plan-form" disabled={saving}>
              {saving ? 'Creating...' : 'Create plan'}
            </Button>
          </>
        }
      >
        <form id="create-plan-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Name" required>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="2026 AE Plan"
              className={inputCls}
              autoFocus
            />
          </Field>
          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              placeholder="Optional summary of the plan terms"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                className={inputCls}
              />
            </Field>
            <Field label="Effective start">
              <input
                type="date"
                value={form.effective_start}
                onChange={(e) => setForm({ ...form, effective_start: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Effective end">
              <input
                type="date"
                value={form.effective_end}
                onChange={(e) => setForm({ ...form, effective_end: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Delete comp plan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={busyId !== null}>
              {busyId !== null ? 'Deleting...' : 'Delete plan'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-white">{confirmDelete?.name}</span>? This
          removes all of its versions, tiers, accelerators, and split rules. This action cannot be
          undone.
        </p>
      </Modal>
    </div>
  )
}

function Header({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-white">Comp Plans</h1>
        <p className="mt-1 text-sm text-slate-400">
          Versioned compensation plans with rate tiers, accelerators, and split rules.
        </p>
      </div>
      <Button onClick={onCreate} disabled={disabled}>
        New comp plan
      </Button>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none'

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label} {required && <span className="text-fuchsia-400">*</span>}
      </span>
      {children}
    </label>
  )
}
