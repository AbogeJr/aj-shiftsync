import { asc, eq, sql } from 'drizzle-orm'
import { ALL_LOCATIONS } from './week-view'
import { db as defaultDb, type Db } from '@/lib/db'
import { locations, managerLocations, staff, skills as skillsTable } from '@/lib/db/schema'
import { getSession, requireRole } from '@/lib/auth'
import { requireLocationVisibility } from './access'
import { NotFoundError } from './errors'

export { ALL_LOCATIONS }

export interface ScheduleLocation {
  id: string
  name: string
  timezone: string
}

export interface ScheduleStaff {
  id: string
  name: string
  role: string
  hourlyRateCents: number | null
  desiredWeeklyHours: number
  skills: string[]
}

export interface ScheduleShift {
  id: string
  /** Carried on the shift so a combined week can label and route each block. */
  locationId: string
  locationName: string
  /** Local calendar date at the location, YYYY-MM-DD. */
  localDate: string
  /** Local wall-clock HH:MM at the location. */
  startLocal: string
  endLocal: string
  /** True when the shift ends on a later local date than it starts. */
  overnight: boolean
  requiredSkill: string | null
  headcount: number
  published: boolean
  /** Paid length from the instants, so a DST transition is counted correctly. */
  hours: number
  /** Optimistic-locking handle; an edit made against a stale value is refused. */
  version: number
  assignedStaffIds: string[]
  /** staffId -> assignmentId, so a row can be unassigned without a lookup. */
  assignmentIds: Record<string, string>
}

export interface WeekSchedule {
  location: ScheduleLocation
  /** Seven local dates, Monday first. */
  days: string[]
  staff: ScheduleStaff[]
  shifts: ScheduleShift[]
}

/**
 * The skills catalogue.
 *
 * What a *new* shift may require is the closed set from the skills table, not
 * the skills the current week happens to use - deriving it from existing shifts
 * is circular, and leaves an empty location with no skills to choose from.
 */
export async function listSkills(db: Db = defaultDb): Promise<string[]> {
  await requireRole('admin', 'manager', 'staff')
  const rows = await db.select({ name: skillsTable.name }).from(skillsTable).orderBy(asc(skillsTable.name))
  return rows.map((r) => r.name)
}

/**
 * Locations the signed-in user may view, for the switcher.
 *
 * Admins see everything, managers the locations they run, and staff the ones
 * they are certified for - they can read a schedule they might be put on.
 */
export async function listAccessibleLocations(db: Db = defaultDb): Promise<ScheduleLocation[]> {
  const session = await requireRole('admin', 'manager', 'staff')
  const columns = { id: locations.id, name: locations.name, timezone: locations.timezone }

  if (session.role === 'admin') {
    return db.select(columns).from(locations).orderBy(asc(locations.name))
  }

  if (session.role === 'manager') {
    return db
      .select(columns)
      .from(locations)
      .innerJoin(managerLocations, eq(managerLocations.locationId, locations.id))
      .where(eq(managerLocations.staffId, session.userId))
      .orderBy(asc(locations.name))
  }

  const rows = await db.execute<{ id: string; name: string; timezone: string }>(sql`
    SELECT DISTINCT l.id, l.name, l.timezone
    FROM locations l JOIN certifications c ON c.location_id = l.id
    WHERE c.staff_id = ${session.userId} AND (c.revoked_at IS NULL OR c.revoked_at > now())
    ORDER BY l.name
  `)
  return rows.rows
}

/**
 * A week of shifts for one location, with every instant already resolved to
 * that location's wall clock.
 *
 * Bucketing happens in Postgres via `AT TIME ZONE`, not in JS: the server's own
 * timezone must never influence which local day a shift lands on.
 */
export async function getWeekSchedule(
  locationId: string,
  weekStart: string,
  db: Db = defaultDb,
): Promise<WeekSchedule> {
  const session = await requireLocationVisibility(locationId, db)
  // Publishing is what makes a schedule visible, so staff never see drafts.
  const publishedOnly = session.role === 'staff'

  const [location] = await db
    .select({ id: locations.id, name: locations.name, timezone: locations.timezone })
    .from(locations)
    .where(eq(locations.id, locationId))
    .limit(1)

  if (!location) throw new NotFoundError('Location', locationId)
  const tz = location.timezone

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  // Only staff certified for this location, and only while the certification
  // is live - eligibility is a property of the interval, not of the row.
  const staffRows = await db.execute<{
    id: string
    name: string
    role: string
    hourly_rate_cents: number | null
    desired_weekly_hours: number
    skills: string[] | null
  }>(sql`
    SELECT s.id, s.name, s.role::text AS role, s.hourly_rate_cents, s.desired_weekly_hours,
           ARRAY(SELECT sk.skill FROM staff_skills sk WHERE sk.staff_id = s.id ORDER BY sk.skill) AS skills
    FROM staff s
    WHERE EXISTS (
      SELECT 1 FROM certifications c
      WHERE c.staff_id = s.id
        AND c.location_id = ${locationId}
        AND c.effective_from <= now()
        AND (c.revoked_at IS NULL OR c.revoked_at > now())
    )
    ORDER BY s.name
  `)

  const shiftRows = await db.execute<{
    id: string
    local_date: string
    start_local: string
    end_local: string
    overnight: boolean
    required_skill: string | null
    headcount: number
    published: boolean
    hours: string
    version: number
    assigned: string[] | null
    assignment_ids: string[] | null
  }>(sql`
    SELECT sh.id,
           to_char(sh.starts_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS local_date,
           to_char(sh.starts_at AT TIME ZONE ${tz}, 'HH24:MI')    AS start_local,
           to_char(sh.ends_at   AT TIME ZONE ${tz}, 'HH24:MI')    AS end_local,
           (sh.ends_at AT TIME ZONE ${tz})::date > (sh.starts_at AT TIME ZONE ${tz})::date AS overnight,
           sh.required_skill,
           sh.headcount,
           sh.published_at IS NOT NULL AS published,
           EXTRACT(EPOCH FROM (sh.ends_at - sh.starts_at)) / 3600 AS hours,
           sh.version,
           ARRAY(
             SELECT a.id::text FROM assignments a
             WHERE a.shift_id = sh.id AND a.status = 'active' ORDER BY a.staff_id
           ) AS assignment_ids,
           ARRAY(
             SELECT a.staff_id::text FROM assignments a
             WHERE a.shift_id = sh.id AND a.status = 'active' ORDER BY a.staff_id
           ) AS assigned
    FROM shifts sh
    WHERE sh.location_id = ${locationId}
      AND sh.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE ${tz}
      AND sh.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE ${tz}
      AND (${publishedOnly} = false OR sh.published_at IS NOT NULL)
    ORDER BY sh.starts_at
  `)

  return {
    location,
    days,
    staff: staffRows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      hourlyRateCents: r.hourly_rate_cents,
      desiredWeeklyHours: r.desired_weekly_hours,
      skills: r.skills ?? [],
    })),
    shifts: shiftRows.rows.map((r) => ({
      id: r.id,
      locationId: location.id,
      locationName: location.name,
      localDate: r.local_date,
      startLocal: r.start_local,
      endLocal: r.end_local,
      overnight: r.overnight,
      requiredSkill: r.required_skill,
      headcount: r.headcount,
      published: r.published,
      hours: Number(r.hours),
      version: r.version,
      assignedStaffIds: r.assigned ?? [],
      assignmentIds: Object.fromEntries(
        (r.assigned ?? []).map((staffId, i) => [staffId, (r.assignment_ids ?? [])[i]]),
      ),
    })),
  }
}

/**
 * Every accessible location's week, merged into one.
 *
 * Merging is only coherent because each field is already location-relative:
 * `days` is calendar arithmetic on `weekStart` and identical everywhere, and
 * each shift's `localDate` is computed in its *own* location's timezone. So a
 * shift lands in the column of the day the person turns up, which is the same
 * rule consecutive-day counting uses.
 *
 * Reuses `getWeekSchedule` per location rather than reimplementing the query.
 * That is N round trips for N locations - fine at four, and worth the certainty
 * that the combined view can never disagree with the single-location one.
 */
export async function getCombinedWeekSchedule(
  weekStart: string,
  db: Db = defaultDb,
): Promise<WeekSchedule> {
  const accessible = await listAccessibleLocations(db)
  const weeks = await Promise.all(
    accessible.map((location) => getWeekSchedule(location.id, weekStart, db)),
  )

  // Somebody certified at three locations is still one person, one grid row.
  const staff = new Map<string, ScheduleStaff>()
  for (const week of weeks) {
    for (const member of week.staff) staff.set(member.id, member)
  }

  return {
    location: {
      id: ALL_LOCATIONS,
      name: 'All locations',
      // No single zone applies; each shift already renders in its own.
      timezone: `${accessible.length} location${accessible.length === 1 ? '' : 's'}`,
    },
    days: weeks[0]?.days ?? [],
    staff: [...staff.values()].sort((a, b) => a.name.localeCompare(b.name)),
    shifts: weeks.flatMap((week) => week.shifts),
  }
}

/** Monday of the week containing `date`, as a local YYYY-MM-DD string. */
export function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Today's date at a location, which is not necessarily today on the server. */
export async function todayAtLocation(tz: string, db: Db = defaultDb): Promise<string> {
  const r = await db.execute<{ d: string }>(
    sql`SELECT to_char(now() AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d`,
  )
  return r.rows[0].d
}

