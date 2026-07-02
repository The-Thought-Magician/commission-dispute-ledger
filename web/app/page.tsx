import Link from 'next/link'

const features = [
  {
    title: 'Independent re-derivation engine',
    body: 'We recompute what every rep should have been paid, straight from raw closed-won deals and your versioned comp plan. Deterministic. Reproducible. No trust required.',
  },
  {
    title: 'Line-by-line reconciliation',
    body: 'Expected vs. actually-paid, at every line. Overpaid, underpaid, matched, or unexplained. Set a tolerance and stop drowning in rounding noise.',
  },
  {
    title: 'Dispute case manager',
    body: 'Every discrepancy becomes a case. Claim, disputed deals, snapshot calculation, comment thread, resolution. One record, permanently.',
  },
  {
    title: 'Versioned comp-plan modeler',
    body: 'Base rates, tiers, accelerators, caps, splits — locked as immutable versioned data. Every re-derivation pins to a version. The math never drifts.',
  },
  {
    title: 'Split-credit reconciliation',
    body: 'Multi-rep deals are where the money hides. We flag every split that does not sum to 100% and roll up split integrity for the whole period.',
  },
  {
    title: 'Cost-of-error report',
    body: 'Recoverable overpayment. Underpayment exposure. Error rate. Trend by period. This is the number finance actually wants.',
  },
  {
    title: 'Clawback & adjustment tracker',
    body: 'A deal refunds, an account churns — the clawback gets tracked and linked straight to the dispute that justified it. No orphaned adjustments.',
  },
  {
    title: 'Audit trail & calculation explainer',
    body: 'Every write is logged, before and after. Every payout line expands into the exact rule, rate, tier, accelerator, cap, and split behind it.',
  },
  {
    title: 'One-click sample data',
    body: 'Seed a demo workspace with a broken commission run in one click. See the reconciliation light up before you touch real data.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">
          <span className="text-fuchsia-400">Commission</span>
          <span className="text-white">DisputeLedger</span>
        </span>
        <div className="flex items-center gap-3 sm:gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">
            Pricing
          </Link>
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

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1 text-xs font-medium text-fuchsia-300">
          Stop losing commission disputes to slow evidence
        </span>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Audit the check
          <br />
          <span className="text-fuchsia-400">before the rep disputes it.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          We re-derive what every rep should have been paid from raw deals and your versioned comp plan.
          We reconcile it line-by-line against what actually got paid. Every gap becomes a tracked, auditable
          dispute. No spreadsheet archaeology.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-fuchsia-600 px-6 py-3 text-base font-semibold text-white hover:bg-fuchsia-500"
          >
            Start auditing free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-slate-500">Every feature is free for any signed-in user.</p>
      </section>

      {/* Problem */}
      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Every pay period, the same fight</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            A rep flags a wrong check. RevOps cannot just trust the tool that produced it. Right now that rebuild
            happens in a throwaway spreadsheet, once, under deadline. We make it systematic instead.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { h: 'Overpayments leak cash', p: 'Miscoded deals and missed clawbacks overpay reps, month after month. Nobody reconciles backward until it is too late.' },
              { h: 'Underpayments drive attrition', p: 'Shorted on an accelerator once, a rep starts interviewing. Trust does not come back after a bad check.' },
              { h: 'Disputes have no audit trail', p: '"Trust me, I recalculated it" does not survive a SOX audit, a finance review, or an angry rep with a spreadsheet.' },
              { h: 'Splits never reconcile to 100%', p: 'Multi-rep splits landing at 95% or 110% stay invisible until someone re-derives them by hand.' },
            ].map((x) => (
              <div key={x.h} className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                <h3 className="text-sm font-semibold text-fuchsia-300">{x.h}</h3>
                <p className="mt-2 text-sm text-slate-400">{x.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">A full audit and reconciliation layer</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            Not a comp calculator. The checker that sits next to it and grades its output, every period.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
                <h3 className="text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-slate-800 bg-slate-900/30 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-bold sm:text-3xl">Recover the overpayments. Defend every number.</h2>
          <p className="mt-4 text-slate-400">
            Spin up a demo workspace in one click. Watch the reconciliation light up. See the gaps before payday.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-fuchsia-600 px-6 py-3 text-base font-semibold text-white hover:bg-fuchsia-500"
            >
              Get Started
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-slate-700 bg-slate-950 px-6 py-3 text-base font-semibold text-slate-200 hover:bg-slate-800"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>CommissionDisputeLedger — the independent audit ledger for sales commission payouts.</p>
      </footer>
    </main>
  )
}
