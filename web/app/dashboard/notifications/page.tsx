'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'

interface Notification {
  id: string
  user_id: string
  workspace_id: string | null
  kind: string | null
  title: string | null
  body: string | null
  read: boolean
  created_at: string
}

const KIND_TONE: Record<string, 'success' | 'neutral' | 'warning' | 'danger' | 'info'> = {
  dispute: 'warning',
  reconciliation: 'info',
  recon: 'info',
  clawback: 'danger',
  adjustment: 'info',
  derivation: 'info',
  period: 'neutral',
  resolved: 'success',
  alert: 'danger',
}

function kindTone(kind: string | null) {
  return KIND_TONE[(kind ?? '').toLowerCase()] ?? 'neutral'
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Notification[]>([])
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [markingAll, setMarkingAll] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const data: Notification[] = (await api.listNotifications()) ?? []
      setItems(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
      setItems([])
    }
  }, [])

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

  const markRead = async (n: Notification) => {
    if (n.read) return
    setBusyId(n.id)
    // optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as read')
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)))
    } finally {
      setBusyId(null)
    }
  }

  const markAll = async () => {
    setMarkingAll(true)
    setError(null)
    const snapshot = items
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all as read')
      setItems(snapshot)
    } finally {
      setMarkingAll(false)
    }
  }

  const kinds = useMemo(() => {
    const set = new Set<string>()
    for (const n of items) if (n.kind) set.add(n.kind)
    return Array.from(set).sort()
  }, [items])

  const stats = useMemo(() => {
    const total = items.length
    const unread = items.filter((n) => !n.read).length
    return { total, unread, read: total - unread }
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((n) => {
      if (filter === 'unread' && n.read) return false
      if (filter === 'read' && !n.read) return false
      if (kindFilter !== 'all' && (n.kind ?? '') !== kindFilter) return false
      if (!q) return true
      return (
        (n.title ?? '').toLowerCase().includes(q) ||
        (n.body ?? '').toLowerCase().includes(q) ||
        (n.kind ?? '').toLowerCase().includes(q)
      )
    })
  }, [items, filter, kindFilter, search])

  if (loading) return <PageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Activity across disputes, reconciliations, clawbacks, and derivation runs.
          </p>
        </div>
        <Button onClick={markAll} variant="secondary" disabled={markingAll || stats.unread === 0}>
          {markingAll ? 'Marking...' : `Mark all read${stats.unread ? ` (${stats.unread})` : ''}`}
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total" value={stats.total} />
        <Stat label="Unread" value={stats.unread} tone={stats.unread > 0 ? 'warning' : 'default'} />
        <Stat label="Read" value={stats.read} tone="success" />
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
              placeholder="Search notifications..."
              className="w-full max-w-xs rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-fuchsia-500 focus:outline-none"
            />
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-700">
              {(['all', 'unread', 'read'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-2 text-sm capitalize transition-colors ${
                    filter === f
                      ? 'bg-fuchsia-600 text-white'
                      : 'bg-slate-950 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
            {kinds.length > 0 && (
              <select
                value={kindFilter}
                onChange={(e) => setKindFilter(e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-fuchsia-500 focus:outline-none"
              >
                <option value="all">All kinds</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
          </div>
          <span className="text-xs text-slate-500">
            {filtered.length} of {items.length} shown
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No notifications"
                description="You're all caught up. New activity in this workspace will appear here."
                icon={<span>🔔</span>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matches" description="No notifications match your filters." />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-4 px-5 py-4 ${
                    n.read ? '' : 'bg-fuchsia-500/5'
                  }`}
                >
                  <div className="mt-1.5">
                    <span
                      className={`block h-2 w-2 rounded-full ${
                        n.read ? 'bg-slate-700' : 'bg-fuchsia-400'
                      }`}
                      aria-hidden
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`text-sm font-medium ${
                          n.read ? 'text-slate-300' : 'text-white'
                        }`}
                      >
                        {n.title || 'Notification'}
                      </span>
                      {n.kind && <Badge tone={kindTone(n.kind)}>{n.kind}</Badge>}
                      {!n.read && <Badge tone="info">new</Badge>}
                    </div>
                    {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-500">{timeAgo(n.created_at)}</p>
                  </div>
                  <div className="shrink-0">
                    {n.read ? (
                      <span className="text-xs text-slate-600">read</span>
                    ) : (
                      <Button
                        variant="ghost"
                        className="px-2 py-1 text-xs"
                        onClick={() => markRead(n)}
                        disabled={busyId === n.id}
                      >
                        {busyId === n.id ? <Spinner className="h-4" /> : 'Mark read'}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
