import { and, eq } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { managerLocations } from '@/lib/db/schema'
import { requireRole, type SessionPayload } from '@/lib/auth'
import { LocationAccessError } from './errors'

/**
 * Authorize the caller for a location. Lives here rather than in the route so a
 * second caller cannot skip it.
 *
 * Admins see everything. Managers see only locations they are assigned to.
 * Staff are not granted location-wide visibility.
 */
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
