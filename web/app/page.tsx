import Link from 'next/link'

const features = [
  {
    title: 'Independent re-derivation engine',
    body: 'Recompute, from raw closed-won deals and a versioned comp-plan model, exactly what every rep should have been paid — deterministic, reproducible, fully decomposed.',
  },
  {
    title: 'Line-by-line reconciliation',
    body: 'Compare expected vs. actually-paid at every level. Each delta is classified overpaid, underpaid, matched, or unexplained, with a tolerance threshold to silence noise.',
  },
  {
    title: 'Dispute case manager',
    body: 'Turn any discrepancy into a tracked case: the claim, the disputed deals, the snapshot calculation, the comment thread, and the resolution as a permanent audit record.',
  },
  {
    title: 'Versioned comp-plan modeler',
    body: 'Encode base rates, tiers, accelerators, caps, and split rules as immutable versioned data. Every re-derivation pins to a version, so the math is always traceable.',
  },
  {
    title: 'Split-credit reconciliation',
    body: 'Multi-rep deals are where the money hides. Flag every deal whose split credit does not sum to 100% and roll up split integrity across the period.',
  },
  {
    title: 'Cost-of-error report',
    body: 'Quantify the impact: recoverable overpayment, underpayment exposure, error rate, and trend over periods — the headline ROI number for RevOps and finance.',
  },
  {
    title: 'Clawback & adjustment tracker',
    body: 'When a deal refunds or an account churns, track the clawback and any manual adjustment, linked straight to the dispute resolution that justified it.',
  },
  {
    title: 'Audit trail & calculation explainer',
    body: 'Every write is logged with before/after. Every payout line expands into the exact rule, rate, tier, accelerator, cap, and split that produced it.',
  },
  {
    title: 'One-click sample data',
    body: 'Seed a complete demo workspace with an intentionally flawed commission run, so the reconciliation lights up immediately with zero setup.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <span className="text-xl font-bold tracking-tight">
          <span className="text-emerald-400">Commission</span>
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
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
          The second opinion for variable comp
        </span>
        <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Audit every commission check
          <br />
          <span className="text-emerald-400">before the rep does.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          CommissionDisputeLedger re-derives what every rep should have been paid from raw deals and a versioned
          comp plan, reconciles it line-by-line against what the commission tool actually paid, and turns every
          discrepancy into a tracked, auditable dispute.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-500"
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
          <h2 className="text-center text-2xl font-bold sm:text-3xl">Comp disputes recur every pay period</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            When a rep believes their check is wrong, RevOps cannot just trust the tool that produced it. Today the
            rebuild happens in throwaway spreadsheets. We make that shadow ledger systematic.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { h: 'Overpayments leak cash', p: 'Miscoded deals and missed clawbacks quietly overpay reps month after month. Nobody reconciles backward.' },
              { h: 'Underpayments drive attrition', p: 'A rep shorted on an accelerator or tier crossover loses trust fast — and starts interviewing.' },
              { h: 'Disputes have no audit trail', p: '"Trust me, I recalculated it" does not survive a SOX audit, a finance review, or an angry rep.' },
              { h: 'Splits never reconcile to 100%', p: 'Multi-rep splits that sum to 95% or 110% are invisible until someone re-derives them.' },
            ].map((x) => (
              <div key={x.h} className="rounded-xl border border-slate-800 bg-slate-950/60 p-5">
                <h3 className="text-sm font-semibold text-emerald-300">{x.h}</h3>
                <p className="mt-2 text-sm text-slate-400">{x.p}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">A complete audit & reconciliation layer</h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            Not a comp calculator — the adversarial checker that sits next to it and grades its output.
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
          <h2 className="text-2xl font-bold sm:text-3xl">Recover overpayments. Defend every number.</h2>
          <p className="mt-4 text-slate-400">
            Spin up a demo workspace in one click and watch the reconciliation light up.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-500"
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
