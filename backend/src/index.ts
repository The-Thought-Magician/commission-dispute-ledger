import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  reps,
  periods,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspacesRoutes from './routes/workspaces.js'
import compPlansRoutes from './routes/comp-plans.js'
import tiersRoutes from './routes/tiers.js'
import splitRulesRoutes from './routes/split-rules.js'
import repsRoutes from './routes/reps.js'
import periodsRoutes from './routes/periods.js'
import dealsRoutes from './routes/deals.js'
import derivationsRoutes from './routes/derivations.js'
import actualsRoutes from './routes/actuals.js'
import reconciliationsRoutes from './routes/reconciliations.js'
import disputesRoutes from './routes/disputes.js'
import clawbacksRoutes from './routes/clawbacks.js'
import adjustmentsRoutes from './routes/adjustments.js'
import splitsReconRoutes from './routes/splits-recon.js'
import costOfErrorRoutes from './routes/cost-of-error.js'
import quotaRoutes from './routes/quota.js'
import auditRoutes from './routes/audit.js'
import notificationsRoutes from './routes/notifications.js'
import reportsRoutes from './routes/reports.js'
import viewsRoutes from './routes/views.js'
import dashboardRoutes from './routes/dashboard.js'
import seedRoutes from './routes/seed.js'
import billingRoutes from './routes/billing.js'
import statsRoutes from './routes/stats.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://commission-dispute-ledger-ventures.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/comp-plans', compPlansRoutes)
api.route('/tiers', tiersRoutes)
api.route('/split-rules', splitRulesRoutes)
api.route('/reps', repsRoutes)
api.route('/periods', periodsRoutes)
api.route('/deals', dealsRoutes)
api.route('/derivations', derivationsRoutes)
api.route('/actuals', actualsRoutes)
api.route('/reconciliations', reconciliationsRoutes)
api.route('/disputes', disputesRoutes)
api.route('/clawbacks', clawbacksRoutes)
api.route('/adjustments', adjustmentsRoutes)
api.route('/splits-recon', splitsReconRoutes)
api.route('/cost-of-error', costOfErrorRoutes)
api.route('/quota', quotaRoutes)
api.route('/audit', auditRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/reports', reportsRoutes)
api.route('/views', viewsRoutes)
api.route('/dashboard', dashboardRoutes)
api.route('/seed', seedRoutes)
api.route('/billing', billingRoutes)
api.route('/stats', statsRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

const DEMO_OWNER = 'demo-user'

// Idempotent seed: count-then-insert. Seeds billing plans + a small demo workspace.
async function seedIfEmpty() {
  // Billing plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 4900 },
    ])
    console.log('Seeded plans')
  }

  // Demo workspace + a couple of reps + a period
  const existingWs = await db.select().from(workspaces).limit(1)
  if (existingWs.length === 0) {
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Demo Workspace', owner_id: DEMO_OWNER, currency: 'USD' })
      .returning()

    await db.insert(workspace_members).values({
      workspace_id: ws.id,
      user_id: DEMO_OWNER,
      role: 'owner',
    })

    await db.insert(reps).values([
      { workspace_id: ws.id, name: 'Alex Rivera', email: 'alex@example.com', role: 'AE', territory: 'West' },
      { workspace_id: ws.id, name: 'Jordan Kim', email: 'jordan@example.com', role: 'AE', territory: 'East' },
    ])

    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    await db.insert(periods).values({
      workspace_id: ws.id,
      label: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
      kind: 'monthly',
      start_date: start,
      end_date: end,
      status: 'open',
    })

    console.log('Seeded demo workspace')
  }
}

const port = parseInt(process.env.PORT ?? '3001')

// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() + seedIfEmpty() (both idempotent).
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

;(async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migration error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
