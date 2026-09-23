import { cache } from 'react'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { eq, sql } from 'drizzle-orm'
import { requireAuthSecret } from '@/lib/env'
import { db } from '@/lib/db'
import { staff, staffRole } from '@/lib/db/schema'

/**
 * Demo-scoped auth: a JSON payload plus an HMAC-SHA256 signature in an httpOnly
 * cookie. Enough to make the role trustworthy server-side, with no dependency
 * beyond node:crypto. Not production auth - no passwords, no expiry in the
 * signature, no revocation. See the README.
 */

export const SESSION_COOKIE = 'shiftsync_session'

/** Mirrors the staff_role enum so the two cannot drift apart. */
export type Role = (typeof staffRole.enumValues)[number]

export interface SessionPayload {
  userId: string
  role: Role
}

/** Seeded one-click accounts. Shared by the seed script and the login action. */
export const DEMO_ACCOUNTS: ReadonlyArray<{ role: Role; email: string; name: string }> = [
  { role: 'admin', email: 'admin@shiftsync.test', name: 'Michael Scott' },
  { role: 'manager', email: 'manager@shiftsync.test', name: 'Pam Beesly' },
  { role: 'staff', email: 'staff@shiftsync.test', name: 'Jim Halpert' },
]

/** Where a role lands after signing in. Managers and admins get the roll-up. */
export function homePathFor(role: Role): string {
  return role === 'staff' ? '/my-shifts' : '/overview'
}

export class UnauthorizedError extends Error {
  readonly name = 'UnauthorizedError'
  readonly code = 'UNAUTHORIZED' as const
  constructor() {
    super('Not signed in')
  }
}

export class ForbiddenError extends Error {
  readonly name = 'ForbiddenError'
  readonly code = 'FORBIDDEN' as const
  constructor(allowed: readonly Role[], actual: Role) {
    super(`Requires role ${allowed.join(' or ')}, but session has ${actual}`)
  }
}

function sign(body: string): Buffer {
  return createHmac('sha256', requireAuthSecret()).update(body).digest()
}

export function signSession(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body).toString('base64url')}`
}

export function verifySession(token: string): SessionPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, signature] = parts

  const expected = sign(body)
  const provided = Buffer.from(signature, 'base64url')

  // timingSafeEqual throws on a length mismatch. Comparing lengths first is not
  // itself timing-safe, but digest length is public and leaks nothing.
  if (provided.length !== expected.length) return null
  if (!timingSafeEqual(provided, expected)) return null

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (typeof parsed?.userId !== 'string') return null
    if (!staffRole.enumValues.includes(parsed.role)) return null
    return { userId: parsed.userId, role: parsed.role }
  } catch {
    return null
  }
}

/** Server context only. */
export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  return token ? verifySession(token) : null
}

/**
 * Call from service functions in lib/scheduling/*, not from route handlers or
 * actions - a check in the caller only protects that one caller.
 *
 * The signed cookie proves the payload was not tampered with; it does not prove
 * the account still exists or still has that role. A cookie outlives the row it
 * names - after the account is deleted, or after the role changes - so the row
 * is loaded and treated as the authority. Without this, a deleted account's
 * session survives until expiry and fails late with a foreign-key error inside
 * a transaction, and a demoted manager keeps manager access.
 */
/**
 * The authorisation read, deduplicated for the lifetime of one request.
 *
 * Every service function calls requireRole, and a page calls several of them,
 * so this fired once per service - six identical lookups to render one screen.
 * React's cache() is request-scoped, so two people's sessions can never share
 * an entry, and a role change is still picked up on the very next request.
 */
const loadActor = cache(async (userId: string) => {
  const [row] = await db
    .select({ id: staff.id, role: staff.role })
    .from(staff)
    .where(eq(staff.id, userId))
    .limit(1)
  return row ?? null
})

export async function requireRole(...allowed: Role[]): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()

  const row = await loadActor(session.userId)

  if (!row) throw new UnauthorizedError()
  if (!allowed.includes(row.role)) throw new ForbiddenError(allowed, row.role)

  return { userId: row.id, role: row.role }
}

export interface SignInOption {
  id: string
  name: string
  email: string
  role: Role
  skills: string[]
  locations: string[]
}

/**
 * Everyone who can be signed in as, for the demo picker.
 *
 * Demo-only, and only safe because this build has no passwords at all - see the
 * README. A real sign-in screen must never enumerate accounts.
 */
export async function listSignInOptions(): Promise<SignInOption[]> {
  const rows = await db.execute<{
    id: string
    name: string
    email: string
    role: Role
    skills: string[] | null
    locations: string[] | null
  }>(sql`
    SELECT st.id, st.name, st.email, st.role::text AS role,
           ARRAY(SELECT k.skill FROM staff_skills k WHERE k.staff_id = st.id ORDER BY k.skill) AS skills,
           ARRAY(
             SELECT l.name FROM certifications c JOIN locations l ON l.id = c.location_id
             WHERE c.staff_id = st.id AND (c.revoked_at IS NULL OR c.revoked_at > now())
             ORDER BY l.name
           ) AS locations
    FROM staff st
    ORDER BY CASE st.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END, st.name
  `)
  return rows.rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    skills: r.skills ?? [],
    locations: r.locations ?? [],
  }))
}
