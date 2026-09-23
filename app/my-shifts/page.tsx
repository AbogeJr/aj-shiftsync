import { PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { todayAtLocation, weekStartOf } from '@/lib/scheduling/schedule'
import { myWeek, openShiftsForMe } from '@/lib/scheduling/staff-view'
import { hours as fmtHours, weekRangeLabel } from '@/lib/format'
import { MyWeekView } from './_components/my-week-view'

export const dynamic = 'force-dynamic'

export default async function MyShiftsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const today = await todayAtLocation('UTC')
  const weekStart = weekStartOf(today)

  let week, offers
  try {
    ;[week, offers] = await Promise.all([myWeek(weekStart), openShiftsForMe(weekStart)])
  } catch (err) {
    handleAuthError(err)
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  return (
    <>
      <PageHeader
        title="My shifts"
        subtitle={`${week.name} · ${weekRangeLabel(days)}`}
        action={
          <span className="text-sm tabular text-slate-600">
            <strong>{fmtHours(week.totalHours)}</strong> hrs
            {week.desiredWeeklyHours > 0 && (
              <span className="text-slate-400"> / {week.desiredWeeklyHours} desired</span>
            )}
          </span>
        }
      />

      <MyWeekView week={week} offers={offers} days={days} today={today} />
    </>
  )
}
