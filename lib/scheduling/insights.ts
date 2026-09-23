import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { WEEKLY_OVERTIME_AT, WEEKLY_WARNING_AT } from './eligibility'
import { listAccessibleLocations } from './schedule'

/**
 * How far ahead an unfilled slot counts as urgent. Two days matches the default
 * edit cutoff, so the shifts flagged here are the ones still editable.
 */
export const COVERAGE_HORIZON_HOURS = 48

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
  /** Of those, the ones starting within COVERAGE_HORIZON_HOURS. */
  openSlotsSoon: number
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
    open_slots_soon: number
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
      COALESCE(SUM(GREATEST(0, s.headcount - (
        SELECT COUNT(*) FROM assignments a WHERE a.shift_id = s.id AND a.status = 'active'
      ))) FILTER (
        WHERE s.starts_at > now()
          AND s.starts_at <= now() + make_interval(hours => ${COVERAGE_HORIZON_HOURS})
      ), 0)::int AS open_slots_soon,
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
    openSlotsSoon: r.open_slots_soon,
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

/**
 * The overtime premium rate. The 40-hour threshold says nothing about what
 * overtime pays, so this is the US FLSA default of time-and-a-half. One
 * constant, because a group operating under a different rule changes it here
 * and every projection follows.
 */
export const OVERTIME_MULTIPLIER = 1.5

export interface OvertimeProjection {
  /** Hours across everyone that fall past the weekly threshold. */
  overtimeHours: number
  /** What those hours cost in total, at the premium rate. */
  overtimeCents: number
  /** The avoidable part: what they cost *above* straight time. */
  premiumCents: number
  /** Anyone at or past the warning threshold, worst first. */
  atRisk: Array<{
    id: string
    name: string
    hours: number
    /** Zero for somebody merely approaching the threshold. */
    overtimeHours: number
  }>
}

/**
 * Projected overtime for the week.
 *
 * Pure derivation over rows `teamOverview` has already loaded, so it needs no
 * database and is unit-testable. Hours are totalled across every location -
 * overtime is owed on the person, not on the site that happened to book them.
 *
 * Somebody with no rate on file contributes hours but no cost; reporting their
 * overtime as £0 would be a lie, so the hours still count and the money does
 * not.
 */
export function overtimeProjection(team: TeamMember[]): OvertimeProjection {
  let overtimeHours = 0
  let overtimeCents = 0
  const atRisk: OvertimeProjection['atRisk'] = []

  for (const member of team) {
    const over = Math.max(0, member.hoursThisWeek - WEEKLY_OVERTIME_AT)
    overtimeHours += over
    if (member.hourlyRateCents !== null) {
      overtimeCents += over * member.hourlyRateCents * OVERTIME_MULTIPLIER
    }
    if (member.hoursThisWeek >= WEEKLY_WARNING_AT) {
      atRisk.push({
        id: member.id,
        name: member.name,
        hours: member.hoursThisWeek,
        overtimeHours: over,
      })
    }
  }

  atRisk.sort((a, b) => b.hours - a.hours)

  return {
    overtimeHours,
    overtimeCents: Math.round(overtimeCents),
    premiumCents: Math.round(overtimeCents * ((OVERTIME_MULTIPLIER - 1) / OVERTIME_MULTIPLIER)),
    atRisk,
  }
}

export interface FairnessScore {
  /** 0-100. 100 means premium work matches each person's share of the hours. */
  score: number
  /** How many premium shifts would have to change hands to reach that. */
  misallocated: number
  totalPremium: number
  /** Worst-served first: negative `delta` means fewer premium shifts than their share. */
  rows: Array<{ id: string; name: string; premium: number; expected: number; delta: number }>
}

/**
 * Is premium work shared out fairly?
 *
 * The benchmark is each person's share of the hours actually worked, not an
 * equal split: somebody on eight hours a week should not expect as many Friday
 * nights as somebody on forty, and scoring them alike would call a fair roster
 * unfair.
 *
 * The number is the index of dissimilarity - half the total absolute deviation,
 * divided by the number of premium shifts. It reads directly as "this many
 * shifts are in the wrong hands", which is what makes it arguable with rather
 * than merely reportable. A Gini coefficient would rank distributions equally
 * well but tells a manager nothing about what to do next.
 *
 * Nobody scheduled, or no premium shifts at all, scores 100: there is no
 * unfairness in an empty week, and inventing some would be noise.
 */
export function premiumFairness(rows: FairnessRow[]): FairnessScore {
  const worked = rows.filter((r) => r.hours > 0)
  const totalHours = worked.reduce((n, r) => n + r.hours, 0)
  const totalPremium = worked.reduce((n, r) => n + r.premiumShifts, 0)

  if (totalHours === 0 || totalPremium === 0) {
    return { score: 100, misallocated: 0, totalPremium, rows: [] }
  }

  const detail = worked.map((r) => {
    const expected = totalPremium * (r.hours / totalHours)
    return {
      id: r.id,
      name: r.name,
      premium: r.premiumShifts,
      expected,
      delta: r.premiumShifts - expected,
    }
  })

  const misallocated = detail.reduce((n, r) => n + Math.abs(r.delta), 0) / 2
  const score = Math.round((1 - misallocated / totalPremium) * 100)

  detail.sort((a, b) => a.delta - b.delta)
  return { score, misallocated, totalPremium, rows: detail }
}

export interface WeekAssignment {
  staffId: string
  staffName: string
  shiftId: string
  location: string
  localDate: string
  startLocal: string
  endLocal: string
  hours: number
}

export interface OvertimeCulprit {
  staffId: string
  staffName: string
  totalHours: number
  overtimeHours: number
  /** The shift during which they crossed the weekly threshold. */
  tipping: WeekAssignment
  /** Cumulative hours going into that shift. */
  hoursBefore: number
}

/**
 * Which assignment took each person into overtime.
 *
 * "Which one" has no single right answer - remove any of the week's shifts and
 * the total drops the same. The convention here is chronological: shifts are
 * accumulated in the order they are worked, and the one that carries the
 * running total past the threshold is the one named. That matches how the week
 * is actually lived and, more usefully, names a shift that has usually not
 * happened yet, so a manager can still act on it.
 *
 * Pure over already-loaded rows, so the choice of convention is testable.
 */
export function attributeOvertime(assignments: WeekAssignment[]): OvertimeCulprit[] {
  const byStaff = new Map<string, WeekAssignment[]>()
  for (const a of assignments) {
    const list = byStaff.get(a.staffId)
    if (list) list.push(a)
    else byStaff.set(a.staffId, [a])
  }

  const culprits: OvertimeCulprit[] = []
  for (const [staffId, own] of byStaff) {
    own.sort((a, b) => `${a.localDate}${a.startLocal}`.localeCompare(`${b.localDate}${b.startLocal}`))

    let running = 0
    let tipping: WeekAssignment | undefined
    let hoursBefore = 0
    for (const a of own) {
      if (!tipping && running + a.hours > WEEKLY_OVERTIME_AT) {
        tipping = a
        hoursBefore = running
      }
      running += a.hours
    }

    if (tipping) {
      culprits.push({
        staffId,
        staffName: tipping.staffName,
        totalHours: running,
        overtimeHours: running - WEEKLY_OVERTIME_AT,
        tipping,
        hoursBefore,
      })
    }
  }

  return culprits.sort((a, b) => b.overtimeHours - a.overtimeHours)
}

/** Every active assignment in the week, for attributing overtime to a shift. */
export async function weekAssignments(
  weekStart: string,
  db: Db = defaultDb,
): Promise<WeekAssignment[]> {
  await requireRole('admin', 'manager')
  const ids = await accessibleLocationIds(db)
  if (ids.length === 0) return []

  const rows = await db.execute<{
    staff_id: string
    staff_name: string
    shift_id: string
    location: string
    local_date: string
    start_local: string
    end_local: string
    hours: string
  }>(sql`
    SELECT st.id AS staff_id, st.name AS staff_name, sh.id AS shift_id, l.name AS location,
           to_char(a.starts_at AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS local_date,
           to_char(a.starts_at AT TIME ZONE l.timezone, 'HH24:MI')    AS start_local,
           to_char(a.ends_at   AT TIME ZONE l.timezone, 'HH24:MI')    AS end_local,
           EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600 AS hours
    FROM assignments a
    JOIN shifts sh ON sh.id = a.shift_id
    JOIN locations l ON l.id = sh.location_id
    JOIN staff st ON st.id = a.staff_id
    WHERE a.status = 'active'
      AND l.id = ANY(${sql.param(ids)}::uuid[])
      AND a.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
      AND a.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
    ORDER BY st.name, a.starts_at
  `)

  return rows.rows.map((r) => ({
    staffId: r.staff_id,
    staffName: r.staff_name,
    shiftId: r.shift_id,
    location: r.location,
    localDate: r.local_date,
    startLocal: r.start_local,
    endLocal: r.end_local,
    hours: Number(r.hours),
  }))
}
