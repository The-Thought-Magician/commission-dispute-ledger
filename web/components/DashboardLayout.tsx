'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'
import CommandPalette, { type PaletteRoute } from '@/components/CommandPalette'

type NavItem = { label: string; href: string; icon: string }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: 'DB' },
      { label: 'Workspaces', href: '/dashboard/workspaces', icon: 'WS' },
    ],
  },
  {
    title: 'Comp Model',
    items: [
      { label: 'Plans', href: '/dashboard/plans', icon: 'PL' },
      { label: 'Reps', href: '/dashboard/reps', icon: 'RP' },
      { label: 'Periods', href: '/dashboard/periods', icon: 'PD' },
    ],
  },
  {
    title: 'Source Data',
    items: [
      { label: 'Deals', href: '/dashboard/deals', icon: 'DL' },
      { label: 'Actuals', href: '/dashboard/actuals', icon: 'AC' },
    ],
  },
  {
    title: 'Audit & Reconcile',
    items: [
      { label: 'Derivations', href: '/dashboard/derivations', icon: 'DV' },
      { label: 'Reconciliations', href: '/dashboard/reconciliations', icon: 'RC' },
      { label: 'Splits', href: '/dashboard/splits', icon: 'SP' },
      { label: 'Cost of Error', href: '/dashboard/cost-of-error', icon: 'CE' },
    ],
  },
  {
    title: 'Resolution',
    items: [
      { label: 'Disputes', href: '/dashboard/disputes', icon: 'DP' },
      { label: 'Clawbacks', href: '/dashboard/clawbacks', icon: 'CB' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Reports', href: '/dashboard/reports', icon: 'RE' },
      { label: 'Notifications', href: '/dashboard/notifications', icon: 'NO' },
      { label: 'Settings', href: '/dashboard/settings', icon: 'ST' },
    ],
  },
]

const PALETTE_ROUTES: PaletteRoute[] = SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ label: i.label, href: i.href, group: s.title }))
)

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [userLabel, setUserLabel] = useState<string>('')

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const s = await authClient.getSession()
      const user = (s as any)?.data?.user
      if (!user) {
        router.push('/auth/sign-in')
        return
      }
      if (mounted) {
        setUserLabel(user.name || user.email || 'Account')
        setReady(true)
      }
    })()
    return () => {
      mounted = false
    }
  }, [router])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-fuchsia-500" />
      </div>
    )
  }

  const allItems = SECTIONS.flatMap((s) => s.items)
  const activeItem = allItems.find((i) => isActive(pathname, i.href))

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Icon-only rail */}
      <aside className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900/40 py-4 lg:flex">
        <Link
          href="/dashboard"
          className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/15 text-xs font-bold text-fuchsia-400"
          title="CommissionDisputeLedger"
        >
          CD
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto">
          {allItems.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-semibold transition-colors ${
                  active
                    ? 'bg-fuchsia-500/15 text-fuchsia-300'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {item.icon}
              </Link>
            )
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/40 px-4 py-3 lg:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="text-sm font-bold tracking-tight lg:hidden">
              <span className="text-fuchsia-400">Commission</span>
              <span className="text-white">DisputeLedger</span>
            </Link>
            <span className="hidden truncate text-sm font-medium text-slate-400 lg:inline">
              {activeItem ? activeItem.label : 'Workspace audit ledger'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <CommandPalette routes={PALETTE_ROUTES} />
            <span className="hidden text-sm text-slate-300 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </header>
        {/* Mobile nav strip — every route reachable without the rail */}
        <div className="flex gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900/30 px-3 py-2 lg:hidden">
          {allItems.map((item) => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium ${
                  active ? 'bg-fuchsia-500/15 text-fuchsia-300' : 'text-slate-400 hover:bg-slate-800'
                }`}
              >
                {item.label}
              </Link>
            )
          })}
        </div>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
