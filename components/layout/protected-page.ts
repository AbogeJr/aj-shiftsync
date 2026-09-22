import { redirect } from 'next/navigation'
import { ForbiddenError, getSession, UnauthorizedError } from '@/lib/auth'
import { todayAtLocation, weekStartOf } from '@/lib/scheduling/schedule'

/**
 * Shared guard for the manager screens: one place that decides where an
 * unauthenticated, stale or staff-only session is sent.
 */
export async function requireManagerPage(): Promise<{ role: string; weekStart: string }> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'staff') redirect('/login?error=managers-only')
  // UTC is only used to pick "which week"; every figure is computed per
  // location in that location's own timezone.
  return { role: session.role, weekStart: weekStartOf(await todayAtLocation('UTC')) }
}

export function handleAuthError(err: unknown): never {
  if (err instanceof UnauthorizedError) redirect('/login?error=session-expired')
  if (err instanceof ForbiddenError) redirect('/login?error=managers-only')
  throw err
}
