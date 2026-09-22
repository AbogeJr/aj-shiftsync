import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { publishScheduleChange } from '@/lib/realtime/bus'
import { notify, notifyAll } from './notifications'
import { recordAudit } from './audit'
import { authorizeLocation, SESSION_ACTOR, type Actor } from './access'
import {
  ConcurrentEditError,
  ConflictError,
  CutoffError,
  isExclusionViolation,
  NO_OVERLAP_OR_SHORT_REST,
  NotFoundError,
  asPostgresError,
} from './errors'

export interface ShiftDraft {
  startLocal: string
  endLocal: string
  requiredSkill: string | null
  headcount: number
}

export interface CreateShiftsInput extends ShiftDraft {
  locationId: string
  /** One shift per local date - the reference design's "Apply to" day pills. */
  dates: string[]
  actor?: Actor
}

/**
 * Local wall-clock time at the location, converted to an instant by Postgres.
 *
 * When the end time is not after the start time the shift runs past midnight,
 * so the end lands on the following local date: 11pm-3am is one shift, not two.
 * Doing this in SQL rather than JS keeps it correct across DST, where a local
 * day is not always 24 hours.
 */
// Every parameter is cast explicitly: Postgres cannot resolve `unknown ||
// unknown` when both sides are bound parameters.
function startInstant(date: unknown, time: string, tz: string) {
  return sql`((${date}::text || ' ' || ${time}::text)::timestamp AT TIME ZONE ${tz}::text)`
}

function endInstant(date: unknown, start: string, end: string, tz: string) {
  const overnight = end <= start
  return sql`(((${date}::text::date + ${overnight ? 1 : 0}::int)::text || ' ' || ${end}::text)::timestamp AT TIME ZONE ${tz}::text)`
}

async function locationTimezone(db: Db, locationId: string): Promise<string> {
  const rows = await db.execute<{ timezone: string }>(
    sql`SELECT timezone FROM locations WHERE id = ${locationId}`,
  )
  if (!rows.rows[0]) throw new NotFoundError('Location', locationId)
  return rows.rows[0].timezone
}

export async function createShifts(
  input: CreateShiftsInput,
  db: Db = defaultDb,
): Promise<{ created: number }> {
  await authorizeLocation(input.locationId, input.actor ?? SESSION_ACTOR, db)
  if (input.dates.length === 0) return { created: 0 }
  if (input.headcount < 1) throw new Error('Headcount must be at least 1.')

  const tz = await locationTimezone(db, input.locationId)

  const values = input.dates.map(
    (date) => sql`(
      ${input.locationId}::uuid,
      ${startInstant(date, input.startLocal, tz)},
      ${endInstant(date, input.startLocal, input.endLocal, tz)},
      ${input.requiredSkill},
      ${input.headcount}
    )`,
  )

  await db.execute(sql`
    INSERT INTO shifts (location_id, starts_at, ends_at, required_skill, headcount)
    VALUES ${sql.join(values, sql`, `)}
  `)

  await recordAudit(db, {
    locationId: input.locationId,
    entityType: 'shift',
    entityId: input.locationId,
    action: 'shift.created',
    after: {
      dates: input.dates,
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      requiredSkill: input.requiredSkill,
      headcount: input.headcount,
    },
  })

  publishScheduleChange({ locationId: input.locationId, type: 'shift.updated' })
  return { created: input.dates.length }
}

export interface UpdateShiftInput extends ShiftDraft {
  shiftId: string
  /** The version the editor was looking at. */
  version: number
  actor?: Actor
}

/**
 * Edit a shift and keep its assignments in step.
 *
 * Three things have to hold together, so they share one transaction:
 *  - `version` must still match, or another manager's edit would be lost.
 *  - `assignments.starts_at/ends_at` are denormalized from the shift, so moving
 *    a shift MUST move them too or the exclusion constraint reasons about
 *    stale times.
 *  - Moving a shift can newly double-book someone or eat their rest gap. The
 *    constraint catches that on the assignment update and the whole edit rolls
 *    back, rather than leaving a half-applied schedule.
 */
export async function updateShift(
  input: UpdateShiftInput,
  db: Db = defaultDb,
): Promise<void> {
  const meta = await db.execute<{
    location_id: string
    published: boolean
    cutoff_hours: number
    timezone: string
    locks_at_passed: boolean
  }>(sql`
    SELECT sh.location_id, sh.published_at IS NOT NULL AS published,
           l.edit_cutoff_hours AS cutoff_hours, l.timezone,
           now() > (sh.starts_at - make_interval(hours => l.edit_cutoff_hours)) AS locks_at_passed
    FROM shifts sh JOIN locations l ON l.id = sh.location_id
    WHERE sh.id = ${input.shiftId}
  `)
  const row = meta.rows[0]
  if (!row) throw new NotFoundError('Shift', input.shiftId)

  await authorizeLocation(row.location_id, input.actor ?? SESSION_ACTOR, db)
  if (row.published && row.locks_at_passed) throw new CutoffError(row.cutoff_hours)

  try {
    await db.transaction(async (tx) => {
      const updated = await tx.execute<{ id: string; starts_at: Date; ends_at: Date }>(sql`
        UPDATE shifts SET
          starts_at = ${startInstant(sql`(starts_at AT TIME ZONE ${row.timezone}::text)::date`, input.startLocal, row.timezone)},
          ends_at = ${endInstant(sql`(starts_at AT TIME ZONE ${row.timezone}::text)::date`, input.startLocal, input.endLocal, row.timezone)},
          required_skill = ${input.requiredSkill},
          headcount = ${input.headcount},
          version = version + 1
        WHERE id = ${input.shiftId} AND version = ${input.version}
        RETURNING id, starts_at, ends_at
      `)

      if (updated.rows.length === 0) throw new ConcurrentEditError()

      await recordAudit(tx, {
        locationId: row.location_id,
        entityType: 'shift',
        entityId: input.shiftId,
        action: 'shift.updated',
        before: { version: input.version },
        after: {
          startLocal: input.startLocal,
          endLocal: input.endLocal,
          requiredSkill: input.requiredSkill,
          headcount: input.headcount,
        },
      })

      // The sync obligation. Without this the constraint compares stale times.
      await tx.execute(sql`
        UPDATE assignments
        SET starts_at = ${updated.rows[0].starts_at}, ends_at = ${updated.rows[0].ends_at}
        WHERE shift_id = ${input.shiftId} AND status = 'active'
      `)

      // Brief §3: a pending swap or drop describes a shift that no longer
      // exists in the form it was agreed on, so it is withdrawn rather than
      // silently applied to different hours.
      const affected = await tx.execute<{ staff_id: string }>(sql`
        SELECT staff_id FROM assignments WHERE shift_id = ${input.shiftId} AND status = 'active'
      `)
      await notifyAll(tx, affected.rows.map((r) => r.staff_id), {
        type: 'shift.changed',
        title: 'One of your shifts changed',
        body: `New hours: ${input.startLocal}–${input.endLocal}.`,
        meta: { shiftId: input.shiftId },
      })

      await tx.execute(sql`
        UPDATE swap_requests SET status = 'cancelled', resolved_at = now()
        WHERE status IN ('open', 'peer_accepted')
          AND (assignment_id IN (SELECT id FROM assignments WHERE shift_id = ${input.shiftId})
            OR target_assignment_id IN (SELECT id FROM assignments WHERE shift_id = ${input.shiftId}))
      `)
    })
  } catch (err) {
    if (isExclusionViolation(err, NO_OVERLAP_OR_SHORT_REST)) {
      throw new ConflictError({
        message:
          'Moving this shift would double-book someone already on it, or leave them under 10 hours of rest. Unassign them first.',
        constraint: NO_OVERLAP_OR_SHORT_REST,
        detail: asPostgresError(err)?.detail,
        cause: err,
      })
    }
    throw err
  }

  publishScheduleChange({
    locationId: row.location_id,
    type: 'shift.updated',
    shiftId: input.shiftId,
  })
}

export async function deleteShift(
  shiftId: string,
  version: number,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<void> {
  const meta = await db.execute<{ location_id: string }>(
    sql`SELECT location_id FROM shifts WHERE id = ${shiftId}`,
  )
  const row = meta.rows[0]
  if (!row) throw new NotFoundError('Shift', shiftId)
  await authorizeLocation(row.location_id, actor, db)

  // Assignments cascade. Deleting a shift is how a manager removes coverage
  // entirely, as opposed to unassigning one person.
  const deleted = await db.execute(
    sql`DELETE FROM shifts WHERE id = ${shiftId} AND version = ${version} RETURNING id`,
  )
  if (deleted.rows.length === 0) throw new ConcurrentEditError()

  await recordAudit(db, {
    locationId: row.location_id,
    entityType: 'shift',
    entityId: shiftId,
    action: 'shift.deleted',
    before: { version },
  })

  publishScheduleChange({ locationId: row.location_id, type: 'shift.updated', shiftId })
}

/** Remove one person from a shift without deleting the shift. */
export async function unassign(
  assignmentId: string,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<void> {
  const meta = await db.execute<{ location_id: string; shift_id: string; staff_id: string }>(sql`
    SELECT sh.location_id, sh.id AS shift_id, a.staff_id
    FROM assignments a JOIN shifts sh ON sh.id = a.shift_id
    WHERE a.id = ${assignmentId}
  `)
  const row = meta.rows[0]
  if (!row) throw new NotFoundError('Assignment', assignmentId)
  await authorizeLocation(row.location_id, actor, db)

  // Cancelled rather than deleted: the row drops out of the partial exclusion
  // constraint, and the history of who was scheduled survives.
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE assignments SET status = 'cancelled' WHERE id = ${assignmentId}`)
    await recordAudit(tx, {
      locationId: row.location_id,
      entityType: 'assignment',
      entityId: assignmentId,
      action: 'assignment.cancelled',
      before: { status: 'active' },
      after: { status: 'cancelled' },
    })
    await notify(tx, {
      staffId: row.staff_id,
      type: 'shift.unassigned',
      title: 'A shift was removed from your schedule',
      meta: { shiftId: row.shift_id },
    })
  })

  publishScheduleChange({
    locationId: row.location_id,
    type: 'assignment.cancelled',
    shiftId: row.shift_id,
    assignmentId,
  })
}

/**
 * Publish every draft shift in a week.
 *
 * Publishing is the moment a schedule becomes real to staff, so this is where
 * they are told about it - not when a manager first drafts the assignment. Each
 * person gets one notification covering all their newly visible shifts rather
 * than one per shift.
 */
export async function publishWeek(
  locationId: string,
  weekStart: string,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<{ published: number; notified: number }> {
  await authorizeLocation(locationId, actor, db)
  const tz = await locationTimezone(db, locationId)

  let published = 0
  let notified = 0

  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      UPDATE shifts SET published_at = now()
      WHERE location_id = ${locationId}
        AND published_at IS NULL
        AND starts_at >= (${weekStart}::text || ' 00:00')::timestamp AT TIME ZONE ${tz}::text
        AND starts_at <  ((${weekStart}::date + 7)::text || ' 00:00')::timestamp AT TIME ZONE ${tz}::text
      RETURNING id
    `)
    published = rows.rows.length
    if (published === 0) return

    const ids = rows.rows.map((r) => r.id)
    const recipients = await tx.execute<{ staff_id: string; n: number }>(sql`
      SELECT staff_id, count(*)::int AS n FROM assignments
      WHERE status = 'active' AND shift_id = ANY(${sql.param(ids)}::uuid[])
      GROUP BY staff_id
    `)

    for (const person of recipients.rows) {
      await notify(tx, {
        staffId: person.staff_id,
        type: 'schedule.published',
        title: 'Your schedule has been published',
        body: `${person.n} shift${person.n === 1 ? '' : 's'} for the week of ${weekStart}.`,
        meta: { locationId },
      })
      notified += 1
    }

    await recordAudit(tx, {
      locationId,
      entityType: 'schedule',
      entityId: locationId,
      action: 'schedule.published',
      after: { weekStart, shifts: published },
    })
  })

  publishScheduleChange({ locationId, type: 'shift.updated' })
  return { published, notified }
}
