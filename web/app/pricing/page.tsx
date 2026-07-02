'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const allFeatures = [
  'Independent payout re-derivation engine',
  'Line-by-line reconciliation with delta classification',
  'Versioned comp-plan modeler (tiers, accelerators, caps, splits)',
  'Dispute case manager with calc snapshots & comments',
  'Split-credit reconciliation & integrity roll-ups',
  'Cost-of-error reporting & error-rate trend',
  'Clawback & adjustment tracker',
  'Quota & attainment tracking',
  'Audit trail & "explain this number" drill-down',
  'Reports & exports (recon, dispute, statement, accrual)',
  'Notifications, saved views & one-click demo data',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await api.getBillingPlan()
        if (mounted) setStripeEnabled(Boolean(res?.stripeEnabled))
      } catch {
        // billing/plan is public but may 401 when signed-out; treat as unconfigured for display
        if (mounted) setStripeEnabled(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold tracking-tight">
          <span className="text-fuchsia-400">Commission</span>
          <span className="text-white">DisputeLedger</span>
        </Link>
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white hover:bg-fuchsia-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-3xl font-bold sm:text-4xl">Simple pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-slate-400">
          Every feature is free for any signed-in user. A paid tier is wired but optional — there is nothing to buy
          today.
        </p>

        <div className="mx-auto mt-12 grid max-w-3xl gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="rounded-2xl border border-fuchsia-500/40 bg-slate-900/70 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Free</h2>
              <span className="rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-0.5 text-xs font-medium text-fuchsia-300">
                All features
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-slate-500">/ month</span>
            </div>
            <ul className="mt-6 space-y-2 text-sm text-slate-300">
              {allFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-fuchsia-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block w-full rounded-lg bg-fuchsia-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-fuchsia-500"
            >
              Start free
            </Link>
          </div>

          {/* Pro plan */}
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-400">
                {stripeEnabled === null ? 'Loading…' : stripeEnabled ? 'Available' : 'Coming soon'}
              </span>
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold">$49</span>
              <span className="text-slate-500">/ month</span>
            </div>
            <p className="mt-6 text-sm text-slate-400">
              Everything in Free, with higher limits and priority support once enabled. Billing is wired through
              Stripe and returns gracefully when not configured.
            </p>
            <button
              disabled
              className="mt-8 block w-full cursor-not-allowed rounded-lg border border-slate-700 bg-slate-800 px-4 py-3 text-center text-sm font-semibold text-slate-400 opacity-70"
            >
              {stripeEnabled ? 'Manage in dashboard' : 'Not available yet'}
            </button>
          </div>
        </div>

        <p className="mt-12 text-sm text-slate-500">
          Already have an account?{' '}
          <Link href="/auth/sign-in" className="text-fuchsia-400 hover:text-fuchsia-300">
            Sign in
          </Link>
        </p>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>CommissionDisputeLedger</p>
      </footer>
    </main>
  )
}
