import { redirect } from 'next/navigation'
import { ForbiddenError, getSession, UnauthorizedError } from '@/lib/auth'
import { todayAtLocation, weekStartOf } from '@/lib/scheduling/schedule'

/**
 * Shared guard for the manager screens: one place that decides where an
 * unauthenticated, stale or staff-only session is sent.
 */
export async function requireManagerPage(
  /** `?week=` from the page, so a manager can look at any week, not just this one. */
  week?: string,
): Promise<{ role: string; weekStart: string; thisWeek: string }> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'staff') redirect('/login?error=managers-only')
  // UTC is only used to pick "which week"; every figure is computed per
  // location in that location's own timezone.
  const thisWeek = weekStartOf(await todayAtLocation('UTC'))
  // A malformed ?week= falls back rather than 500ing: the parameter is in the
  // URL bar, so it will get mangled by hand sooner or later.
  const requested = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStartOf(week) : thisWeek
  return { role: session.role, weekStart: requested, thisWeek }
}

export function handleAuthError(err: unknown): never {
  if (err instanceof UnauthorizedError) redirect('/login?error=session-expired')
  if (err instanceof ForbiddenError) redirect('/login?error=managers-only')
  throw err
}
