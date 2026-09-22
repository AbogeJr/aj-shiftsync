import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { listAccessibleLocations } from './schedule'

/** Week a manager can see, expressed as the locations they may access. */
async function accessibleLocationIds(db: Db): Promise<string[]> {
  return (await listAccessibleLocations(db)).map((l) => l.id)
}

export interface LocationWeekSummary {
  id: string
  name: string
  timezone: string
  shifts: number
  openSlots: number
  assignedHours: number
  labourCents: number
  draftShifts: number
}

/**
 * Every location a manager can see, side by side for one week.
 *
 * This is the "no central view of who's working where" gap: per-location
 * numbers are computed in each location's own timezone, so a week means the
 * local week rather than the server's.
 */
export async function locationWeekSummaries(
  weekStart: string,
  db: Db = defaultDb,
): Promise<LocationWeekSummary[]> {
  const ids = await accessibleLocationIds(db)
  if (ids.length === 0) return []

  const rows = await db.execute<{
    id: string
    name: string
    timezone: string
    shifts: number
    open_slots: number
    assigned_hours: string
    labour_cents: string
    draft_shifts: number
  }>(sql`
    WITH scoped AS (
      SELECT sh.*, l.name, l.timezone
      FROM shifts sh JOIN locations l ON l.id = sh.location_id
      WHERE sh.location_id = ANY(${sql.param(ids)}::uuid[])
        AND sh.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
        AND sh.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
    )
    SELECT l.id, l.name, l.timezone,
      COUNT(s.id)::int AS shifts,
      COALESCE(SUM(GREATEST(0, s.headcount - (
        SELECT COUNT(*) FROM assignments a WHERE a.shift_id = s.id AND a.status = 'active'
      ))), 0)::int AS open_slots,
      COALESCE(SUM((
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600), 0)
        FROM assignments a WHERE a.shift_id = s.id AND a.status = 'active'
      )), 0) AS assigned_hours,
      COALESCE(SUM((
        SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600 * COALESCE(st.hourly_rate_cents, 0)), 0)
        FROM assignments a JOIN staff st ON st.id = a.staff_id
        WHERE a.shift_id = s.id AND a.status = 'active'
      )), 0) AS labour_cents,
      COUNT(s.id) FILTER (WHERE s.published_at IS NULL)::int AS draft_shifts
    FROM locations l
    LEFT JOIN scoped s ON s.location_id = l.id
    WHERE l.id = ANY(${sql.param(ids)}::uuid[])
    GROUP BY l.id, l.name, l.timezone
    ORDER BY l.name
  `)

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    timezone: r.timezone,
    shifts: r.shifts,
    openSlots: r.open_slots,
    assignedHours: Number(r.assigned_hours),
    labourCents: Math.round(Number(r.labour_cents)),
    draftShifts: r.draft_shifts,
  }))
}

export interface TeamMember {
  id: string
  name: string
  role: string
  skills: string[]
  locations: string[]
  hoursThisWeek: number
  desiredWeeklyHours: number
  hourlyRateCents: number | null
  /** Hours split by location, which is what exposes cross-location load. */
  byLocation: Array<{ location: string; hours: number }>
}

/**
 * Everyone the manager can see, with load broken down per location.
 *
 * A manager looking only at their own grid cannot tell that someone is already
 * at 30 hours elsewhere. Showing the split is what makes cross-location
 * over-booking - and hoarding - visible.
 */
export async function teamOverview(
  weekStart: string,
  db: Db = defaultDb,
): Promise<TeamMember[]> {
  const ids = await accessibleLocationIds(db)
  if (ids.length === 0) return []

  const rows = await db.execute<{
    id: string
    name: string
    role: string
    skills: string[] | null
    locations: string[] | null
    hours: string
    desired: number
    rate: number | null
    by_location: Array<{ location: string; hours: number }> | null
  }>(sql`
    SELECT st.id, st.name, st.role::text AS role, st.desired_weekly_hours AS desired,
           st.hourly_rate_cents AS rate,
           ARRAY(SELECT k.skill FROM staff_skills k WHERE k.staff_id = st.id ORDER BY k.skill) AS skills,
           ARRAY(
             SELECT l.name FROM certifications c JOIN locations l ON l.id = c.location_id
             WHERE c.staff_id = st.id AND (c.revoked_at IS NULL OR c.revoked_at > now())
             ORDER BY l.name
           ) AS locations,
           COALESCE((
             SELECT SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600)
             FROM assignments a JOIN shifts sh ON sh.id = a.shift_id JOIN locations l ON l.id = sh.location_id
             WHERE a.staff_id = st.id AND a.status = 'active'
               AND a.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
               AND a.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
           ), 0) AS hours,
           COALESCE((
             SELECT json_agg(x) FROM (
               SELECT l.name AS location,
                      SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600) AS hours
               FROM assignments a JOIN shifts sh ON sh.id = a.shift_id JOIN locations l ON l.id = sh.location_id
               WHERE a.staff_id = st.id AND a.status = 'active'
                 AND a.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
                 AND a.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
               GROUP BY l.name ORDER BY l.name
             ) x
           ), '[]'::json) AS by_location
    FROM staff st
    WHERE EXISTS (
      SELECT 1 FROM certifications c
      WHERE c.staff_id = st.id AND c.location_id = ANY(${sql.param(ids)}::uuid[])
        AND (c.revoked_at IS NULL OR c.revoked_at > now())
    )
    ORDER BY st.name
  `)

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    skills: r.skills ?? [],
    locations: r.locations ?? [],
    hoursThisWeek: Number(r.hours),
    desiredWeeklyHours: r.desired,
    hourlyRateCents: r.rate,
    byLocation: (r.by_location ?? []).map((b) => ({ location: b.location, hours: Number(b.hours) })),
  }))
}

export interface FairnessRow {
  id: string
  name: string
  hours: number
  desired: number
  premiumShifts: number
}

/**
 * Hours against stated preference, plus premium shifts.
 *
 * "Premium" is derived - Friday or Saturday starting 17:00 or later in the
 * location's own timezone - rather than stored, so it cannot drift from the
 * times it describes.
 */
export async function fairnessReport(
  weekStart: string,
  db: Db = defaultDb,
): Promise<FairnessRow[]> {
  await requireRole('admin', 'manager')
  const ids = await accessibleLocationIds(db)
  if (ids.length === 0) return []

  const rows = await db.execute<{
    id: string
    name: string
    hours: string
    desired: number
    premium: number
  }>(sql`
    SELECT st.id, st.name, st.desired_weekly_hours AS desired,
           COALESCE(SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600), 0) AS hours,
           COUNT(*) FILTER (
             WHERE EXTRACT(DOW FROM (a.starts_at AT TIME ZONE l.timezone)) IN (5, 6)
               AND (a.starts_at AT TIME ZONE l.timezone)::time >= '17:00'
           )::int AS premium
    FROM staff st
    LEFT JOIN assignments a ON a.staff_id = st.id AND a.status = 'active'
    LEFT JOIN shifts sh ON sh.id = a.shift_id
    LEFT JOIN locations l ON l.id = sh.location_id
      AND l.id = ANY(${sql.param(ids)}::uuid[])
      AND a.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
      AND a.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
    WHERE EXISTS (
      SELECT 1 FROM certifications c
      WHERE c.staff_id = st.id AND c.location_id = ANY(${sql.param(ids)}::uuid[])
        AND (c.revoked_at IS NULL OR c.revoked_at > now())
    )
    GROUP BY st.id, st.name, st.desired_weekly_hours
    ORDER BY st.name
  `)

  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    hours: Number(r.hours),
    desired: r.desired,
    premiumShifts: r.premium,
  }))
}
