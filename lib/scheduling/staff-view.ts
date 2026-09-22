import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { evaluateEligibility } from './eligibility'
import { loadEligibility } from './eligibility-query'

export interface MyShift {
  id: string
  assignmentId: string
  location: string
  timezone: string
  localDate: string
  startLocal: string
  endLocal: string
  overnight: boolean
  requiredSkill: string | null
  hours: number
  /** A live swap or drop against this assignment, if any. */
  pendingRequest: { id: string; kind: 'swap' | 'drop'; status: string } | null
}

export interface OpenShift {
  id: string
  location: string
  localDate: string
  startLocal: string
  endLocal: string
  requiredSkill: string | null
  hours: number
  openSlots: number
}

export interface MyWeek {
  staffId: string
  name: string
  desiredWeeklyHours: number
  totalHours: number
  shifts: MyShift[]
}

/**
 * A staff member's own week.
 *
 * Only published shifts appear. Publishing is what makes a schedule visible to
 * staff, so a draft must be invisible here even though the assignment row
 * already exists - otherwise "publish" would mean nothing.
 *
 * Times render in each shift's *location* timezone, because that is the clock
 * the person turns up against, not their home timezone.
 */
export async function myWeek(weekStart: string, db: Db = defaultDb): Promise<MyWeek> {
  const session = await requireRole('admin', 'manager', 'staff')

  const rows = await db.execute<{
    name: string
    desired: number
    id: string
    assignment_id: string
    location: string
    timezone: string
    local_date: string
    start_local: string
    end_local: string
    overnight: boolean
    required_skill: string | null
    hours: string
    request_id: string | null
    request_kind: 'swap' | 'drop' | null
    request_status: string | null
  }>(sql`
    SELECT st.name, st.desired_weekly_hours AS desired,
           r.id AS request_id, r.kind::text AS request_kind, r.status::text AS request_status,
           sh.id, a.id AS assignment_id, l.name AS location, l.timezone,
           to_char(sh.starts_at AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS local_date,
           to_char(sh.starts_at AT TIME ZONE l.timezone, 'HH24:MI')    AS start_local,
           to_char(sh.ends_at   AT TIME ZONE l.timezone, 'HH24:MI')    AS end_local,
           (sh.ends_at AT TIME ZONE l.timezone)::date > (sh.starts_at AT TIME ZONE l.timezone)::date AS overnight,
           sh.required_skill,
           EXTRACT(EPOCH FROM (sh.ends_at - sh.starts_at)) / 3600 AS hours
    FROM staff st
    LEFT JOIN assignments a ON a.staff_id = st.id AND a.status = 'active'
    LEFT JOIN shifts sh ON sh.id = a.shift_id AND sh.published_at IS NOT NULL
    LEFT JOIN swap_requests r
      ON r.assignment_id = a.id AND r.status IN ('open', 'peer_accepted')
    LEFT JOIN locations l ON l.id = sh.location_id
      AND sh.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
      AND sh.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
    WHERE st.id = ${session.userId}
    ORDER BY sh.starts_at
  `)

  const first = rows.rows[0]
  const shifts = rows.rows
    .filter((r) => r.id !== null && r.location !== null)
    .map((r) => ({
      id: r.id,
      assignmentId: r.assignment_id,
      location: r.location,
      timezone: r.timezone,
      localDate: r.local_date,
      startLocal: r.start_local,
      endLocal: r.end_local,
      overnight: r.overnight,
      requiredSkill: r.required_skill,
      hours: Number(r.hours),
      pendingRequest: r.request_id
        ? { id: r.request_id, kind: r.request_kind!, status: r.request_status! }
        : null,
    }))

  return {
    staffId: session.userId,
    name: first?.name ?? '',
    desiredWeeklyHours: first?.desired ?? 0,
    totalHours: shifts.reduce((n, s) => n + s.hours, 0),
    shifts,
  }
}

/**
 * Published shifts with room that this person is actually eligible for.
 *
 * Runs the same eligibility rules the write path enforces, so anything offered
 * here can genuinely be claimed - the list never lies.
 */
export async function openShiftsForMe(
  weekStart: string,
  db: Db = defaultDb,
): Promise<OpenShift[]> {
  const session = await requireRole('admin', 'manager', 'staff')

  const candidates = await db.execute<{
    id: string
    location: string
    local_date: string
    start_local: string
    end_local: string
    required_skill: string | null
    hours: string
    open_slots: number
  }>(sql`
    SELECT sh.id, l.name AS location,
           to_char(sh.starts_at AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS local_date,
           to_char(sh.starts_at AT TIME ZONE l.timezone, 'HH24:MI')    AS start_local,
           to_char(sh.ends_at   AT TIME ZONE l.timezone, 'HH24:MI')    AS end_local,
           sh.required_skill,
           EXTRACT(EPOCH FROM (sh.ends_at - sh.starts_at)) / 3600 AS hours,
           (sh.headcount - (
             SELECT COUNT(*) FROM assignments a
             WHERE a.shift_id = sh.id AND a.status = 'active'
           ))::int AS open_slots
    FROM shifts sh
    JOIN locations l ON l.id = sh.location_id
    WHERE sh.published_at IS NOT NULL
      AND sh.starts_at >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE l.timezone
      AND sh.starts_at <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE l.timezone
      AND sh.headcount > (
        SELECT COUNT(*) FROM assignments a WHERE a.shift_id = sh.id AND a.status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM certifications c
        WHERE c.staff_id = ${session.userId} AND c.location_id = sh.location_id
          AND c.effective_from <= sh.starts_at
          AND (c.revoked_at IS NULL OR c.revoked_at > sh.starts_at)
      )
    ORDER BY sh.starts_at
  `)

  const offers: OpenShift[] = []
  for (const row of candidates.rows) {
    const [me] = await loadEligibility(db, row.id, session.userId)
    if (!me || evaluateEligibility(me.context).length > 0) continue
    offers.push({
      id: row.id,
      location: row.location,
      localDate: row.local_date,
      startLocal: row.start_local,
      endLocal: row.end_local,
      requiredSkill: row.required_skill,
      hours: Number(row.hours),
      openSlots: row.open_slots,
    })
  }
  return offers
}
