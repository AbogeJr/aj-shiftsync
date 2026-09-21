import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { requireAuthSecret } from '@/lib/env'
import { staffRole } from '@/lib/db/schema'

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
  { role: 'admin', email: 'admin@shiftsync.test', name: 'Avery Admin' },
  { role: 'manager', email: 'manager@shiftsync.test', name: 'Morgan Manager' },
  { role: 'staff', email: 'staff@shiftsync.test', name: 'Sam Staff' },
]

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
 */
export async function requireRole(...allowed: Role[]): Promise<SessionPayload> {
  const session = await getSession()
  if (!session) throw new UnauthorizedError()
  if (!allowed.includes(session.role)) throw new ForbiddenError(allowed, session.role)
  return session
}
