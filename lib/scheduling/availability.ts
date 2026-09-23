import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { managersOf, notifyAll } from './notifications'
import { SwapError } from './errors'
import { WEEKDAYS } from '@/lib/format'

/**
 * Staff set their own availability.
 *
 * Stored as wall-clock time plus the staff member's own IANA timezone, never as
 * an instant: "I'm free 09:00-17:00 on Tuesdays" has to stay true across a DST
 * change, which it only does if it is never frozen to a UTC offset.
 */

export interface WeeklyRule {
  id: string
  weekday: number
  startLocal: string
  endLocal: string
}

export interface Exception {
  id: string
  date: string
  startLocal: string
  endLocal: string
  kind: 'available' | 'unavailable'
}

export interface MyAvailability {
  timezone: string
  rules: WeeklyRule[]
  exceptions: Exception[]
  /** Shifts already assigned that the current rules no longer cover. */
  conflicts: Array<{ date: string; startLocal: string; endLocal: string; location: string }>
}

function assertWindow(startLocal: string, endLocal: string) {
  if (endLocal <= startLocal) {
    throw new SwapError('The end time has to be after the start time.')
  }
}

export async function myAvailability(db: Db = defaultDb): Promise<MyAvailability> {
  const session = await requireRole('admin', 'manager', 'staff')

  const rows = await db.execute<{ timezone: string }>(
    sql`SELECT availability_tz AS timezone FROM staff WHERE id = ${session.userId}`,
  )

  const rules = await db.execute<{
    id: string
    weekday: number
    start_local: string
    end_local: string
  }>(sql`
    SELECT id, weekday, to_char(start_local, 'HH24:MI') AS start_local,
           to_char(end_local, 'HH24:MI') AS end_local
    FROM availability_rules WHERE staff_id = ${session.userId}
    ORDER BY weekday, start_local
  `)

  const exceptions = await db.execute<{
    id: string
    date: string
    start_local: string
    end_local: string
    kind: 'available' | 'unavailable'
  }>(sql`
    SELECT id, date::text AS date, to_char(start_local, 'HH24:MI') AS start_local,
           to_char(end_local, 'HH24:MI') AS end_local, kind::text AS kind
    FROM availability_exceptions WHERE staff_id = ${session.userId}
      AND date >= (now() AT TIME ZONE (SELECT availability_tz FROM staff WHERE id = ${session.userId}))::date
    ORDER BY date, start_local
  `)

  // Shifts already on the schedule that the current rules would now refuse.
  // Surfaced rather than blocked: the schedule is a commitment already made.
  const conflicts = await db.execute<{
    date: string
    start_local: string
    end_local: string
    location: string
  }>(sql`
    SELECT to_char(a.starts_at AT TIME ZONE st.availability_tz, 'YYYY-MM-DD') AS date,
           to_char(a.starts_at AT TIME ZONE st.availability_tz, 'HH24:MI') AS start_local,
           to_char(a.ends_at   AT TIME ZONE st.availability_tz, 'HH24:MI') AS end_local,
           l.name AS location
    FROM assignments a
    JOIN shifts sh ON sh.id = a.shift_id
    JOIN locations l ON l.id = sh.location_id
    JOIN staff st ON st.id = a.staff_id
    WHERE a.staff_id = ${session.userId} AND a.status = 'active' AND a.starts_at > now()
      AND NOT EXISTS (
        SELECT 1 FROM availability_rules r
        WHERE r.staff_id = st.id
          AND r.weekday = EXTRACT(DOW FROM (a.starts_at AT TIME ZONE st.availability_tz))::int
          AND r.start_local <= (a.starts_at AT TIME ZONE st.availability_tz)::time
          AND r.end_local   >= (a.ends_at   AT TIME ZONE st.availability_tz)::time
      )
    ORDER BY a.starts_at
  `)

  return {
    timezone: rows.rows[0]?.timezone ?? 'UTC',
    rules: rules.rows.map((r) => ({
      id: r.id,
      weekday: r.weekday,
      startLocal: r.start_local,
      endLocal: r.end_local,
    })),
    exceptions: exceptions.rows.map((r) => ({
      id: r.id,
      date: r.date,
      startLocal: r.start_local,
      endLocal: r.end_local,
      kind: r.kind,
    })),
    conflicts: conflicts.rows.map((r) => ({
      date: r.date,
      startLocal: r.start_local,
      endLocal: r.end_local,
      location: r.location,
    })),
  }
}

/** Managers are told when someone's availability moves. */
async function announce(db: Db, staffId: string, what: string) {
  const locations = await db.execute<{ location_id: string }>(sql`
    SELECT DISTINCT location_id FROM certifications
    WHERE staff_id = ${staffId} AND (revoked_at IS NULL OR revoked_at > now())
  `)
  const name = await db.execute<{ name: string }>(
    sql`SELECT name FROM staff WHERE id = ${staffId}`,
  )
  const recipients = new Set<string>()
  for (const l of locations.rows) {
    for (const m of await managersOf(db, l.location_id)) recipients.add(m)
  }
  recipients.delete(staffId)
  await notifyAll(db, [...recipients], {
    type: 'compliance.warning',
    title: `${name.rows[0]?.name ?? 'A staff member'} updated their availability`,
    body: what,
  })
}

export async function addWeeklyRule(
  weekday: number,
  startLocal: string,
  endLocal: string,
  db: Db = defaultDb,
): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  if (weekday < 0 || weekday > 6) throw new SwapError('Pick a day of the week.')
  assertWindow(startLocal, endLocal)

  await db.execute(sql`
    INSERT INTO availability_rules (staff_id, weekday, start_local, end_local)
    VALUES (${session.userId}, ${weekday}, ${startLocal}::time, ${endLocal}::time)
  `)
  await announce(db, session.userId, `Now available ${WEEKDAYS[weekday]} ${startLocal}–${endLocal}.`)
}

export async function removeWeeklyRule(ruleId: string, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  const deleted = await db.execute(sql`
    DELETE FROM availability_rules
    WHERE id = ${ruleId} AND staff_id = ${session.userId} RETURNING id
  `)
  if (deleted.rows.length === 0) throw new SwapError('That availability rule is not yours.')
  await announce(db, session.userId, 'A weekly availability window was removed.')
}

export async function addException(
  date: string,
  startLocal: string,
  endLocal: string,
  kind: 'available' | 'unavailable',
  db: Db = defaultDb,
): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  assertWindow(startLocal, endLocal)

  await db.execute(sql`
    INSERT INTO availability_exceptions (staff_id, date, start_local, end_local, kind)
    VALUES (${session.userId}, ${date}::date, ${startLocal}::time, ${endLocal}::time, ${kind}::availability_exception_kind)
  `)
  await announce(
    db,
    session.userId,
    `${kind === 'unavailable' ? 'Unavailable' : 'Available'} on ${date}, ${startLocal}–${endLocal}.`,
  )
}

export async function removeException(exceptionId: string, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  const deleted = await db.execute(sql`
    DELETE FROM availability_exceptions
    WHERE id = ${exceptionId} AND staff_id = ${session.userId} RETURNING id
  `)
  if (deleted.rows.length === 0) throw new SwapError('That exception is not yours.')
}
