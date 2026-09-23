import { eq, sql } from 'drizzle-orm'
import { db as defaultDb, type Db, type Tx } from '@/lib/db'
import { assignments, auditLog, complianceOverrides, shifts } from '@/lib/db/schema'
import { publishScheduleChange } from '@/lib/realtime/bus'
import { notify } from './notifications'
import { authorizeAssignment, type Actor } from './access'
import { evaluateEligibility } from './eligibility'
import { loadEligibility } from './eligibility-query'
import {
  ConflictError,
  EligibilityError,
  NO_OVERLAP_OR_SHORT_REST,
  NotFoundError,
  asPostgresError,
  isExclusionViolation,
  isRetryableConcurrencyError,
} from './errors'

export type { Actor }

export interface AssignStaffInput {
  shiftId: string
  staffId: string
  actor?: Actor
  /**
   * A manager's documented reason for exceeding a rule that permits one - the
   * 7th consecutive day. Recorded in compliance_overrides alongside the
   * assignment, so the exception is auditable rather than invisible.
   */
  override?: { rule: string; reason: string }
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
  const { shiftId, staffId, actor = { kind: 'session' }, override } = input
  let actorStaffId: string | null = actor.kind === 'system' ? (actor.staffId ?? null) : null

  try {
    const { assignment, locationId } = await withDeadlockRetry(() =>
      db.transaction(async (tx) => {
      // .for('update') serialises concurrent assignments to the SAME shift,
      // which is what makes the headcount check below safe: without it two
      // requests could both count "one seat left" and both take it.
      const [shift] = await tx
        .select({
          id: shifts.id,
          locationId: shifts.locationId,
          startsAt: shifts.startsAt,
          endsAt: shifts.endsAt,
          publishedAt: shifts.publishedAt,
        })
        .from(shifts)
        .where(eq(shifts.id, shiftId))
        .limit(1)
        .for('update')

      if (!shift) throw new NotFoundError('Shift', shiftId)

      // Authorization sits here, not in the caller: a check in a route handler
      // only protects that one route.
      if (actor.kind === 'session') {
        const session = await authorizeAssignment(
          { locationId: shift.locationId, published: shift.publishedAt !== null },
          staffId,
          db,
        )
        actorStaffId = session.userId
      }

      const [candidate] = await loadEligibility(tx, shiftId, staffId)
      if (!candidate) throw new NotFoundError('Shift or staff', `${shiftId}/${staffId}`)

      // An override only lifts the rule it names, and only rules that allow it.
      const context = {
        ...candidate.context,
        overrideProvided: override?.rule === 'seventh_consecutive_day',
      }
      const violations = evaluateEligibility(context)
      if (violations.length > 0) throw new EligibilityError(violations)

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

      if (override) {
        if (!override.reason.trim()) {
          throw new EligibilityError([
            { code: 'seventh_consecutive_day', message: 'An override needs a documented reason.' },
          ])
        }
        await tx.insert(complianceOverrides).values({
          assignmentId: assignment.id,
          rule: override.rule,
          reason: override.reason.trim(),
          overriddenBy: actorStaffId ?? staffId,
        })
      }

      // Only for a published shift. A draft is invisible to staff by design, so
      // telling them about it would announce a schedule they cannot see and
      // that may still change. Publishing is what notifies them - see
      // publishWeek in shifts.ts.
      if (shift.publishedAt !== null) {
        await notify(tx, {
          staffId,
          type: 'shift.assigned',
          title: 'You have a new shift',
          body: 'Check My shifts for the details.',
          meta: { shiftId: shift.id },
        })
      }

      await tx.insert(auditLog).values({
        actorStaffId,
        locationId: shift.locationId,
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
      }),
    )

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
      // collided or whether the cause was overlap or short rest, so the message
      // names both rules rather than guessing at one.
      throw new ConflictError({
        message:
          'Assignment rejected: it would overlap another shift or leave under 10 hours of rest.',
        constraint: NO_OVERLAP_OR_SHORT_REST,
        detail: asPostgresError(err)?.detail,
        cause: err,
      })
    }
    throw err
  }
}

/**
 * Retry once on a deadlock.
 *
 * Two managers assigning the same person to two mutually conflicting shifts
 * each lock a different shift row, then each waits on the other's uncommitted
 * entry in the exclusion constraint's index - a genuine deadlock, which
 * Postgres breaks by aborting one transaction with 40P01 after
 * deadlock_timeout. That abort is not a rule violation, so failing the request
 * would be wrong: on the retry the winner has committed, and the loser gets the
 * clean 23P01 conflict it should have had all along.
 */
async function withDeadlockRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (!isRetryableConcurrencyError(err)) throw err
    return run()
  }
}
