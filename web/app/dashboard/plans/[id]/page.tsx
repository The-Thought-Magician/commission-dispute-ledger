'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Plan = {
  id: string
  workspace_id: string
  name: string
  description?: string | null
  currency?: string | null
  effective_start?: string | null
  effective_end?: string | null
}
type PlanVersion = {
  id: string
  comp_plan_id: string
  version_number: number
  base_rate?: number | string | null
  rate_basis?: string | null
  notes?: string | null
  created_at?: string | null
}
type Tier = {
  id: string
  plan_version_id: string
  lower_bound?: number | string | null
  upper_bound?: number | string | null
  rate?: number | string | null
  multiplier?: number | string | null
  sort_order?: number | null
}
type Accelerator = {
  id: string
  plan_version_id: string
  threshold_attainment?: number | string | null
  multiplier?: number | string | null
  per_period_cap_cents?: number | null
  per_deal_cap_cents?: number | null
}
type SplitRule = {
  id: string
  plan_version_id: string
  role?: string | null
  percentage?: number | string | null
  is_default?: boolean | null
}
type ValidateResult = { valid: boolean; issues: string[] }
type SplitCheck = { total: number; ok: boolean; policy?: string }

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none'

function num(v: unknown): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? n : 0
}
function fmtCents(c?: number | null) {
  if (c === null || c === undefined) return '—'
  return `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [versions, setVersions] = useState<PlanVersion[]>([])
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null)
  const [tiers, setTiers] = useState<Tier[]>([])
  const [accelerators, setAccelerators] = useState<Accelerator[]>([])
  const [splits, setSplits] = useState<SplitRule[]>([])
  const [validation, setValidation] = useState<ValidateResult | null>(null)
  const [splitCheck, setSplitCheck] = useState<SplitCheck | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [childLoading, setChildLoading] = useState(false)

  const activeVersion = useMemo(
    () => versions.find((v) => v.id === activeVersionId) ?? null,
    [versions, activeVersionId],
  )

  const loadVersionChildren = useCallback(async (versionId: string) => {
    setChildLoading(true)
    try {
      const [tierResp, splitRows, valid, check] = await Promise.all([
        api.listTiers(versionId),
        api.listSplitRules(versionId),
        api.validateTiers(versionId),
        api.checkSplitRules(versionId),
      ])
      // /tiers returns { tiers, accelerators }
      const t = (tierResp?.tiers ?? tierResp ?? []) as Tier[]
      const a = (tierResp?.accelerators ?? []) as Accelerator[]
      setTiers(Array.isArray(t) ? t : [])
      setAccelerators(Array.isArray(a) ? a : [])
      setSplits(Array.isArray(splitRows) ? (splitRows as SplitRule[]) : [])
      setValidation((valid as ValidateResult) ?? null)
      setSplitCheck((check as SplitCheck) ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load version detail')
    } finally {
      setChildLoading(false)
    }
  }, [])

  const loadAll = useCallback(async () => {
    setError(null)
    const [detail, vers] = await Promise.all([api.getPlan(id), api.listPlanVersions(id)])
    // getPlan may return { ...plan, versions } or PlanDetail
    const p = (detail?.plan ?? detail) as Plan
    setPlan(p)
    const vlist = (Array.isArray(vers) ? vers : (detail?.versions ?? [])) as PlanVersion[]
    const sorted = [...vlist].sort((a, b) => num(b.version_number) - num(a.version_number))
    setVersions(sorted)
    return sorted
  }, [id])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const sorted = await loadAll()
        if (!mounted) return
        const latest = sorted[0]?.id ?? null
        setActiveVersionId(latest)
        if (latest) await loadVersionChildren(latest)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load plan')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadAll, loadVersionChildren])

  function selectVersion(vid: string) {
    setActiveVersionId(vid)
    loadVersionChildren(vid)
  }

  // ---- header edit ----
  const [editOpen, setEditOpen] = useState(false)

  // ---- new version ----
  const [versionOpen, setVersionOpen] = useState(false)

  // ---- tier modal ----
  const [tierModal, setTierModal] = useState<{ mode: 'create' | 'edit'; tier?: Tier } | null>(null)
  // ---- accel modal ----
  const [accelModal, setAccelModal] = useState<{ mode: 'create' | 'edit'; accel?: Accelerator } | null>(
    null,
  )
  // ---- split modal ----
  const [splitModal, setSplitModal] = useState<{ mode: 'create' | 'edit'; split?: SplitRule } | null>(
    null,
  )

  async function refreshChildren() {
    if (activeVersionId) await loadVersionChildren(activeVersionId)
  }

  async function deleteTier(t: Tier) {
    try {
      await api.deleteTier(t.id)
      await refreshChildren()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete tier')
    }
  }
  async function deleteAccel(a: Accelerator) {
    try {
      await api.deleteAccelerator(a.id)
      await refreshChildren()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete accelerator')
    }
  }
  async function deleteSplit(s: SplitRule) {
    try {
      await api.deleteSplitRule(s.id)
      await refreshChildren()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete split rule')
    }
  }

  if (loading) return <PageSpinner label="Loading plan..." />

  if (error && !plan) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/plans" className="text-sm text-fuchsia-400 hover:underline">
          ← Back to plans
        </Link>
        <EmptyState title="Could not load plan" description={error} />
      </div>
    )
  }

  const splitTotal = splits.reduce((acc, s) => acc + num(s.percentage), 0)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/plans" className="text-sm text-fuchsia-400 hover:underline">
          ← Back to plans
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">{plan?.name}</h1>
          {plan?.description && <p className="mt-1 max-w-2xl text-sm text-slate-400">{plan.description}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge tone="info">{plan?.currency || 'USD'}</Badge>
            <span>{versions.length} version{versions.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setEditOpen(true)}>
            Edit header
          </Button>
          <Link href={`/dashboard/plans/${id}/compare`}>
            <Button variant="secondary">Compare versions</Button>
          </Link>
          <Button onClick={() => setVersionOpen(true)}>New version</Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Version selector */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-white">Versions</h2>
        </CardHeader>
        <CardBody>
          {versions.length === 0 ? (
            <EmptyState
              title="No versions yet"
              description="Create the first version to start adding tiers, accelerators, and splits."
              action={<Button onClick={() => setVersionOpen(true)}>New version</Button>}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {versions.map((v) => {
                const active = v.id === activeVersionId
                return (
                  <button
                    key={v.id}
                    onClick={() => selectVersion(v.id)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      active
                        ? 'border-fuchsia-500/50 bg-fuchsia-500/15 text-fuchsia-200'
                        : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="font-semibold">v{v.version_number}</div>
                    <div className="text-xs text-slate-500">
                      base {num(v.base_rate)}
                      {v.rate_basis ? ` / ${v.rate_basis}` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {activeVersion && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Active version" value={`v${activeVersion.version_number}`} />
            <Stat label="Base rate" value={num(activeVersion.base_rate)} hint={activeVersion.rate_basis || ''} />
            <Stat
              label="Tier integrity"
              value={validation ? (validation.valid ? 'Valid' : `${validation.issues.length} issue${validation.issues.length === 1 ? '' : 's'}`) : '—'}
              tone={validation ? (validation.valid ? 'success' : 'danger') : 'default'}
            />
            <Stat
              label="Split total"
              value={`${splitCheck ? num(splitCheck.total) : splitTotal}%`}
              tone={splitCheck ? (splitCheck.ok ? 'success' : 'warning') : 'default'}
              hint={splitCheck?.policy || 'sum-to-100'}
            />
          </div>

          {childLoading ? (
            <div className="py-10">
              <Spinner label="Loading version detail..." />
            </div>
          ) : (
            <>
              {/* Tier validation banner */}
              {validation && !validation.valid && (
                <Card className="border-red-500/30">
                  <CardHeader className="border-red-500/20">
                    <h3 className="text-sm font-semibold text-red-300">Tier integrity issues</h3>
                  </CardHeader>
                  <CardBody>
                    <ul className="list-inside list-disc space-y-1 text-sm text-red-200">
                      {validation.issues.map((iss, i) => (
                        <li key={i}>{iss}</li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}

              {/* Tiers */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Rate tiers</h3>
                    <p className="text-xs text-slate-500">Bracketed rates by attainment / amount.</p>
                  </div>
                  <Button onClick={() => setTierModal({ mode: 'create' })}>Add tier</Button>
                </CardHeader>
                <CardBody className="p-0">
                  {tiers.length === 0 ? (
                    <div className="px-5 py-6">
                      <EmptyState title="No tiers" description="Add tiers to define bracketed rates." />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>#</TH>
                          <TH>Lower</TH>
                          <TH>Upper</TH>
                          <TH>Rate</TH>
                          <TH>Multiplier</TH>
                          <TH className="text-right">Actions</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {[...tiers]
                          .sort((a, b) => num(a.sort_order) - num(b.sort_order))
                          .map((t) => (
                            <TR key={t.id}>
                              <TD>{t.sort_order ?? '—'}</TD>
                              <TD>{num(t.lower_bound)}</TD>
                              <TD>{t.upper_bound === null || t.upper_bound === undefined ? '∞' : num(t.upper_bound)}</TD>
                              <TD>{num(t.rate)}</TD>
                              <TD>{num(t.multiplier) || 1}×</TD>
                              <TD>
                                <div className="flex justify-end gap-2">
                                  <Button variant="ghost" className="px-2 py-1" onClick={() => setTierModal({ mode: 'edit', tier: t })}>
                                    Edit
                                  </Button>
                                  <Button variant="danger" className="px-2 py-1" onClick={() => deleteTier(t)}>
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

              {/* Accelerators */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Accelerators</h3>
                    <p className="text-xs text-slate-500">Multipliers above attainment thresholds with caps.</p>
                  </div>
                  <Button onClick={() => setAccelModal({ mode: 'create' })}>Add accelerator</Button>
                </CardHeader>
                <CardBody className="p-0">
                  {accelerators.length === 0 ? (
                    <div className="px-5 py-6">
                      <EmptyState title="No accelerators" description="Add accelerators for overattainment kickers." />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Threshold attainment</TH>
                          <TH>Multiplier</TH>
                          <TH>Per-period cap</TH>
                          <TH>Per-deal cap</TH>
                          <TH className="text-right">Actions</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {accelerators.map((a) => (
                          <TR key={a.id}>
                            <TD>{num(a.threshold_attainment)}%</TD>
                            <TD>{num(a.multiplier)}×</TD>
                            <TD>{fmtCents(a.per_period_cap_cents)}</TD>
                            <TD>{fmtCents(a.per_deal_cap_cents)}</TD>
                            <TD>
                              <div className="flex justify-end gap-2">
                                <Button variant="ghost" className="px-2 py-1" onClick={() => setAccelModal({ mode: 'edit', accel: a })}>
                                  Edit
                                </Button>
                                <Button variant="danger" className="px-2 py-1" onClick={() => deleteAccel(a)}>
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

              {/* Split rules */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-white">Split rules</h3>
                    <p className="text-xs text-slate-500">
                      Role-based credit splits.{' '}
                      {splitCheck && (
                        <span className={splitCheck.ok ? 'text-fuchsia-400' : 'text-amber-400'}>
                          Total {num(splitCheck.total)}% — {splitCheck.ok ? 'OK' : 'off policy'}
                        </span>
                      )}
                    </p>
                  </div>
                  <Button onClick={() => setSplitModal({ mode: 'create' })}>Add split rule</Button>
                </CardHeader>
                <CardBody className="p-0">
                  {splits.length === 0 ? (
                    <div className="px-5 py-6">
                      <EmptyState title="No split rules" description="Add role-based split percentages." />
                    </div>
                  ) : (
                    <>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Role</TH>
                            <TH>Percentage</TH>
                            <TH>Default</TH>
                            <TH className="text-right">Actions</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {splits.map((s) => (
                            <TR key={s.id}>
                              <TD className="font-medium text-slate-100">{s.role || '—'}</TD>
                              <TD>{num(s.percentage)}%</TD>
                              <TD>{s.is_default ? <Badge tone="info">Default</Badge> : <span className="text-slate-500">—</span>}</TD>
                              <TD>
                                <div className="flex justify-end gap-2">
                                  <Button variant="ghost" className="px-2 py-1" onClick={() => setSplitModal({ mode: 'edit', split: s })}>
                                    Edit
                                  </Button>
                                  <Button variant="danger" className="px-2 py-1" onClick={() => deleteSplit(s)}>
                                    Delete
                                  </Button>
                                </div>
                              </TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                      {/* simple stacked bar of split distribution */}
                      <div className="px-5 py-4">
                        <div className="mb-1 flex justify-between text-xs text-slate-500">
                          <span>Split distribution</span>
                          <span>{splitTotal}%</span>
                        </div>
                        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800">
                          {splits.map((s, i) => {
                            const pct = Math.max(0, Math.min(100, num(s.percentage)))
                            const palette = ['bg-fuchsia-500', 'bg-teal-500', 'bg-sky-500', 'bg-amber-500', 'bg-violet-500']
                            return (
                              <div
                                key={s.id}
                                className={palette[i % palette.length]}
                                style={{ width: `${pct}%` }}
                                title={`${s.role}: ${pct}%`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    </>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}

      {/* Header edit modal */}
      {plan && (
        <EditHeaderModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          plan={plan}
          onSaved={async () => {
            setEditOpen(false)
            await loadAll()
          }}
          onError={setError}
        />
      )}

      {/* New version modal */}
      <NewVersionModal
        open={versionOpen}
        onClose={() => setVersionOpen(false)}
        planId={id}
        nextNumber={(versions[0]?.version_number ?? 0) + 1}
        onSaved={async (createdId) => {
          setVersionOpen(false)
          const sorted = await loadAll()
          const target = createdId ?? sorted[0]?.id ?? null
          setActiveVersionId(target)
          if (target) await loadVersionChildren(target)
        }}
        onError={setError}
      />

      {/* Tier modal */}
      {tierModal && activeVersionId && (
        <TierModal
          state={tierModal}
          versionId={activeVersionId}
          nextSort={tiers.length}
          onClose={() => setTierModal(null)}
          onSaved={async () => {
            setTierModal(null)
            await refreshChildren()
          }}
          onError={setError}
        />
      )}

      {/* Accelerator modal */}
      {accelModal && activeVersionId && (
        <AcceleratorModal
          state={accelModal}
          versionId={activeVersionId}
          onClose={() => setAccelModal(null)}
          onSaved={async () => {
            setAccelModal(null)
            await refreshChildren()
          }}
          onError={setError}
        />
      )}

      {/* Split modal */}
      {splitModal && activeVersionId && (
        <SplitModal
          state={splitModal}
          versionId={activeVersionId}
          onClose={() => setSplitModal(null)}
          onSaved={async () => {
            setSplitModal(null)
            await refreshChildren()
          }}
          onError={setError}
        />
      )}
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
        {label} {required && <span className="text-fuchsia-400">*</span>}
      </span>
      {children}
    </label>
  )
}

function EditHeaderModal({
  open,
  onClose,
  plan,
  onSaved,
  onError,
}: {
  open: boolean
  onClose: () => void
  plan: Plan
  onSaved: () => void
  onError: (m: string) => void
}) {
  const [name, setName] = useState(plan.name)
  const [description, setDescription] = useState(plan.description ?? '')
  const [currency, setCurrency] = useState(plan.currency ?? 'USD')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName(plan.name)
      setDescription(plan.description ?? '')
      setCurrency(plan.currency ?? 'USD')
    }
  }, [open, plan])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.updatePlan(plan.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        currency: currency.trim() || 'USD',
      })
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update plan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit plan header"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="edit-header-form" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </>
      }
    >
      <form id="edit-header-form" onSubmit={save} className="space-y-4">
        <Field label="Name" required>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </Field>
        <Field label="Currency">
          <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.toUpperCase())} className={inputCls} />
        </Field>
      </form>
    </Modal>
  )
}

function NewVersionModal({
  open,
  onClose,
  planId,
  nextNumber,
  onSaved,
  onError,
}: {
  open: boolean
  onClose: () => void
  planId: string
  nextNumber: number
  onSaved: (createdId: string | null) => void
  onError: (m: string) => void
}) {
  const [baseRate, setBaseRate] = useState('0')
  const [rateBasis, setRateBasis] = useState('revenue')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setBaseRate('0')
      setRateBasis('revenue')
      setNotes('')
    }
  }, [open])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const created = await api.createPlanVersion(planId, {
        base_rate: num(baseRate),
        rate_basis: rateBasis,
        notes: notes.trim() || undefined,
      })
      onSaved((created?.id as string) ?? null)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create version')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`New version (v${nextNumber})`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="new-version-form" disabled={saving}>
            {saving ? 'Creating...' : 'Create version'}
          </Button>
        </>
      }
    >
      <form id="new-version-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Base rate" required>
            <input type="number" step="0.0001" value={baseRate} onChange={(e) => setBaseRate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Rate basis">
            <select value={rateBasis} onChange={(e) => setRateBasis(e.target.value)} className={inputCls}>
              <option value="revenue">Revenue</option>
              <option value="margin">Margin</option>
              <option value="bookings">Bookings</option>
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="What changed in this version" className={inputCls} />
        </Field>
        <p className="text-xs text-slate-500">
          New versions are immutable snapshots. Tiers, accelerators, and splits attach to the version you create.
        </p>
      </form>
    </Modal>
  )
}

function TierModal({
  state,
  versionId,
  nextSort,
  onClose,
  onSaved,
  onError,
}: {
  state: { mode: 'create' | 'edit'; tier?: Tier }
  versionId: string
  nextSort: number
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const t = state.tier
  const [lower, setLower] = useState(t ? String(num(t.lower_bound)) : '0')
  const [upper, setUpper] = useState(t && t.upper_bound != null ? String(num(t.upper_bound)) : '')
  const [rate, setRate] = useState(t ? String(num(t.rate)) : '0')
  const [multiplier, setMultiplier] = useState(t ? String(num(t.multiplier) || 1) : '1')
  const [sortOrder, setSortOrder] = useState(t ? String(t.sort_order ?? 0) : String(nextSort))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        plan_version_id: versionId,
        lower_bound: num(lower),
        upper_bound: upper === '' ? null : num(upper),
        rate: num(rate),
        multiplier: num(multiplier) || 1,
        sort_order: parseInt(sortOrder, 10) || 0,
      }
      if (state.mode === 'create') await api.createTier(body)
      else if (t) await api.updateTier(t.id, body)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save tier')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={state.mode === 'create' ? 'Add tier' : 'Edit tier'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="tier-form" disabled={saving}>
            {saving ? 'Saving...' : 'Save tier'}
          </Button>
        </>
      }
    >
      <form id="tier-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Lower bound" required>
            <input type="number" step="0.01" value={lower} onChange={(e) => setLower(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Upper bound">
            <input type="number" step="0.01" value={upper} onChange={(e) => setUpper(e.target.value)} placeholder="blank = ∞" className={inputCls} />
          </Field>
          <Field label="Rate" required>
            <input type="number" step="0.0001" value={rate} onChange={(e) => setRate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Multiplier">
            <input type="number" step="0.01" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Sort order">
            <input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={inputCls} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

function AcceleratorModal({
  state,
  versionId,
  onClose,
  onSaved,
  onError,
}: {
  state: { mode: 'create' | 'edit'; accel?: Accelerator }
  versionId: string
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const a = state.accel
  const [threshold, setThreshold] = useState(a ? String(num(a.threshold_attainment)) : '100')
  const [multiplier, setMultiplier] = useState(a ? String(num(a.multiplier) || 1) : '1.5')
  const [periodCap, setPeriodCap] = useState(a && a.per_period_cap_cents != null ? String(a.per_period_cap_cents / 100) : '')
  const [dealCap, setDealCap] = useState(a && a.per_deal_cap_cents != null ? String(a.per_deal_cap_cents / 100) : '')
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        plan_version_id: versionId,
        threshold_attainment: num(threshold),
        multiplier: num(multiplier) || 1,
        per_period_cap_cents: periodCap === '' ? null : Math.round(num(periodCap) * 100),
        per_deal_cap_cents: dealCap === '' ? null : Math.round(num(dealCap) * 100),
      }
      if (state.mode === 'create') await api.createAccelerator(body)
      else if (a) await api.updateAccelerator(a.id, body)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save accelerator')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={state.mode === 'create' ? 'Add accelerator' : 'Edit accelerator'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="accel-form" disabled={saving}>
            {saving ? 'Saving...' : 'Save accelerator'}
          </Button>
        </>
      }
    >
      <form id="accel-form" onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Threshold attainment %" required>
            <input type="number" step="0.1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Multiplier" required>
            <input type="number" step="0.01" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Per-period cap ($)">
            <input type="number" step="0.01" value={periodCap} onChange={(e) => setPeriodCap(e.target.value)} placeholder="no cap" className={inputCls} />
          </Field>
          <Field label="Per-deal cap ($)">
            <input type="number" step="0.01" value={dealCap} onChange={(e) => setDealCap(e.target.value)} placeholder="no cap" className={inputCls} />
          </Field>
        </div>
      </form>
    </Modal>
  )
}

function SplitModal({
  state,
  versionId,
  onClose,
  onSaved,
  onError,
}: {
  state: { mode: 'create' | 'edit'; split?: SplitRule }
  versionId: string
  onClose: () => void
  onSaved: () => void
  onError: (m: string) => void
}) {
  const s = state.split
  const [role, setRole] = useState(s?.role ?? '')
  const [percentage, setPercentage] = useState(s ? String(num(s.percentage)) : '100')
  const [isDefault, setIsDefault] = useState(Boolean(s?.is_default))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const body = {
        plan_version_id: versionId,
        role: role.trim(),
        percentage: num(percentage),
        is_default: isDefault,
      }
      if (state.mode === 'create') await api.createSplitRule(body)
      else if (s) await api.updateSplitRule(s.id, body)
      onSaved()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save split rule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={state.mode === 'create' ? 'Add split rule' : 'Edit split rule'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="split-form" disabled={saving}>
            {saving ? 'Saving...' : 'Save rule'}
          </Button>
        </>
      }
    >
      <form id="split-form" onSubmit={save} className="space-y-4">
        <Field label="Role" required>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Account Executive" className={inputCls} />
        </Field>
        <Field label="Percentage" required>
          <input type="number" step="0.01" value={percentage} onChange={(e) => setPercentage(e.target.value)} className={inputCls} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-fuchsia-500" />
          Default split rule
        </label>
      </form>
    </Modal>
  )
}
