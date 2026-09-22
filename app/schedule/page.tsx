import { redirect } from 'next/navigation'
import { ForbiddenError, getSession, UnauthorizedError } from '@/lib/auth'
import {
  getWeekSchedule,
  listAccessibleLocations,
  todayAtLocation,
  weekStartOf,
} from '@/lib/scheduling/schedule'
import { ScheduleView } from './_components/schedule-view'

export const dynamic = 'force-dynamic'

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ location?: string; week?: string }>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role === 'staff') redirect('/login?error=managers-only')

  const params = await searchParams

  let locations
  try {
    locations = await listAccessibleLocations()
  } catch (err) {
    // The cookie named an account that no longer exists.
    if (err instanceof UnauthorizedError) redirect('/login?error=session-expired')
    // The cookie's role is stale - the account has since been demoted. The
    // database row is authoritative, so send them back to sign in again.
    if (err instanceof ForbiddenError) redirect('/login?error=managers-only')
    throw err
  }
  if (locations.length === 0) {
    return (
      <main className="p-10 text-sm text-slate-600">
        No locations are assigned to this account.
      </main>
    )
  }

  const location = locations.find((l) => l.id === params.location) ?? locations[0]
  // "This week" means this week where the restaurant is, not where the server is.
  const today = await todayAtLocation(location.timezone)
  const week = weekStartOf(params.week ?? today)
  const schedule = await getWeekSchedule(location.id, week)

  return (
    <ScheduleView
      schedule={schedule}
      locations={locations}
      role={session.role}
      today={today}
      weekStart={week}
    />
  )
}
