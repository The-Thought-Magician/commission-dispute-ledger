'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardHeader, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Workspace = {
  id: string
  name: string
  owner_id?: string
  currency?: string
  fiscal_start_month?: number
  rounding_mode?: string
  default_tolerance_cents?: number
  created_at?: string
}

type Member = {
  id: string
  workspace_id?: string
  user_id: string
  role?: string
  created_at?: string
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR']
const ROUNDING = ['half_up', 'half_even', 'floor', 'ceil']
const ROLES = ['admin', 'manager', 'finance', 'viewer']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [membersErr, setMembersErr] = useState<string | null>(null)

  // settings form
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fiscalStart, setFiscalStart] = useState(1)
  const [rounding, setRounding] = useState('half_up')
  const [tolerance, setTolerance] = useState('0')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  // invite
  const [showInvite, setShowInvite] = useState(false)
  const [inviteUser, setInviteUser] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [inviteErr, setInviteErr] = useState<string | null>(null)

  // remove member
  const [removingId, setRemovingId] = useState<string | null>(null)

  // archive
  const [showArchive, setShowArchive] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const syncForm = (w: Workspace) => {
    setName(w.name ?? '')
    setCurrency(w.currency ?? 'USD')
    setFiscalStart(w.fiscal_start_month ?? 1)
    setRounding(w.rounding_mode ?? 'half_up')
    setTolerance(String(w.default_tolerance_cents ?? 0))
  }

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const w = (await api.getWorkspace(id)) as Workspace
      setWorkspace(w)
      syncForm(w)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
      setLoading(false)
      return
    }
    // members are a separate, owner-only call — don't block the page on it
    try {
      const m = (await api.listMembers(id)) as Member[]
      setMembers(Array.isArray(m) ? m : [])
      setMembersErr(null)
    } catch (e) {
      setMembers([])
      setMembersErr(e instanceof Error ? e.message : 'Failed to load members')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (!id) return
    if (!name.trim()) {
      setSaveErr('Workspace name is required')
      return
    }
    setSaving(true)
    setSaveErr(null)
    setSaveMsg(null)
    try {
      const updated = (await api.updateWorkspace(id, {
        name: name.trim(),
        currency,
        fiscal_start_month: fiscalStart,
        rounding_mode: rounding,
        default_tolerance_cents: Math.max(0, parseInt(tolerance, 10) || 0),
      })) as Workspace
      setWorkspace(updated)
      syncForm(updated)
      setSaveMsg('Settings saved')
      setTimeout(() => setSaveMsg(null), 2500)
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleInvite = async () => {
    if (!id) return
    if (!inviteUser.trim()) {
      setInviteErr('User ID is required')
      return
    }
    setInviting(true)
    setInviteErr(null)
    try {
      await api.inviteMember(id, { user_id: inviteUser.trim(), role: inviteRole })
      setShowInvite(false)
      setInviteUser('')
      setInviteRole('viewer')
      const m = (await api.listMembers(id)) as Member[]
      setMembers(Array.isArray(m) ? m : [])
      setMembersErr(null)
    } catch (e) {
      setInviteErr(e instanceof Error ? e.message : 'Failed to invite member')
    } finally {
      setInviting(false)
    }
  }

  const handleRemove = async (memberId: string) => {
    if (!id) return
    setRemovingId(memberId)
    try {
      await api.removeMember(id, memberId)
      setMembers((prev) => prev.filter((m) => m.id !== memberId))
    } catch (e) {
      setMembersErr(e instanceof Error ? e.message : 'Failed to remove member')
    } finally {
      setRemovingId(null)
    }
  }

  const handleArchive = async () => {
    if (!id) return
    setArchiving(true)
    try {
      await api.archiveWorkspace(id)
      if (getActiveWorkspaceId() === id) setActiveWorkspaceId(null)
      router.push('/dashboard/workspaces')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive workspace')
      setArchiving(false)
      setShowArchive(false)
    }
  }

  const setActive = () => {
    if (id) setActiveWorkspaceId(id)
  }

  if (loading) return <PageSpinner label="Loading workspace…" />

  if (error && !workspace) {
    return (
      <div className="space-y-6">
        <Link href="/dashboard/workspaces" className="text-sm text-emerald-400 hover:text-emerald-300">
          ← Workspaces
        </Link>
        <Card>
          <CardBody>
            <div className="text-sm text-red-300">{error}</div>
            <Button className="mt-4" variant="secondary" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!workspace) {
    return (
      <EmptyState
        icon="🗂"
        title="Workspace not found"
        description="This workspace may have been archived or you may not have access."
        action={
          <Link href="/dashboard/workspaces">
            <Button>Back to workspaces</Button>
          </Link>
        }
      />
    )
  }

  const isActive = getActiveWorkspaceId() === id

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/dashboard/workspaces" className="text-sm text-emerald-400 hover:text-emerald-300">
            ← Workspaces
          </Link>
          <div className="mt-2 flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{workspace.name}</h1>
            {isActive && <Badge tone="success">Active</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Created {workspace.created_at ? new Date(workspace.created_at).toLocaleDateString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={setActive} disabled={isActive}>
            {isActive ? 'Selected' : 'Set active'}
          </Button>
          <Button variant="danger" onClick={() => setShowArchive(true)}>
            Archive
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Settings */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Settings</h2>
          <p className="text-xs text-slate-500">
            Currency, fiscal calendar, and reconciliation defaults for this ledger.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          {saveErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {saveErr}
            </div>
          )}
          {saveMsg && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
              {saveMsg}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Fiscal start month</label>
              <select
                value={fiscalStart}
                onChange={(e) => setFiscalStart(parseInt(e.target.value, 10))}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Rounding mode</label>
              <select
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              >
                {ROUNDING.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">
                Default tolerance (cents)
              </label>
              <input
                type="number"
                min={0}
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Spinner /> : 'Save settings'}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Members */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Members</h2>
            <p className="text-xs text-slate-500">People with access to this workspace.</p>
          </div>
          <Button onClick={() => setShowInvite(true)}>Invite member</Button>
        </CardHeader>
        <CardBody>
          {membersErr && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
              {membersErr}
            </div>
          )}
          {members.length === 0 ? (
            <EmptyState
              icon="👥"
              title="No members listed"
              description="Invite a teammate by their user ID to grant access to this workspace."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>User ID</TH>
                  <TH>Role</TH>
                  <TH>Added</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {members.map((m) => {
                  const isOwner = workspace.owner_id && m.user_id === workspace.owner_id
                  return (
                    <TR key={m.id}>
                      <TD className="font-mono text-xs">{m.user_id}</TD>
                      <TD>
                        <Badge tone={m.role === 'admin' || isOwner ? 'success' : 'neutral'}>
                          {isOwner ? 'owner' : m.role || 'member'}
                        </Badge>
                      </TD>
                      <TD className="text-slate-400">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                      </TD>
                      <TD className="text-right">
                        {isOwner ? (
                          <span className="text-xs text-slate-600">—</span>
                        ) : (
                          <Button
                            variant="danger"
                            className="px-3 py-1 text-xs"
                            onClick={() => handleRemove(m.id)}
                            disabled={removingId === m.id}
                          >
                            {removingId === m.id ? 'Removing…' : 'Remove'}
                          </Button>
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

      {/* Invite modal */}
      <Modal
        open={showInvite}
        onClose={() => {
          if (!inviting) {
            setShowInvite(false)
            setInviteErr(null)
          }
        }}
        title="Invite member"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowInvite(false)
                setInviteErr(null)
              }}
              disabled={inviting}
            >
              Cancel
            </Button>
            <Button onClick={handleInvite} disabled={inviting}>
              {inviting ? <Spinner /> : 'Invite'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {inviteErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {inviteErr}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">User ID</label>
            <input
              value={inviteUser}
              onChange={(e) => setInviteUser(e.target.value)}
              placeholder="user_…"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* Archive confirm */}
      <Modal
        open={showArchive}
        onClose={() => {
          if (!archiving) setShowArchive(false)
        }}
        title="Archive workspace"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowArchive(false)} disabled={archiving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleArchive} disabled={archiving}>
              {archiving ? <Spinner /> : 'Archive workspace'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Archive <span className="font-semibold text-white">{workspace.name}</span>? It will be removed from your
          active workspace list. This action is owner-only.
        </p>
      </Modal>
    </div>
  )
}
