import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { todayAtLocation, weekStartOf } from '@/lib/scheduling/schedule'
import { myWeek, openShiftsForMe } from '@/lib/scheduling/staff-view'
import { hours as fmtHours, longDateLabel, timeLabel, weekRangeLabel } from '@/lib/format'
import { skillStyle } from '@/components/ui/skill-style'
import { ClaimButton } from './_components/claim-button'

export const dynamic = 'force-dynamic'

export default async function MyShiftsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const weekStart = weekStartOf(await todayAtLocation('UTC'))

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

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <Card title="This week">
          {week.shifts.length === 0 ? (
            <EmptyState>
              Nothing scheduled. Only published shifts appear here — your manager may still be
              building the schedule.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {week.shifts.map((shift) => (
                <li key={shift.assignmentId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium">{longDateLabel(shift.localDate)}</p>
                    <p className="text-xs text-slate-500">
                      {shift.location} · {shift.timezone.replace('_', ' ')}
                    </p>
                  </div>
                  <p className="text-sm font-semibold tabular">
                    {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                    {shift.overnight && <span className="text-slate-400"> +1</span>}
                  </p>
                  {shift.requiredSkill && (
                    <span className={`rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}>
                      {shift.requiredSkill}
                    </span>
                  )}
                  <span className="w-14 text-right text-xs tabular text-slate-500">
                    {fmtHours(shift.hours)}h
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Shifts you can pick up">
          <p className="mb-3 text-xs text-slate-500">
            Published shifts with room, at locations you are certified for, that need a skill you
            have and fall inside your availability.
          </p>
          {offers.length === 0 ? (
            <EmptyState>Nothing available to pick up right now.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {offers.map((shift) => (
                <li key={shift.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-40 flex-1">
                    <p className="text-sm font-medium">{longDateLabel(shift.localDate)}</p>
                    <p className="text-xs text-slate-500">{shift.location}</p>
                  </div>
                  <p className="text-sm font-semibold tabular">
                    {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                  </p>
                  {shift.requiredSkill && (
                    <span className={`rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}>
                      {shift.requiredSkill}
                    </span>
                  )}
                  <Badge className="bg-amber-100 text-amber-900">{shift.openSlots} open</Badge>
                  <ClaimButton shiftId={shift.id} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
