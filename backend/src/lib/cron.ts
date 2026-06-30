// ─────────────────────────────────────────────────────────────
// cron.ts — THE ENGINE
//
// Pure, deterministic scheduling primitives used by the route layer.
// Self-contained: no DB, no network, no external services.
//
// Supported schedule "kinds":
//   - 'cron'   : a standard 5/6-field cron expression, parsed via cron-parser
//   - 'rate'   : "every N minutes|hours|days" computed arithmetically
//   - 'oneoff' : a single ISO instant (fires once if it is in the future)
// ─────────────────────────────────────────────────────────────

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface JobSpec {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  durationMinutes: number
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

const DEFAULT_TZ = 'UTC'
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// ─────────────────────────────────────────────────────────────
// rate-expression parsing: "every N minutes|hours|days"
// ─────────────────────────────────────────────────────────────
const RATE_RE = /^every\s+(\d+)\s*(minute|minutes|min|m|hour|hours|hr|h|day|days|d)$/i

function parseRate(expr: string): { intervalMs: number; n: number; unit: 'minutes' | 'hours' | 'days' } | null {
  const m = expr.trim().match(RATE_RE)
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const u = m[2].toLowerCase()
  if (u.startsWith('m')) return { intervalMs: n * MINUTE_MS, n, unit: 'minutes' }
  if (u.startsWith('h')) return { intervalMs: n * HOUR_MS, n, unit: 'hours' }
  return { intervalMs: n * DAY_MS, n, unit: 'days' }
}

function toIso(d: Date): string {
  return d.toISOString()
}

// ─────────────────────────────────────────────────────────────
// validateExpression
// ─────────────────────────────────────────────────────────────
export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const e = (expr ?? '').trim()
  if (!e) return { valid: false, error: 'Expression is empty' }
  switch (kind) {
    case 'cron': {
      try {
        CronExpressionParser.parse(e)
        return { valid: true }
      } catch (err) {
        return { valid: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'rate': {
      const r = parseRate(e)
      if (!r) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
      return { valid: true }
    }
    case 'oneoff': {
      const t = Date.parse(e)
      if (Number.isNaN(t)) return { valid: false, error: 'One-off must be a valid ISO timestamp' }
      return { valid: true }
    }
    default:
      return { valid: false, error: `Unknown kind: ${kind}` }
  }
}

// ─────────────────────────────────────────────────────────────
// describeExpression — human-readable summary
// ─────────────────────────────────────────────────────────────
export function describeExpression(kind: ScheduleKind, expr: string, timezone = DEFAULT_TZ): string {
  const e = (expr ?? '').trim()
  switch (kind) {
    case 'cron': {
      const v = validateExpression('cron', e)
      if (!v.valid) return `Invalid cron expression: ${v.error}`
      return `Runs on cron "${e}" (${timezone})`
    }
    case 'rate': {
      const r = parseRate(e)
      if (!r) return `Invalid rate expression`
      const unit = r.n === 1 ? r.unit.replace(/s$/, '') : r.unit
      return `Runs every ${r.n} ${unit} (${timezone})`
    }
    case 'oneoff': {
      const t = Date.parse(e)
      if (Number.isNaN(t)) return 'Invalid one-off timestamp'
      return `Runs once at ${new Date(t).toISOString()} (${timezone})`
    }
    default:
      return `Unknown schedule kind: ${kind}`
  }
}

// ─────────────────────────────────────────────────────────────
// nextFirings — next `count` ISO-UTC instants from `fromISO`
// ─────────────────────────────────────────────────────────────
export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = DEFAULT_TZ,
  fromISO?: string,
  count = 5,
): string[] {
  const from = fromISO ? new Date(fromISO) : new Date()
  if (Number.isNaN(from.getTime()) || count <= 0) return []
  const e = (expr ?? '').trim()

  switch (kind) {
    case 'cron': {
      try {
        const it = CronExpressionParser.parse(e, { tz: timezone, currentDate: from })
        const out: string[] = []
        for (let i = 0; i < count; i++) {
          out.push(toIso(it.next().toDate()))
        }
        return out
      } catch {
        return []
      }
    }
    case 'rate': {
      const r = parseRate(e)
      if (!r) return []
      const out: string[] = []
      let t = from.getTime() + r.intervalMs
      for (let i = 0; i < count; i++) {
        out.push(toIso(new Date(t)))
        t += r.intervalMs
      }
      return out
    }
    case 'oneoff': {
      const t = Date.parse(e)
      if (Number.isNaN(t)) return []
      return t > from.getTime() ? [toIso(new Date(t))] : []
    }
    default:
      return []
  }
}

// Internal helper: enumerate every firing of a job within [from, from+horizon).
function firingsWithin(job: JobSpec, fromMs: number, horizonMs: number, cap = 100_000): number[] {
  const out: number[] = []
  const endMs = fromMs + horizonMs
  const tz = job.timezone ?? DEFAULT_TZ
  const e = (job.expr ?? '').trim()

  if (job.kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(e, { tz, currentDate: new Date(fromMs) })
      while (out.length < cap) {
        const next = it.next().toDate().getTime()
        if (next >= endMs) break
        out.push(next)
      }
    } catch {
      return []
    }
  } else if (job.kind === 'rate') {
    const r = parseRate(e)
    if (!r) return []
    let t = fromMs + r.intervalMs
    while (t < endMs && out.length < cap) {
      out.push(t)
      t += r.intervalMs
    }
  } else if (job.kind === 'oneoff') {
    const t = Date.parse(e)
    if (!Number.isNaN(t) && t >= fromMs && t < endMs) out.push(t)
  }
  return out
}

function floorToMinute(ms: number): number {
  return Math.floor(ms / MINUTE_MS) * MINUTE_MS
}

// ─────────────────────────────────────────────────────────────
// computeCollisions — bucket firings by minute, flag contention
// ─────────────────────────────────────────────────────────────
export function computeCollisions(
  jobs: JobSpec[],
  opts: { horizonDays?: number; threshold?: number; fromISO?: string } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 2
  const fromMs = opts.fromISO ? new Date(opts.fromISO).getTime() : Date.now()
  if (Number.isNaN(fromMs)) return []
  const horizonMs = horizonDays * DAY_MS

  // minute-bucket -> set of jobIds (and resource map)
  const buckets = new Map<number, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    const firings = firingsWithin(job, fromMs, horizonMs)
    for (const f of firings) {
      const b = floorToMinute(f)
      let entry = buckets.get(b)
      if (!entry) {
        entry = { jobIds: new Set(), resources: new Map() }
        buckets.set(b, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        let rs = entry.resources.get(job.resourceId)
        if (!rs) {
          rs = new Set()
          entry.resources.set(job.resourceId, rs)
        }
        rs.add(job.id)
      }
    }
  }

  const out: CollisionWindow[] = []
  for (const [bucketMs, entry] of buckets) {
    const concurrency = entry.jobIds.size

    // resource contention: >=2 jobs sharing a single resource in this minute
    let contendedResource: string | undefined
    for (const [res, rs] of entry.resources) {
      if (rs.size >= 2) {
        contendedResource = res
        break
      }
    }

    const concurrencyHit = concurrency >= threshold
    if (!concurrencyHit && !contendedResource) continue

    let severity: CollisionWindow['severity'] = 'low'
    if (concurrency >= threshold * 3) severity = 'high'
    else if (concurrency >= threshold * 2 || contendedResource) severity = 'medium'

    out.push({
      windowStart: toIso(new Date(bucketMs)),
      windowEnd: toIso(new Date(bucketMs + MINUTE_MS)),
      jobIds: Array.from(entry.jobIds).sort(),
      severity,
      resourceId: contendedResource,
    })
  }

  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ─────────────────────────────────────────────────────────────
// loadHeatmap — firings per hour bucket across the horizon
// ─────────────────────────────────────────────────────────────
export function loadHeatmap(
  jobs: JobSpec[],
  opts: { horizonDays?: number; fromISO?: string } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = opts.fromISO ? new Date(opts.fromISO).getTime() : Date.now()
  if (Number.isNaN(fromMs)) return []
  const horizonMs = horizonDays * DAY_MS

  const counts = new Map<number, number>()
  for (const job of jobs) {
    for (const f of firingsWithin(job, fromMs, horizonMs)) {
      const hourBucket = Math.floor(f / HOUR_MS) * HOUR_MS
      counts.set(hourBucket, (counts.get(hourBucket) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([ms, count]) => ({ bucket: toIso(new Date(ms)), count }))
}

// ─────────────────────────────────────────────────────────────
// DST helpers — detect offset changes via Intl
// ─────────────────────────────────────────────────────────────
function tzOffsetMinutes(date: Date, timeZone: string): number {
  // Returns the offset (minutes) such that local = utc + offset.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  )
  return Math.round((asUtc - date.getTime()) / MINUTE_MS)
}

// ─────────────────────────────────────────────────────────────
// dstTraps — find double-fire / skip / ambiguous windows
// ─────────────────────────────────────────────────────────────
export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = DEFAULT_TZ,
  fromISO?: string,
  days = 365,
): DstTrap[] {
  if (timezone === 'UTC') return []
  const fromMs = fromISO ? new Date(fromISO).getTime() : Date.now()
  if (Number.isNaN(fromMs)) return []
  const endMs = fromMs + days * DAY_MS

  // 1. Locate all offset-transition instants in the window (hour-stepped scan).
  const transitions: { atMs: number; deltaMin: number }[] = []
  let prevOffset = tzOffsetMinutes(new Date(fromMs), timezone)
  for (let t = fromMs + HOUR_MS; t <= endMs; t += HOUR_MS) {
    const off = tzOffsetMinutes(new Date(t), timezone)
    if (off !== prevOffset) {
      transitions.push({ atMs: t, deltaMin: off - prevOffset })
      prevOffset = off
    }
  }
  if (transitions.length === 0) return []

  // 2. Enumerate the schedule's firings across the window.
  const job: JobSpec = { id: '_dst', kind, expr, timezone }
  const firings = firingsWithin(job, fromMs, endMs - fromMs)
  const firingSet = firings.map((f) => ({ ms: f }))

  const out: DstTrap[] = []
  for (const tr of transitions) {
    // Spring-forward (offset increases): a wall-clock hour is skipped.
    // Fall-back (offset decreases): a wall-clock hour repeats → ambiguous / double_fire.
    const windowStart = tr.atMs - HOUR_MS
    const windowEnd = tr.atMs + HOUR_MS
    const near = firingSet.filter((f) => f.ms >= windowStart && f.ms <= windowEnd)

    if (tr.deltaMin > 0) {
      // skipped local hour
      for (const f of near) {
        out.push({
          type: 'skip',
          atLocal: localString(new Date(f.ms), timezone),
          atUtc: toIso(new Date(f.ms)),
        })
      }
    } else if (tr.deltaMin < 0) {
      // repeated local hour: any firing here is ambiguous; pairs are double fires
      for (const f of near) {
        out.push({
          type: near.length >= 2 ? 'double_fire' : 'ambiguous',
          atLocal: localString(new Date(f.ms), timezone),
          atUtc: toIso(new Date(f.ms)),
        })
      }
    }
  }
  return out
}

function localString(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(date)
  const map: Record<string, string> = {}
  for (const p of parts) if (p.type !== 'literal') map[p.type] = p.value
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`
}

// ─────────────────────────────────────────────────────────────
// coverageGaps — windows of length>0 with no scheduled firing
// `windows` describe required-coverage intervals (ISO start/end).
// ─────────────────────────────────────────────────────────────
export function coverageGaps(
  windows: { start: string; end: string }[],
  jobs: JobSpec[],
  opts: { horizonDays?: number; fromISO?: string } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromMs = opts.fromISO ? new Date(opts.fromISO).getTime() : Date.now()
  if (Number.isNaN(fromMs)) return []
  const horizonMs = horizonDays * DAY_MS

  // All firings across all jobs, sorted.
  const allFirings: number[] = []
  for (const job of jobs) {
    for (const f of firingsWithin(job, fromMs, horizonMs)) allFirings.push(f)
  }
  allFirings.sort((a, b) => a - b)

  const gaps: CoverageGap[] = []

  for (const w of windows) {
    const ws = new Date(w.start).getTime()
    const we = new Date(w.end).getTime()
    if (Number.isNaN(ws) || Number.isNaN(we) || we <= ws) continue

    const inside = allFirings.filter((f) => f >= ws && f <= we)
    if (inside.length === 0) {
      gaps.push({
        windowStart: toIso(new Date(ws)),
        windowEnd: toIso(new Date(we)),
        durationMinutes: Math.round((we - ws) / MINUTE_MS),
      })
      continue
    }

    // gaps between the window edges and consecutive firings
    let cursor = ws
    for (const f of inside) {
      if (f - cursor > 0) {
        gaps.push({
          windowStart: toIso(new Date(cursor)),
          windowEnd: toIso(new Date(f)),
          durationMinutes: Math.round((f - cursor) / MINUTE_MS),
        })
      }
      cursor = f
    }
    if (we - cursor > 0) {
      gaps.push({
        windowStart: toIso(new Date(cursor)),
        windowEnd: toIso(new Date(we)),
        durationMinutes: Math.round((we - cursor) / MINUTE_MS),
      })
    }
  }

  return gaps.filter((g) => g.durationMinutes > 0)
}

// ─────────────────────────────────────────────────────────────
// autoSpread — suggest staggered cron expressions to reduce contention
// ─────────────────────────────────────────────────────────────
export function autoSpread(
  jobs: JobSpec[],
  opts: { threshold?: number; horizonDays?: number; fromISO?: string } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 2
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays ?? 7,
    fromISO: opts.fromISO,
  })
  if (collisions.length === 0) return []

  // Rank jobs by how often they participate in a collision window.
  const participation = new Map<string, number>()
  for (const col of collisions) {
    for (const id of col.jobIds) {
      participation.set(id, (participation.get(id) ?? 0) + 1)
    }
  }

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const ranked = Array.from(participation.entries()).sort((a, b) => b[1] - a[1])

  const out: SpreadSuggestion[] = []
  // Keep the worst offender on its slot; shift the rest by a deterministic minute offset.
  let offset = 1
  for (let i = 1; i < ranked.length; i++) {
    const [jobId, hits] = ranked[i]
    const job = jobById.get(jobId)
    if (!job) continue
    const shift = offset % 60
    offset += 7 // prime-ish stagger so suggestions don't re-collide

    let suggestedExpr = job.expr
    if (job.kind === 'cron') {
      suggestedExpr = shiftCronMinute(job.expr, shift)
    } else if (job.kind === 'rate') {
      suggestedExpr = `${job.expr} (offset +${shift}m)`
    }

    out.push({
      jobId,
      suggestedExpr,
      reason: `Participates in ${hits} collision window(s); stagger by ${shift} minute(s) to spread load`,
    })
  }
  return out
}

// Shift the minute field of a cron expression by `delta` minutes (mod 60), when it is a fixed value.
function shiftCronMinute(expr: string, delta: number): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length < 5) return expr
  const minField = fields[0]
  const asNum = Number(minField)
  if (Number.isInteger(asNum)) {
    fields[0] = String((asNum + delta + 60) % 60)
    return fields.join(' ')
  }
  // Non-numeric (e.g. '*' or '*/5'): pin to the offset minute as a safe stagger.
  fields[0] = String(delta % 60)
  return fields.join(' ')
}
