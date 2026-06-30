import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// GET / — caller's notifications (most recent first)
// optional ?workspace_id= scopes the feed; ?unread=1 filters unread.
// ─────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  const unreadOnly = c.req.query('unread') === '1' || c.req.query('unread') === 'true'

  const conds = [eq(notifications.user_id, userId)]
  if (workspaceId) conds.push(eq(notifications.workspace_id, workspaceId))
  if (unreadOnly) conds.push(eq(notifications.read, false))

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.created_at))

  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// POST /:id/read — mark a single notification read (ownership-checked)
// ─────────────────────────────────────────────────────────────
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)

  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))

  return c.json({ success: true })
})

// ─────────────────────────────────────────────────────────────
// POST /read-all — mark all of the caller's notifications read
// ─────────────────────────────────────────────────────────────
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  await db
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.read, false)))

  return c.json({ success: true })
})

export default router
