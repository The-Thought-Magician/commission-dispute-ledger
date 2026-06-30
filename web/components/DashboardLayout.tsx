'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Workspaces', href: '/dashboard/workspaces' },
    ],
  },
  {
    title: 'Comp Model',
    items: [
      { label: 'Plans', href: '/dashboard/plans' },
      { label: 'Reps', href: '/dashboard/reps' },
      { label: 'Periods', href: '/dashboard/periods' },
    ],
  },
  {
    title: 'Source Data',
    items: [
      { label: 'Deals', href: '/dashboard/deals' },
      { label: 'Actuals', href: '/dashboard/actuals' },
    ],
  },
  {
    title: 'Audit & Reconcile',
    items: [
      { label: 'Derivations', href: '/dashboard/derivations' },
      { label: 'Reconciliations', href: '/dashboard/reconciliations' },
      { label: 'Splits', href: '/dashboard/splits' },
      { label: 'Cost of Error', href: '/dashboard/cost-of-error' },
    ],
  },
  {
    title: 'Resolution',
    items: [
      { label: 'Disputes', href: '/dashboard/disputes' },
      { label: 'Clawbacks', href: '/dashboard/clawbacks' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
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

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-500" />
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <Link href="/dashboard" className="px-2 text-lg font-bold tracking-tight">
        <span className="text-emerald-400">Commission</span>
        <span className="text-white">DisputeLedger</span>
      </Link>
      <div className="flex flex-1 flex-col gap-5">
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                        active
                          ? 'bg-emerald-500/15 font-medium text-emerald-300'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-slate-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 bg-slate-900/40 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/80" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 border-r border-slate-800 bg-slate-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 bg-slate-900/40 px-4 py-3 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-slate-400">Workspace audit ledger</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-300 sm:inline">{userLabel}</span>
            <button
              onClick={signOut}
              className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
