import { eq } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { assignments, auditLog, shifts } from '@/lib/db/schema'
import { publishScheduleChange } from '@/lib/realtime/bus'
import {
  ConflictError,
  NO_OVERLAP_OR_SHORT_REST,
  NotFoundError,
  asPostgresError,
  isExclusionViolation,
} from './errors'

export interface AssignStaffInput {
  shiftId: string
  staffId: string
  /** Who performed the action, for the audit trail. Null for system actions. */
  actorStaffId?: string | null
}

export type Assignment = typeof assignments.$inferSelect

/**
 * Assign a staff member to a shift.
 *
 * A plain function, deliberately not a route handler: route handlers and server
 * actions call this and do nothing but translate its result to a response.
 *
 * Correctness rests on the database, not on a check performed here. The
 * no_overlap_or_short_rest exclusion constraint (drizzle/0001_*.sql) is what
 * guarantees no double-booking and no sub-10-hour turnaround, and it holds
 * under concurrent writers - a pre-flight SELECT would not, because two
 * requests can both read "no conflict" before either inserts. So the shape here
 * is attempt-then-interpret rather than check-then-write.
 *
 * @throws NotFoundError when the shift does not exist.
 * @throws ConflictError when the assignment would overlap or break rest.
 */
export async function assignStaffToShift(
  input: AssignStaffInput,
  db: Db = defaultDb,
): Promise<Assignment> {
  const { shiftId, staffId, actorStaffId = null } = input

  try {
    const { assignment, locationId } = await db.transaction(async (tx) => {
      const [shift] = await tx
        .select({
          id: shifts.id,
          locationId: shifts.locationId,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
        })
        .from(shifts)
        .where(eq(shifts.id, shiftId))
        .limit(1)

      if (!shift) throw new NotFoundError('Shift', shiftId)

      // The denormalization sync point. assignments.starts_at/ends_at exist so
      // the exclusion constraint can see them, and they are only ever derived
      // from the shift - never supplied by a caller. The mirrored obligation
      // lives on the edit path: a transaction that moves a shift's times must
      // update its active assignments before it commits.
      const [assignment] = await tx
        .insert(assignments)
        .values({
          shiftId: shift.id,
          staffId,
          status: 'active',
          startsAt: shift.startsAt,
          endsAt: shift.endsAt,
        })
        .returning()

      await tx.insert(auditLog).values({
        actorStaffId,
        entityType: 'assignment',
        entityId: assignment.id,
        action: 'assignment.created',
        before: null,
        after: {
          shiftId: assignment.shiftId,
          staffId: assignment.staffId,
          status: assignment.status,
          startsAt: assignment.startsAt.toISOString(),
          endsAt: assignment.endsAt.toISOString(),
        },
      })

      return { assignment, locationId: shift.locationId }
    })

    // Emitted only once the transaction has committed. The bus is in-process
    // and has no rollback, so announcing from inside the transaction could tell
    // subscribers about a write that never landed.
    publishScheduleChange({
      locationId,
      type: 'assignment.created',
      shiftId: assignment.shiftId,
      assignmentId: assignment.id,
      staffId,
    })

    return assignment
  } catch (err) {
    if (isExclusionViolation(err, NO_OVERLAP_OR_SHORT_REST)) {
      // The database told us THAT the assignment is illegal. It cannot tell us
      // WHICH existing shift collided, or whether the cause was an overlap or a
      // short rest gap - the constraint reports one conflicting key, not a
      // story a manager can act on.
      //
      // TODO(validator): call the pure validator here to build `explanation`.
      // Load the staff member's active assignments in the surrounding window
      // (shift.starts_at - 10h .. shift.ends_at + 10h) and pass them plus the
      // candidate interval to it; it returns the human-readable reason, e.g.
      // "Sam finishes at 22:00 on Tue and this shift starts at 06:00 Wed -
      // 8 hours rest, 10 required." Keep it a pure function over already-loaded
      // rows so it is unit-testable without a database, and reuse it for
      // pre-flight UI warnings on the assignment form.
      const explanation = undefined

      throw new ConflictError({
        message:
          'Assignment rejected: it would overlap another shift or leave under 10 hours of rest.',
        constraint: NO_OVERLAP_OR_SHORT_REST,
        explanation,
        detail: asPostgresError(err)?.detail,
        cause: err,
      })
    }
    throw err
  }
}
