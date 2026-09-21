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
 * Correctness rests on the no_overlap_or_short_rest exclusion constraint
 * (drizzle/0001_*.sql), not on a check here: two concurrent requests can both
 * read "no conflict" before either inserts, so the shape is
 * attempt-then-interpret rather than check-then-write.
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

      // Times are derived from the shift, never supplied by a caller. The
      // mirrored obligation is on the edit path: a transaction that moves a
      // shift's times must update its active assignments before it commits.
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

    // After commit only - the bus has no rollback.
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
      // The constraint reports THAT the write is illegal, not which shift
      // collided or whether the cause was overlap or short rest.
      //
      // TODO(validator): build `explanation` here. Load the staff member's
      // active assignments in shift.starts_at - 10h .. shift.ends_at + 10h and
      // pass them with the candidate interval to a pure function, so it is
      // testable without a database and reusable for pre-flight UI warnings.
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
