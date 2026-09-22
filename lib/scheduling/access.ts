import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { certifications, managerLocations } from '@/lib/db/schema'
import { requireRole, type SessionPayload } from '@/lib/auth'
import { LocationAccessError } from './errors'

/**
 * Authorize the caller for a location. Lives here rather than in the route so a
 * second caller cannot skip it.
 *
 * Admins see everything. Managers see only locations they are assigned to.
 * Staff are not granted location-wide visibility.
 */
/**
 * Who is performing a write. Defaults to 'session' everywhere, so forgetting
 * the argument gets you the authorized path - seeds and tests must opt out
 * explicitly rather than authorization being opt-in.
 */
export type Actor = { kind: 'session' } | { kind: 'system'; staffId?: string | null }

export const SESSION_ACTOR: Actor = { kind: 'session' }

/**
 * Who may put `staffId` on this shift.
 *
 * Managers and admins schedule anyone at locations they run. A staff member may
 * only claim an *open, published* shift for themselves - that is the brief's
 * "pick up available shifts they're qualified for". Publication is the gate:
 * a draft schedule is not visible to staff, so it cannot be claimed either.
 *
 * Eligibility (skill, certification, availability, headcount) is checked
 * separately by evaluateEligibility - this decides only who may ask.
 */
export async function authorizeAssignment(
  shift: { locationId: string; published: boolean },
  staffId: string,
  db: Db = defaultDb,
): Promise<SessionPayload> {
  const session = await requireRole('admin', 'manager', 'staff')

  if (session.role !== 'staff') {
    return requireLocationAccess(shift.locationId, db)
  }

  if (session.userId !== staffId) {
    throw new LocationAccessError(shift.locationId)
  }
  if (!shift.published) {
    throw new LocationAccessError(shift.locationId)
  }
  return session
}

/** Authorize unless the caller is trusted system code (seeds, tests, jobs). */
export async function authorizeLocation(
  locationId: string,
  actor: Actor,
  db: Db = defaultDb,
): Promise<SessionPayload | null> {
  if (actor.kind === 'system') return null
  return requireLocationAccess(locationId, db)
}

/**
 * May the caller *view* this location's schedule?
 *
 * Wider than requireLocationAccess: staff can read the published schedule at
 * any location they are certified for, which is how they see who is on with
 * them and what is open. Editing still needs requireLocationAccess.
 */
export async function requireLocationVisibility(
  locationId: string,
  db: Db = defaultDb,
): Promise<SessionPayload> {
  const session = await requireRole('admin', 'manager', 'staff')
  if (session.role !== 'staff') return requireLocationAccess(locationId, db)

  const [certified] = await db
    .select({ id: certifications.id })
    .from(certifications)
    .where(
      and(
        eq(certifications.staffId, session.userId),
        eq(certifications.locationId, locationId),
        or(isNull(certifications.revokedAt), gt(certifications.revokedAt, new Date())),
      ),
    )
    .limit(1)

  if (!certified) throw new LocationAccessError(locationId)
  return session
}

export async function requireLocationAccess(
  locationId: string,
  db: Db = defaultDb,
): Promise<SessionPayload> {
  const session = await requireRole('admin', 'manager')
  if (session.role === 'admin') return session

  const [assigned] = await db
    .select({ staffId: managerLocations.staffId })
    .from(managerLocations)
    .where(
      and(
        eq(managerLocations.staffId, session.userId),
        eq(managerLocations.locationId, locationId),
      ),
    )
    .limit(1)

  if (!assigned) throw new LocationAccessError(locationId)
  return session
}
