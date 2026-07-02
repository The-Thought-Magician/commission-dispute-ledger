'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { getActiveWorkspaceId, setActiveWorkspaceId } from '@/lib/workspace'
import { Card, CardBody } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

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

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR']
const ROUNDING = ['half_up', 'half_even', 'floor', 'ceil']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export default function WorkspacesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // create modal
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [fiscalStart, setFiscalStart] = useState(1)
  const [rounding, setRounding] = useState('half_up')
  const [tolerance, setTolerance] = useState('100')

  // seed
  const [seeding, setSeeding] = useState(false)
  const [seedErrors, setSeedErrors] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = (await api.listWorkspaces()) as Workspace[]
      const ws = Array.isArray(list) ? list : []
      setWorkspaces(ws)
      const stored = getActiveWorkspaceId()
      const resolved = ws.find((w) => w.id === stored)?.id ?? ws[0]?.id ?? null
      setActiveId(resolved)
      if (resolved) setActiveWorkspaceId(resolved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((w) => w.name.toLowerCase().includes(q))
  }, [workspaces, search])

  const resetForm = () => {
    setName('')
    setCurrency('USD')
    setFiscalStart(1)
    setRounding('half_up')
    setTolerance('100')
    setFormErr(null)
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setFormErr('Workspace name is required')
      return
    }
    setCreating(true)
    setFormErr(null)
    try {
      const created = (await api.createWorkspace({
        name: name.trim(),
        currency,
        fiscal_start_month: fiscalStart,
        rounding_mode: rounding,
        default_tolerance_cents: Math.max(0, parseInt(tolerance, 10) || 0),
      })) as Workspace
      setShowCreate(false)
      resetForm()
      setActiveWorkspaceId(created.id)
      await load()
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to create workspace')
    } finally {
      setCreating(false)
    }
  }

  const handleSwitch = (id: string) => {
    setActiveId(id)
    setActiveWorkspaceId(id)
  }

  const handleSeed = async () => {
    setSeeding(true)
    setError(null)
    try {
      const res = (await api.seedDemo({ with_errors: seedErrors })) as { workspace_id?: string }
      if (res?.workspace_id) setActiveWorkspaceId(res.workspace_id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed demo data')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading workspaces…" />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-400">
            Each workspace is an isolated commission ledger with its own plans, reps, and reconciliations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
            {seeding ? 'Seeding…' : 'Seed demo'}
          </Button>
          <Button onClick={() => setShowCreate(true)}>New workspace</Button>
        </div>
      </div>

      {error && (
        <Card>
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-red-300">{error}</span>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Seed options */}
      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-slate-200">One-click demo data</div>
            <p className="text-xs text-slate-500">
              Spin up a fully populated workspace with plans, reps, deals, derivations, and reconciliations.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={seedErrors}
              onChange={(e) => setSeedErrors(e.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-fuchsia-500 focus:ring-fuchsia-500/40"
            />
            Inject deliberate payout errors
          </label>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workspaces…"
          className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
        />
        <span className="text-xs text-slate-500">
          {filtered.length} of {workspaces.length}
        </span>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="No workspaces yet"
          description="Create a workspace from scratch or load demo data to explore the audit pipeline."
          action={
            <div className="flex gap-2">
              <Button onClick={() => setShowCreate(true)}>New workspace</Button>
              <Button variant="secondary" onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding…' : 'Seed demo'}
              </Button>
            </div>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No matches" description="No workspaces match your search." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((w) => {
            const isActive = w.id === activeId
            return (
              <Card
                key={w.id}
                className={isActive ? 'border-fuchsia-500/50 ring-1 ring-fuchsia-500/20' : ''}
              >
                <CardBody className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-base font-semibold text-white">{w.name}</h3>
                        {isActive && <Badge tone="success">Active</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {w.currency || 'USD'} · FY starts {MONTHS[(w.fiscal_start_month ?? 1) - 1] ?? '—'}
                      </p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Rounding</dt>
                      <dd className="text-slate-300">{(w.rounding_mode || 'half_up').replace(/_/g, ' ')}</dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Tolerance</dt>
                      <dd className="text-slate-300">
                        {((w.default_tolerance_cents ?? 0) / 100).toLocaleString('en-US', {
                          style: 'currency',
                          currency: w.currency || 'USD',
                        })}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      variant={isActive ? 'secondary' : 'primary'}
                      className="flex-1"
                      onClick={() => handleSwitch(w.id)}
                      disabled={isActive}
                    >
                      {isActive ? 'Selected' : 'Switch'}
                    </Button>
                    <Link href={`/dashboard/workspaces/${w.id}`} className="flex-1">
                      <Button variant="secondary" className="w-full">
                        Settings
                      </Button>
                    </Link>
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => {
          if (!creating) {
            setShowCreate(false)
            resetForm()
          }
        }}
        title="New workspace"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setShowCreate(false)
                resetForm()
              }}
              disabled={creating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? <Spinner /> : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {formErr}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-400">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Sales — FY26"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
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
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              >
                {ROUNDING.map((r) => (
                  <option key={r} value={r}>
                    {r.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-400">Default tolerance (cents)</label>
              <input
                type="number"
                min={0}
                value={tolerance}
                onChange={(e) => setTolerance(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
