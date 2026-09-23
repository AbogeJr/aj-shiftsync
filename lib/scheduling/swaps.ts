import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { publishScheduleChange } from '@/lib/realtime/bus'
import { managersOf, notify, notifyAll } from './notifications'
import { authorizeLocation, SESSION_ACTOR, type Actor } from './access'
import { evaluateEligibility } from './eligibility'
import { loadEligibility } from './eligibility-query'
import {
  ConflictError,
  isExclusionViolation,
  NO_OVERLAP_OR_SHORT_REST,
  NotFoundError,
  SwapError,
  asPostgresError,
} from './errors'

/**
 * Swap and drop requests (brief §3).
 *
 * The workflow is deliberately two-staged: a peer accepts, then a manager
 * approves, and the ORIGINAL assignment stands until that approval. Nothing
 * moves on the schedule until `approve` runs, so a half-agreed swap can never
 * leave a shift uncovered.
 */

/** A staff member may not have more than this many requests in flight. */
export const MAX_PENDING_REQUESTS = 3

/** A drop stops being claimable this long before the shift starts. */
export const DROP_EXPIRY_HOURS = 24

const PENDING = sql`('open', 'peer_accepted')`

/**
 * The staff id performing the action. Defaults to the session, so forgetting
 * the argument gets the authenticated path; seeds and tests opt out explicitly.
 */
async function actingStaffId(actor: Actor): Promise<string> {
  if (actor.kind === 'system') {
    if (!actor.staffId) throw new SwapError('System actor needs a staffId for swap operations.')
    return actor.staffId
  }
  return (await requireRole('admin', 'manager', 'staff')).userId
}

async function pendingCount(db: Db, staffId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM swap_requests
    WHERE requested_by = ${staffId} AND status IN ${PENDING}
  `)
  return rows.rows[0]?.n ?? 0
}

interface OwnedAssignment {
  assignmentId: string
  shiftId: string
  locationId: string
  staffId: string
  startsAt: Date
  published: boolean
}

async function loadAssignment(db: Db, assignmentId: string): Promise<OwnedAssignment> {
  const rows = await db.execute<{
    id: string
    shift_id: string
    location_id: string
    staff_id: string
    starts_at: string
    published: boolean
  }>(sql`
    SELECT a.id, a.shift_id, sh.location_id, a.staff_id, a.starts_at,
           sh.published_at IS NOT NULL AS published
    FROM assignments a JOIN shifts sh ON sh.id = a.shift_id
    WHERE a.id = ${assignmentId} AND a.status = 'active'
  `)
  const row = rows.rows[0]
  if (!row) throw new NotFoundError('Assignment', assignmentId)
  return {
    assignmentId: row.id,
    shiftId: row.shift_id,
    locationId: row.location_id,
    staffId: row.staff_id,
    // drizzle's raw execute bypasses its column mapping, so timestamps arrive
    // as strings rather than Dates.
    startsAt: new Date(row.starts_at),
    published: row.published,
  }
}

async function assertCanRequest(db: Db, assignment: OwnedAssignment, requesterId: string) {
  if (assignment.staffId !== requesterId) {
    throw new SwapError('You can only offer up a shift that is assigned to you.')
  }
  if (!assignment.published) {
    throw new SwapError('This shift is not published yet, so it cannot be swapped or dropped.')
  }
  if (assignment.startsAt.getTime() <= Date.now()) {
    throw new SwapError('This shift has already started.')
  }
  const existing = await db.execute<{ id: string }>(sql`
    SELECT id FROM swap_requests
    WHERE assignment_id = ${assignment.assignmentId} AND status IN ${PENDING}
  `)
  if (existing.rows.length > 0) {
    throw new SwapError('You already have a request open for this shift.')
  }

  const pending = await pendingCount(db, requesterId)
  if (pending >= MAX_PENDING_REQUESTS) {
    throw new SwapError(
      `You already have ${pending} requests waiting. Resolve one before opening another.`,
    )
  }
}

/** Offer a shift up for anyone qualified to claim. */
export async function requestDrop(
  assignmentId: string,
  reason: string | null,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<{ id: string }> {
  const me = await actingStaffId(actor)
  const assignment = await loadAssignment(db, assignmentId)
  await assertCanRequest(db, assignment, me)

  const expiresAt = new Date(
    assignment.startsAt.getTime() - DROP_EXPIRY_HOURS * 60 * 60 * 1000,
  )
  if (expiresAt.getTime() <= Date.now()) {
    throw new SwapError(
      `Drops close ${DROP_EXPIRY_HOURS} hours before a shift starts. Contact your manager instead.`,
    )
  }

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO swap_requests (assignment_id, requested_by, kind, expires_at, reason, status)
    VALUES (${assignmentId}, ${me}, 'drop', ${expiresAt.toISOString()}, ${reason}, 'open')
    RETURNING id
  `)

  await notifyAll(db, await managersOf(db, assignment.locationId), {
    type: 'swap.requested',
    title: 'A shift was offered up',
    body: 'Someone has put a shift up for grabs. It needs your approval once claimed.',
    meta: { shiftId: assignment.shiftId },
  })

  publishScheduleChange({ locationId: assignment.locationId, type: 'shift.updated', shiftId: assignment.shiftId })
  return { id: rows.rows[0].id }
}

/** Offer to trade your assignment for a named colleague's. */
export async function requestSwap(
  assignmentId: string,
  targetAssignmentId: string,
  reason: string | null,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<{ id: string }> {
  const me = await actingStaffId(actor)
  const mine = await loadAssignment(db, assignmentId)
  const theirs = await loadAssignment(db, targetAssignmentId)
  await assertCanRequest(db, mine, me)

  if (theirs.staffId === me) {
    throw new SwapError('Pick a colleague&apos;s shift to swap with.')
  }

  // Both sides must be able to work the other's shift, or approval would only
  // fail later. Checking now is what makes the offer honest.
  await assertMutuallyEligible(db, mine, theirs)

  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO swap_requests
      (assignment_id, requested_by, requested_to, kind, target_assignment_id, reason, status)
    VALUES (${assignmentId}, ${me}, ${theirs.staffId}, 'swap',
            ${targetAssignmentId}, ${reason}, 'open')
    RETURNING id
  `)

  await notify(db, {
    staffId: theirs.staffId,
    type: 'swap.requested',
    title: 'A colleague wants to swap shifts with you',
    body: reason ?? 'Open Requests to accept or decline.',
    meta: { shiftId: mine.shiftId },
  })

  publishScheduleChange({ locationId: mine.locationId, type: 'shift.updated', shiftId: mine.shiftId })
  return { id: rows.rows[0].id }
}

async function assertMutuallyEligible(db: Db, a: OwnedAssignment, b: OwnedAssignment) {
  const [aOnB] = await loadEligibility(db, b.shiftId, a.staffId)
  const [bOnA] = await loadEligibility(db, a.shiftId, b.staffId)

  // The seat each would move into is currently held by the other, so a full
  // headcount is expected and is not a reason to refuse. `already_assigned` is
  // NOT ignored: someone already on the other shift cannot take a second seat
  // on it, and the exclusion constraint would reject the approval anyway.
  const ignoreFull = (v: { code: string; message: string }[]) =>
    v.filter((x) => x.code !== 'shift_full')

  const aProblems = ignoreFull(evaluateEligibility(aOnB.context))
  if (aProblems.length > 0) throw new SwapError(aProblems.map((v) => v.message).join(' '))

  const bProblems = ignoreFull(evaluateEligibility(bOnA.context))
  if (bProblems.length > 0) throw new SwapError(bProblems.map((v) => v.message).join(' '))
}

/** The named colleague agrees, or someone claims an open drop. */
export async function acceptRequest(
  requestId: string,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<void> {
  const me = await actingStaffId(actor)
  const request = await loadRequest(db, requestId)

  if (request.status !== 'open') throw new SwapError('This request is no longer open.')
  if (request.kind === 'swap' && request.requestedTo !== me) {
    throw new SwapError('This swap was offered to someone else.')
  }
  if (request.kind === 'drop') {
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw new SwapError('This drop has expired.')
    }
    const [claimant] = await loadEligibility(db, request.shiftId, me)
    // shift_full is expected - the requester's seat is about to be vacated.
    // Being already on the shift is not: you cannot take a second seat on it.
    const problems = evaluateEligibility(claimant.context).filter(
      (v) => v.code !== 'shift_full',
    )
    if (problems.length > 0) throw new SwapError(problems.map((v) => v.message).join(' '))
  }

  await db.execute(sql`
    UPDATE swap_requests
    SET status = 'peer_accepted', requested_to = ${me}
    WHERE id = ${requestId} AND status = 'open'
  `)

  await notify(db, {
    staffId: request.requestedBy,
    type: 'swap.accepted',
    title: 'Your request was accepted',
    body: 'It now needs a manager to approve it.',
    meta: { shiftId: request.shiftId },
  })
  await notifyAll(db, await managersOf(db, request.locationId), {
    type: 'swap.accepted',
    title: 'A swap is ready for your approval',
    meta: { shiftId: request.shiftId },
  })

  publishScheduleChange({ locationId: request.locationId, type: 'shift.updated', shiftId: request.shiftId })
}

/**
 * The requester changes their mind - the brief's "Regret Swap".
 *
 * Allowed at any point before a manager approves, because nothing has moved on
 * the schedule yet. Once approved there is no request left to cancel.
 */
export async function cancelRequest(
  requestId: string,
  db: Db = defaultDb,
  actor: Actor = SESSION_ACTOR,
): Promise<void> {
  const me = await actingStaffId(actor)
  const request = await loadRequest(db, requestId)

  if (request.requestedBy !== me && actor.kind !== 'system') {
    throw new SwapError('Only the person who opened this request can withdraw it.')
  }
  if (request.status === 'approved') {
    throw new SwapError('This swap was already approved and applied.')
  }

  await db.execute(sql`
    UPDATE swap_requests SET status = 'cancelled', resolved_at = now()
    WHERE id = ${requestId} AND status IN ${PENDING}
  `)

  await notifyAll(
    db,
    [request.requestedBy, request.requestedTo].filter((id): id is string => id !== null),
    {
      type: 'swap.cancelled',
      title: 'A request was withdrawn',
      body: 'The schedule is unchanged.',
      meta: { shiftId: request.shiftId },
    },
  )

  publishScheduleChange({ locationId: request.locationId, type: 'shift.updated', shiftId: request.shiftId })
}

export async function rejectRequest(requestId: string, db: Db = defaultDb): Promise<void> {
  const request = await loadRequest(db, requestId)
  await authorizeLocation(request.locationId, SESSION_ACTOR, db)
  await db.execute(sql`
    UPDATE swap_requests SET status = 'rejected', resolved_at = now()
    WHERE id = ${requestId} AND status IN ${PENDING}
  `)
  await notifyAll(
    db,
    [request.requestedBy, request.requestedTo].filter((id): id is string => id !== null),
    { type: 'swap.rejected', title: 'Your request was declined by a manager', meta: { shiftId: request.shiftId } },
  )
  publishScheduleChange({ locationId: request.locationId, type: 'shift.updated', shiftId: request.shiftId })
}

/**
 * Manager approval, which is the only point at which the schedule changes.
 *
 * Both assignment rows move inside one transaction, so the exclusion constraint
 * sees the finished state. If the trade would double-book anyone or break a
 * rest gap, the whole approval rolls back and the original schedule stands.
 */
export async function approveRequest(
  requestId: string,
  actor: Actor = SESSION_ACTOR,
  db: Db = defaultDb,
): Promise<void> {
  const request = await loadRequest(db, requestId)
  const session = await authorizeLocation(request.locationId, actor, db)

  if (request.status !== 'peer_accepted') {
    throw new SwapError('This request still needs someone to accept it.')
  }
  if (!request.requestedTo) throw new SwapError('This request has nobody to move the shift to.')

  try {
    await db.transaction(async (tx) => {
      // Vacate first, then fill: doing it in this order means the constraint
      // never sees both people on the same shift at once.
      await tx.execute(sql`
        UPDATE assignments SET status = 'cancelled' WHERE id = ${request.assignmentId}
      `)
      if (request.targetAssignmentId) {
        await tx.execute(sql`
          UPDATE assignments SET status = 'cancelled' WHERE id = ${request.targetAssignmentId}
        `)
      }

      await tx.execute(sql`
        INSERT INTO assignments (shift_id, staff_id, status, starts_at, ends_at)
        SELECT sh.id, ${request.requestedTo}, 'active', sh.starts_at, sh.ends_at
        FROM shifts sh WHERE sh.id = ${request.shiftId}
      `)

      if (request.targetShiftId) {
        await tx.execute(sql`
          INSERT INTO assignments (shift_id, staff_id, status, starts_at, ends_at)
          SELECT sh.id, ${request.requestedBy}, 'active', sh.starts_at, sh.ends_at
          FROM shifts sh WHERE sh.id = ${request.targetShiftId}
        `)
      }

      await tx.execute(sql`
        UPDATE swap_requests
        SET status = 'approved', approved_by = ${session?.userId ?? null},
            approved_at = now(), resolved_at = now()
        WHERE id = ${requestId}
      `)

      // Both parties, in the same transaction as the move itself.
      await notifyAll(
        tx,
        [request.requestedBy, request.requestedTo].filter((id): id is string => id !== null),
        {
          type: 'swap.approved',
          title: 'Your swap was approved',
          body: 'The schedule has been updated.',
          meta: { shiftId: request.shiftId },
        },
      )
    })
  } catch (err) {
    if (isExclusionViolation(err, NO_OVERLAP_OR_SHORT_REST)) {
      throw new ConflictError({
        message:
          'Approving this would double-book someone or leave under 10 hours of rest. The schedule is unchanged.',
        constraint: NO_OVERLAP_OR_SHORT_REST,
        detail: asPostgresError(err)?.detail,
        cause: err,
      })
    }
    throw err
  }

  publishScheduleChange({
    locationId: request.locationId,
    type: 'assignment.created',
    shiftId: request.shiftId,
  })
}

/** Close out drops nobody claimed in time. Safe to run repeatedly. */
export async function expireStaleDrops(db: Db = defaultDb): Promise<number> {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE swap_requests SET status = 'expired', resolved_at = now()
    WHERE kind = 'drop' AND status = 'open' AND expires_at <= now()
    RETURNING id
  `)
  return rows.rows.length
}

interface LoadedRequest {
  id: string
  kind: 'swap' | 'drop'
  status: string
  assignmentId: string
  targetAssignmentId: string | null
  requestedBy: string
  requestedTo: string | null
  expiresAt: Date | null
  shiftId: string
  targetShiftId: string | null
  locationId: string
}

async function loadRequest(db: Db, requestId: string): Promise<LoadedRequest> {
  const rows = await db.execute<{
    id: string
    kind: 'swap' | 'drop'
    status: string
    assignment_id: string
    target_assignment_id: string | null
    requested_by: string
    requested_to: string | null
    expires_at: string | null
    shift_id: string
    target_shift_id: string | null
    location_id: string
  }>(sql`
    SELECT r.id, r.kind::text AS kind, r.status::text AS status, r.assignment_id,
           r.target_assignment_id, r.requested_by, r.requested_to, r.expires_at,
           a.shift_id, ta.shift_id AS target_shift_id, sh.location_id
    FROM swap_requests r
    JOIN assignments a ON a.id = r.assignment_id
    JOIN shifts sh ON sh.id = a.shift_id
    LEFT JOIN assignments ta ON ta.id = r.target_assignment_id
    WHERE r.id = ${requestId}
  `)
  const row = rows.rows[0]
  if (!row) throw new NotFoundError('Request', requestId)
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    assignmentId: row.assignment_id,
    targetAssignmentId: row.target_assignment_id,
    requestedBy: row.requested_by,
    requestedTo: row.requested_to,
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at),
    shiftId: row.shift_id,
    targetShiftId: row.target_shift_id,
    locationId: row.location_id,
  }
}

export interface RequestSummary {
  id: string
  kind: 'swap' | 'drop'
  status: string
  reason: string | null
  requestedByName: string
  requestedToName: string | null
  expiresAt: string | null
  shift: { location: string; localDate: string; startLocal: string; endLocal: string; skill: string | null }
  targetShift: { location: string; localDate: string; startLocal: string; endLocal: string } | null
  /** True when the signed-in user opened this request. */
  mine: boolean
  /** True when it is waiting on the signed-in user to accept. */
  awaitingMe: boolean
}

const SUMMARY_SELECT = sql`
  SELECT r.id, r.kind::text AS kind, r.status::text AS status, r.reason,
         rb.name AS requested_by_name, rt.name AS requested_to_name,
         r.requested_by, r.requested_to,
         to_char(r.expires_at AT TIME ZONE l.timezone, 'YYYY-MM-DD HH24:MI') AS expires_at,
         l.name AS location,
         to_char(sh.starts_at AT TIME ZONE l.timezone, 'YYYY-MM-DD') AS local_date,
         to_char(sh.starts_at AT TIME ZONE l.timezone, 'HH24:MI')    AS start_local,
         to_char(sh.ends_at   AT TIME ZONE l.timezone, 'HH24:MI')    AS end_local,
         sh.required_skill AS skill, sh.id AS shift_id,
         tl.name AS target_location,
         to_char(tsh.starts_at AT TIME ZONE tl.timezone, 'YYYY-MM-DD') AS target_date,
         to_char(tsh.starts_at AT TIME ZONE tl.timezone, 'HH24:MI')    AS target_start,
         to_char(tsh.ends_at   AT TIME ZONE tl.timezone, 'HH24:MI')    AS target_end
  FROM swap_requests r
  JOIN assignments a ON a.id = r.assignment_id
  JOIN shifts sh ON sh.id = a.shift_id
  JOIN locations l ON l.id = sh.location_id
  JOIN staff rb ON rb.id = r.requested_by
  LEFT JOIN staff rt ON rt.id = r.requested_to
  LEFT JOIN assignments ta ON ta.id = r.target_assignment_id
  LEFT JOIN shifts tsh ON tsh.id = ta.shift_id
  LEFT JOIN locations tl ON tl.id = tsh.location_id
`

/* eslint-disable @typescript-eslint/no-explicit-any */
function toSummary(row: any, me: string): RequestSummary {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    requestedByName: row.requested_by_name,
    requestedToName: row.requested_to_name,
    expiresAt: row.expires_at,
    shift: {
      location: row.location,
      localDate: row.local_date,
      startLocal: row.start_local,
      endLocal: row.end_local,
      skill: row.skill,
    },
    targetShift: row.target_location
      ? {
          location: row.target_location,
          localDate: row.target_date,
          startLocal: row.target_start,
          endLocal: row.target_end,
        }
      : null,
    mine: row.requested_by === me,
    awaitingMe: row.status === 'open' && row.requested_to === me,
  }
}

/** Requests the signed-in staff member opened, or that await their answer. */
export async function myRequests(db: Db = defaultDb): Promise<RequestSummary[]> {
  const session = await requireRole('admin', 'manager', 'staff')
  const rows = await db.execute<any>(sql`
    ${SUMMARY_SELECT}
    WHERE (r.requested_by = ${session.userId} OR r.requested_to = ${session.userId})
      AND r.status IN ('open', 'peer_accepted')
    ORDER BY sh.starts_at
  `)
  return rows.rows.map((r) => toSummary(r, session.userId))
}

/** Unclaimed drops the signed-in staff member is eligible to take. */
export async function claimableDrops(db: Db = defaultDb): Promise<RequestSummary[]> {
  const session = await requireRole('admin', 'manager', 'staff')
  const rows = await db.execute<any>(sql`
    ${SUMMARY_SELECT}
    WHERE r.kind = 'drop' AND r.status = 'open'
      AND r.expires_at > now()
      AND r.requested_by <> ${session.userId}
    ORDER BY sh.starts_at
  `)

  const out: RequestSummary[] = []
  for (const row of rows.rows) {
    const [me] = await loadEligibility(db, row.shift_id ?? row.id, session.userId)
    // Vacating the seat is the point of a drop, so a full shift is expected;
    // anything else - including already being on it - disqualifies.
    if (me && evaluateEligibility(me.context).some((v) => v.code !== 'shift_full')) continue
    out.push(toSummary(row, session.userId))
  }
  return out
}

/**
 * Drops that will expire unclaimed, at locations the caller runs.
 *
 * The quietest failure in the whole swap workflow: a drop nobody takes simply
 * lapses, and the shift stays with somebody who has spent a day believing they
 * were covered. Nothing else surfaces that, so a manager only finds out when
 * the person does not turn up.
 */
export async function dropsNearingExpiry(
  withinHours = DROP_EXPIRY_HOURS,
  db: Db = defaultDb,
): Promise<RequestSummary[]> {
  const session = await requireRole('admin', 'manager')
  const rows = await db.execute<any>(sql`
    ${SUMMARY_SELECT}
    WHERE r.kind = 'drop' AND r.status = 'open'
      AND r.expires_at > now()
      AND r.expires_at <= now() + make_interval(hours => ${withinHours})
      AND (${session.role} = 'admin' OR EXISTS (
        SELECT 1 FROM manager_locations ml
        WHERE ml.staff_id = ${session.userId} AND ml.location_id = sh.location_id
      ))
    ORDER BY r.expires_at
  `)
  return rows.rows.map((r) => toSummary(r, session.userId))
}

/** Requests needing a manager decision at locations they run. */
export async function requestsAwaitingApproval(db: Db = defaultDb): Promise<RequestSummary[]> {
  const session = await requireRole('admin', 'manager')
  const rows = await db.execute<any>(sql`
    ${SUMMARY_SELECT}
    WHERE r.status = 'peer_accepted'
      AND (${session.role} = 'admin' OR EXISTS (
        SELECT 1 FROM manager_locations ml
        WHERE ml.staff_id = ${session.userId} AND ml.location_id = sh.location_id
      ))
    ORDER BY sh.starts_at
  `)
  return rows.rows.map((r) => toSummary(r, session.userId))
}
