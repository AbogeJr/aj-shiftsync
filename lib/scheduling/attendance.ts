import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { publishScheduleChange } from '@/lib/realtime/bus'
import { listAccessibleLocations } from './schedule'
import { NotFoundError, SwapError } from './errors'

/**
 * Clocking in and out (brief §6).
 *
 * Attendance is deliberately separate from the schedule: `starts_at` is what
 * was planned, `clocked_in_at` is what happened. The on-duty board reads the
 * latter, so somebody late or absent is visible rather than assumed present.
 */

interface OwnAssignment {
  assignmentId: string
  staffId: string
  locationId: string
  shiftId: string
  clockedInAt: Date | null
  clockedOutAt: Date | null
  published: boolean
}

async function loadOwn(db: Db, assignmentId: string): Promise<OwnAssignment> {
  const rows = await db.execute<{
    id: string
    staff_id: string
    location_id: string
    shift_id: string
    clocked_in_at: string | null
    clocked_out_at: string | null
    published: boolean
  }>(sql`
    SELECT a.id, a.staff_id, sh.location_id, sh.id AS shift_id,
           a.clocked_in_at, a.clocked_out_at, sh.published_at IS NOT NULL AS published
    FROM assignments a JOIN shifts sh ON sh.id = a.shift_id
    WHERE a.id = ${assignmentId} AND a.status = 'active'
  `)
  const row = rows.rows[0]
  if (!row) throw new NotFoundError('Assignment', assignmentId)
  return {
    assignmentId: row.id,
    staffId: row.staff_id,
    locationId: row.location_id,
    shiftId: row.shift_id,
    // Raw execute bypasses drizzle's column mapping, so these arrive as strings.
    clockedInAt: row.clocked_in_at ? new Date(row.clocked_in_at) : null,
    clockedOutAt: row.clocked_out_at ? new Date(row.clocked_out_at) : null,
    published: row.published,
  }
}

export async function clockIn(assignmentId: string, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  const assignment = await loadOwn(db, assignmentId)

  // A manager clocking someone else in is a different feature; this is self-service.
  if (assignment.staffId !== session.userId) throw new SwapError('You can only clock yourself in.')
  if (!assignment.published) throw new SwapError('This shift is not published yet.')
  if (assignment.clockedInAt) throw new SwapError('You are already clocked in for this shift.')

  await db.execute(
    sql`UPDATE assignments SET clocked_in_at = now() WHERE id = ${assignmentId}`,
  )
  publishScheduleChange({
    locationId: assignment.locationId,
    type: 'attendance.changed',
    shiftId: assignment.shiftId,
    assignmentId,
  })
}

export async function clockOut(assignmentId: string, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  const assignment = await loadOwn(db, assignmentId)

  if (assignment.staffId !== session.userId) throw new SwapError('You can only clock yourself out.')
  if (!assignment.clockedInAt) throw new SwapError('You have not clocked in for this shift.')
  if (assignment.clockedOutAt) throw new SwapError('You already clocked out for this shift.')

  await db.execute(
    sql`UPDATE assignments SET clocked_out_at = now() WHERE id = ${assignmentId}`,
  )
  publishScheduleChange({
    locationId: assignment.locationId,
    type: 'attendance.changed',
    shiftId: assignment.shiftId,
    assignmentId,
  })
}

export interface OnDutyEntry {
  assignmentId: string
  name: string
  location: string
  timezone: string
  requiredSkill: string | null
  /** Local wall clock at the location. */
  scheduledStart: string
  scheduledEnd: string
  clockedInAt: string
  /** Minutes since they clocked in. */
  minutesOnDuty: number
  /** Positive when they started after the scheduled time. */
  minutesLate: number
  /** True when the scheduled end has passed but they have not clocked out. */
  overdue: boolean
}

export interface OnDutyLocation {
  id: string
  name: string
  timezone: string
  /** Local time at that location right now, so a manager reads the right clock. */
  localNow: string
  onDuty: OnDutyEntry[]
  /** Scheduled to be here now but not clocked in. */
  missing: Array<{ name: string; scheduledStart: string; minutesLate: number }>
}

/** Who is actually on the floor, per location. */
export async function onDutyNow(db: Db = defaultDb): Promise<OnDutyLocation[]> {
  await requireRole('admin', 'manager')
  const locations = await listAccessibleLocations(db)
  if (locations.length === 0) return []
  const ids = locations.map((l) => l.id)

  const rows = await db.execute<{
    location_id: string
    assignment_id: string
    name: string
    required_skill: string | null
    scheduled_start: string
    scheduled_end: string
    clocked_in_at: string | null
    minutes_on_duty: number | null
    minutes_late: number | null
    overdue: boolean
    local_now: string
  }>(sql`
    SELECT sh.location_id, a.id AS assignment_id, st.name, sh.required_skill,
           to_char(sh.starts_at AT TIME ZONE l.timezone, 'HH24:MI') AS scheduled_start,
           to_char(sh.ends_at   AT TIME ZONE l.timezone, 'HH24:MI') AS scheduled_end,
           to_char(a.clocked_in_at AT TIME ZONE l.timezone, 'HH24:MI') AS clocked_in_at,
           CASE WHEN a.clocked_in_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (now() - a.clocked_in_at)) / 60 END AS minutes_on_duty,
           CASE WHEN a.clocked_in_at IS NOT NULL
             THEN EXTRACT(EPOCH FROM (a.clocked_in_at - sh.starts_at)) / 60
             ELSE EXTRACT(EPOCH FROM (now() - sh.starts_at)) / 60 END AS minutes_late,
           a.clocked_in_at IS NOT NULL AND now() > sh.ends_at AS overdue,
           to_char(now() AT TIME ZONE l.timezone, 'HH24:MI') AS local_now
    FROM assignments a
    JOIN shifts sh ON sh.id = a.shift_id
    JOIN locations l ON l.id = sh.location_id
    JOIN staff st ON st.id = a.staff_id
    WHERE a.status = 'active'
      AND sh.location_id = ANY(${sql.param(ids)}::uuid[])
      AND a.clocked_out_at IS NULL
      AND (
        -- Anyone actually on the floor, whatever the schedule says. Clocking in
        -- is allowed up to an hour early, so gating this on the scheduled start
        -- would hide the very people the board exists to show.
        a.clocked_in_at IS NOT NULL
        -- Due but absent: only once the shift has started, and only until an
        -- hour past the end, after which it is a no-show rather than news.
        OR (now() >= sh.starts_at AND now() < sh.ends_at + interval '1 hour')
      )
    ORDER BY st.name
  `)

  return locations.map((location) => {
    const mine = rows.rows.filter((r) => r.location_id === location.id)
    return {
      id: location.id,
      name: location.name,
      timezone: location.timezone,
      localNow: mine[0]?.local_now ?? '',
      onDuty: mine
        .filter((r) => r.clocked_in_at !== null)
        .map((r) => ({
          assignmentId: r.assignment_id,
          name: r.name,
          location: location.name,
          timezone: location.timezone,
          requiredSkill: r.required_skill,
          scheduledStart: r.scheduled_start,
          scheduledEnd: r.scheduled_end,
          clockedInAt: r.clocked_in_at!,
          minutesOnDuty: Math.max(0, Math.round(Number(r.minutes_on_duty ?? 0))),
          minutesLate: Math.round(Number(r.minutes_late ?? 0)),
          overdue: r.overdue,
        })),
      missing: mine
        .filter((r) => r.clocked_in_at === null)
        .map((r) => ({
          name: r.name,
          scheduledStart: r.scheduled_start,
          minutesLate: Math.max(0, Math.round(Number(r.minutes_late ?? 0))),
        })),
    }
  })
}
