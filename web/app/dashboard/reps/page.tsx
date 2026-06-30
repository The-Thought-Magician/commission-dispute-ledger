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

const STATUS_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger'> = {
  active: 'success',
  inactive: 'neutral',
  leave: 'warning',
  terminated: 'danger',
}

function statusTone(status: string | null) {
  return STATUS_TONE[(status ?? '').toLowerCase()] ?? 'neutral'
}

export default function RepsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [reps, setReps] = useState<Rep[]>([])

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', role: '', territory: '', status: 'active' })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deleting, setDeleting] = useState<Rep | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const loadReps = useCallback(async (wsId: string) => {
    setError(null)
    try {
      const data: Rep[] = (await api.listReps(wsId)) ?? []
      setReps(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reps')
      setReps([])
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
        await loadReps(active)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadReps])

  const onSwitchWorkspace = async (id: string) => {
    setWorkspaceId(id)
    setActiveWorkspaceId(id)
    setLoading(true)
    await loadReps(id)
    setLoading(false)
  }

  const submitCreate = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.createRep({
        workspace_id: workspaceId,
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        role: form.role.trim() || undefined,
        territory: form.territory.trim() || undefined,
        status: form.status,
      })
      setCreateOpen(false)
      setForm({ name: '', email: '', role: '', territory: '', status: 'active' })
      await loadReps(workspaceId)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create rep')
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      await api.deleteRep(deleting.id)
      setDeleting(null)
      await loadReps(workspaceId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete rep')
    } finally {
      setDeleteBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reps.filter((r) => {
      if (statusFilter !== 'all' && (r.status ?? '').toLowerCase() !== statusFilter) return false
      if (!q) return true
      return (
        r.name.toLowerCase().includes(q) ||
        (r.email ?? '').toLowerCase().includes(q) ||
        (r.role ?? '').toLowerCase().includes(q) ||
        (r.territory ?? '').toLowerCase().includes(q)
      )
    })
  }, [reps, search, statusFilter])

  const stats = useMemo(() => {
    const total = reps.length
    const active = reps.filter((r) => (r.status ?? '').toLowerCase() === 'active').length
    const territories = new Set(reps.map((r) => r.territory).filter(Boolean)).size
    const roles = new Set(reps.map((r) => r.role).filter(Boolean)).size
    return { total, active, territories, roles }
  }, [reps])

  if (loading) return <PageSpinner label="Loading reps..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Rep Roster</h1>
          <p className="mt-1 text-sm text-slate-400">
            Sales reps in this workspace, their territories, and employment status.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            + Add Rep
          </Button>
        </div>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace before adding reps."
          action={
            <Link href="/dashboard/workspaces">
              <Button variant="secondary">Go to Workspaces</Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Total Reps" value={stats.total} />
            <Stat label="Active" value={stats.active} tone="success" />
            <Stat label="Territories" value={stats.territories} />
            <Stat label="Roles" value={stats.roles} />
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
                  placeholder="Search name, email, role, territory..."
                  className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                >
                  <option value="all">All statuses</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="leave">Leave</option>
                  <option value="terminated">Terminated</option>
                </select>
              </div>
              <span className="text-xs text-slate-500">
                {filtered.length} of {reps.length} shown
              </span>
            </CardHeader>
            <CardBody className="p-0">
              {reps.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No reps yet"
                    description="Add your first sales rep to start building the comp roster."
                    action={<Button onClick={() => setCreateOpen(true)}>+ Add Rep</Button>}
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No matches" description="No reps match your search or filter." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Email</TH>
                      <TH>Role</TH>
                      <TH>Territory</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((r) => (
                      <TR key={r.id}>
                        <TD>
                          <Link
                            href={`/dashboard/reps/${r.id}`}
                            className="font-medium text-emerald-300 hover:text-emerald-200"
                          >
                            {r.name}
                          </Link>
                        </TD>
                        <TD className="text-slate-400">{r.email || '—'}</TD>
                        <TD className="text-slate-400">{r.role || '—'}</TD>
                        <TD className="text-slate-400">{r.territory || '—'}</TD>
                        <TD>
                          <Badge tone={statusTone(r.status)}>{r.status || 'unknown'}</Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-2">
                            <Link href={`/dashboard/reps/${r.id}`}>
                              <Button variant="ghost" className="px-2 py-1 text-xs">
                                View
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              className="px-2 py-1 text-xs text-red-400 hover:text-red-300"
                              onClick={() => setDeleting(r)}
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add Rep"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={saving}>
              {saving ? 'Saving...' : 'Create Rep'}
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
          <Field label="Name *">
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="Jordan Sales"
            />
          </Field>
          <Field label="Email">
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
              placeholder="jordan@company.com"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Role">
              <input
                value={form.role}
                onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                placeholder="AE"
              />
            </Field>
            <Field label="Territory">
              <input
                value={form.territory}
                onChange={(e) => setForm((f) => ({ ...f, territory: e.target.value }))}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
                placeholder="West"
              />
            </Field>
          </div>
          <Field label="Status">
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-emerald-500 focus:outline-none"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="leave">Leave</option>
              <option value="terminated">Terminated</option>
            </select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete Rep"
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
          Delete <span className="font-semibold text-white">{deleting?.name}</span>? This removes the rep from
          the roster. Historical credits and assignments may be affected.
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
