'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Period = {
  id: string
  workspace_id: string
  label: string
  kind: string
  start_date: string | null
  end_date: string | null
  status: string
  created_at: string
}

const KINDS = ['monthly', 'quarterly', 'semiannual', 'annual', 'custom']
const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'success',
  locked: 'warning',
  closed: 'neutral',
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  const date = new Date(d)
  if (isNaN(date.getTime())) return d
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function resolveWorkspaceId(): Promise<string | null> {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem('cdl_workspace')
    if (stored) return stored
  }
  const ws = await api.listWorkspaces()
  const first = Array.isArray(ws) && ws.length > 0 ? ws[0].id : null
  if (first && typeof window !== 'undefined') window.localStorage.setItem('cdl_workspace', first)
  return first ?? null
}

export default function PeriodsPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<Period | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const emptyForm = { label: '', kind: 'monthly', start_date: '', end_date: '' }
  const [form, setForm] = useState(emptyForm)

  const load = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const rows = await api.listPeriods(wsId)
      setPeriods(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load periods')
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
        else setError('No workspace found. Create a workspace first.')
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to initialize')
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
    return periods.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (q && !p.label.toLowerCase().includes(q)) return false
      return true
    })
  }, [periods, search, statusFilter, kindFilter])

  const counts = useMemo(() => {
    const c = { total: periods.length, open: 0, locked: 0, closed: 0 }
    for (const p of periods) {
      if (p.status === 'open') c.open++
      else if (p.status === 'locked') c.locked++
      else if (p.status === 'closed') c.closed++
    }
    return c
  }, [periods])

  function openCreate() {
    setForm(emptyForm)
    setFormError(null)
    setCreateOpen(true)
  }

  function openEdit(p: Period) {
    setEditing(p)
    setForm({
      label: p.label,
      kind: p.kind,
      start_date: p.start_date ? p.start_date.slice(0, 10) : '',
      end_date: p.end_date ? p.end_date.slice(0, 10) : '',
    })
    setFormError(null)
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId) return
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createPeriod({
        workspace_id: workspaceId,
        label: form.label.trim(),
        kind: form.kind,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      setCreateOpen(false)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create period')
    } finally {
      setSaving(false)
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!workspaceId || !editing) return
    if (!form.label.trim()) {
      setFormError('Label is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.updatePeriod(editing.id, {
        label: form.label.trim(),
        kind: form.kind,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      setEditing(null)
      await load(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to update period')
    } finally {
      setSaving(false)
    }
  }

  async function doLock(p: Period) {
    if (!workspaceId) return
    setBusyId(p.id)
    setError(null)
    try {
      await api.lockPeriod(p.id)
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to lock period')
    } finally {
      setBusyId(null)
    }
  }

  async function doClose(p: Period) {
    if (!workspaceId) return
    setBusyId(p.id)
    setError(null)
    try {
      await api.closePeriod(p.id)
      await load(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close period')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <PageSpinner label="Loading periods..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Periods</h1>
          <p className="mt-1 text-sm text-slate-400">
            Commission periods. Lock a period to freeze its inputs, then close it once payouts are final.
          </p>
        </div>
        <Button onClick={openCreate} disabled={!workspaceId}>
          + New Period
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Open" value={counts.open} tone="success" />
        <Stat label="Locked" value={counts.locked} tone="warning" />
        <Stat label="Closed" value={counts.closed} />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by label..."
            className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All kinds</option>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="locked">Locked</option>
              <option value="closed">Closed</option>
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={periods.length === 0 ? 'No periods yet' : 'No periods match your filters'}
              description={
                periods.length === 0
                  ? 'Create your first commission period to start tracking deals and derivations.'
                  : 'Try adjusting the search or filters.'
              }
              action={
                periods.length === 0 ? (
                  <Button onClick={openCreate} disabled={!workspaceId}>
                    + New Period
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Kind</TH>
                  <TH>Start</TH>
                  <TH>End</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const busy = busyId === p.id
                  return (
                    <TR key={p.id}>
                      <TD className="font-medium text-white">{p.label}</TD>
                      <TD className="capitalize text-slate-300">{p.kind}</TD>
                      <TD className="text-slate-400">{fmtDate(p.start_date)}</TD>
                      <TD className="text-slate-400">{fmtDate(p.end_date)}</TD>
                      <TD>
                        <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status}</Badge>
                      </TD>
                      <TD>
                        <div className="flex items-center justify-end gap-2">
                          {p.status === 'open' && (
                            <>
                              <Button variant="ghost" onClick={() => openEdit(p)} disabled={busy}>
                                Edit
                              </Button>
                              <Button variant="secondary" onClick={() => doLock(p)} disabled={busy}>
                                {busy ? 'Locking...' : 'Lock'}
                              </Button>
                            </>
                          )}
                          {p.status === 'locked' && (
                            <Button variant="secondary" onClick={() => doClose(p)} disabled={busy}>
                              {busy ? 'Closing...' : 'Close'}
                            </Button>
                          )}
                          {p.status === 'closed' && (
                            <span className="text-xs text-slate-500">Finalized</span>
                          )}
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

      <Modal
        open={createOpen}
        onClose={() => !saving && setCreateOpen(false)}
        title="New Period"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="period-create-form" disabled={saving}>
              {saving ? 'Creating...' : 'Create Period'}
            </Button>
          </>
        }
      >
        <form id="period-create-form" onSubmit={submitCreate} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Label">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="Q1 2026"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </Field>
          <Field label="Kind">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing != null}
        onClose={() => !saving && setEditing(null)}
        title="Edit Period"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="period-edit-form" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </>
        }
      >
        <form id="period-edit-form" onSubmit={submitEdit} className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formError}
            </div>
          )}
          <Field label="Label">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </Field>
          <Field label="Kind">
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              />
            </Field>
          </div>
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
