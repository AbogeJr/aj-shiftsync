import { redirect } from 'next/navigation'
import { ForbiddenError, getSession, UnauthorizedError } from '@/lib/auth'
import {
  ALL_LOCATIONS,
  getCombinedWeekSchedule,
  getWeekSchedule,
  listAccessibleLocations,
  listSkills,
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

  const combined = params.location === ALL_LOCATIONS
  const location = locations.find((l) => l.id === params.location) ?? locations[0]
  // "This week" means this week where the restaurant is, not where the server
  // is. Across locations there is no single answer, so the first one anchors
  // which week is shown - the seven dates are the same either way.
  const today = await todayAtLocation(location.timezone)
  const week = weekStartOf(params.week ?? today)
  const [schedule, skills] = await Promise.all([
    combined ? getCombinedWeekSchedule(week) : getWeekSchedule(location.id, week),
    listSkills(),
  ])

  return (
    <ScheduleView
      schedule={schedule}
      locations={locations}
      skills={skills}
      role={session.role}
      canEdit={session.role !== 'staff'}
      today={today}
      weekStart={week}
    />
  )
}
