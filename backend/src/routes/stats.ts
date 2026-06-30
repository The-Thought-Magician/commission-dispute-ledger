import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  workspace_members,
  deals,
  reps,
  disputes,
  derivation_runs,
  reconciliations,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'

const router = new Hono()

// Public: aggregate counts for a workspace.
// GET /stats?workspace_id=  -> { deals, reps, disputes, runs, reconciliations }
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const [dealRows, repRows, disputeRows, runRows, reconRows, openDisputeRows, memberRows] =
    await Promise.all([
      db.select().from(deals).where(eq(deals.workspace_id, workspaceId)),
      db.select().from(reps).where(eq(reps.workspace_id, workspaceId)),
      db.select().from(disputes).where(eq(disputes.workspace_id, workspaceId)),
      db.select().from(derivation_runs).where(eq(derivation_runs.workspace_id, workspaceId)),
      db.select().from(reconciliations).where(eq(reconciliations.workspace_id, workspaceId)),
      db
        .select()
        .from(disputes)
        .where(and(eq(disputes.workspace_id, workspaceId), eq(disputes.status, 'open'))),
      db.select().from(workspace_members).where(eq(workspace_members.workspace_id, workspaceId)),
    ])

  return c.json({
    deals: dealRows.length,
    reps: repRows.length,
    disputes: disputeRows.length,
    runs: runRows.length,
    reconciliations: reconRows.length,
    open_disputes: openDisputeRows.length,
    members: memberRows.length,
  })
})

export default router
