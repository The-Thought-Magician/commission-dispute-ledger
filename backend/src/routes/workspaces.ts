import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
  currency: z.string().min(1).optional(),
  fiscal_start_month: z.number().int().min(1).max(12).optional(),
  rounding_mode: z.string().min(1).optional(),
  default_tolerance_cents: z.number().int().min(0).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  fiscal_start_month: z.number().int().min(1).max(12).optional(),
  rounding_mode: z.string().min(1).optional(),
  default_tolerance_cents: z.number().int().min(0).optional(),
})

const memberSchema = z.object({
  user_id: z.string().min(1),
  role: z.string().min(1).optional(),
})

// Helpers ───────────────────────────────────────────────────────
async function getMembership(workspaceId: string, userId: string) {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return m
}

async function getWorkspace(id: string) {
  const [w] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  return w
}

// GET / — list caller's workspaces (member-of)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const memberships = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.user_id, userId))
  if (memberships.length === 0) return c.json([])
  const ids = new Set(memberships.map((m) => m.workspace_id))
  const all = await db.select().from(workspaces).orderBy(desc(workspaces.created_at))
  return c.json(all.filter((w) => ids.has(w.id)))
})

// POST / — create workspace (+ owner member row)
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [w] = await db
    .insert(workspaces)
    .values({ ...body, owner_id: userId, updated_at: new Date() })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: w.id,
    user_id: userId,
    role: 'owner',
  })
  return c.json(w, 201)
})

// GET /:id — workspace detail (member check)
router.get('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  return c.json(w)
})

// PUT /:id — update settings (owner)
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — archive (owner)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

// GET /:id/members — list members (member check)
router.get('/:id/members', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  const membership = await getMembership(id, userId)
  if (!membership) return c.json({ error: 'Forbidden' }, 403)
  const members = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, id))
    .orderBy(workspace_members.created_at)
  return c.json(members)
})

// POST /:id/members — invite member (owner)
router.post('/:id/members', authMiddleware, zValidator('json', memberSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const existing = await getMembership(id, body.user_id)
  if (existing) return c.json({ error: 'Already a member' }, 409)
  const [m] = await db
    .insert(workspace_members)
    .values({ workspace_id: id, user_id: body.user_id, role: body.role ?? 'analyst' })
    .returning()
  return c.json(m, 201)
})

// DELETE /:id/members/:memberId — remove member (owner)
router.delete('/:id/members/:memberId', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const memberId = c.req.param('memberId')
  const w = await getWorkspace(id)
  if (!w) return c.json({ error: 'Not found' }, 404)
  if (w.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [member] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.id, memberId), eq(workspace_members.workspace_id, id)))
  if (!member) return c.json({ error: 'Not found' }, 404)
  if (member.user_id === w.owner_id) return c.json({ error: 'Cannot remove owner' }, 400)
  await db.delete(workspace_members).where(eq(workspace_members.id, memberId))
  return c.json({ success: true })
})

export default router
