import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { onDutyNow } from '@/lib/scheduling/attendance'
import { timeLabel } from '@/lib/format'
import { skillStyle } from '@/components/ui/skill-style'
import { LiveBoard } from './_components/live-board'

export const dynamic = 'force-dynamic'

function duration(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default async function OnDutyPage() {
  await requireManagerPage()

  let locations
  try {
    locations = await onDutyNow()
  } catch (err) {
    handleAuthError(err)
  }

  const total = locations.reduce((n, l) => n + l.onDuty.length, 0)
  const missing = locations.reduce((n, l) => n + l.missing.length, 0)

  return (
    <>
      <PageHeader
        title="On duty now"
        subtitle={`${total} clocked in${missing > 0 ? ` · ${missing} not clocked in` : ''}`}
        action={<LiveBoard locationIds={locations.map((l) => l.id)} />}
      />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {locations.map((location) => (
          <Card
            key={location.id}
            title={location.name}
            action={
              <span className="text-xs tabular text-slate-500">
                {location.localNow && `${location.localNow} local`}
              </span>
            }
          >
            {location.onDuty.length === 0 && location.missing.length === 0 ? (
              <EmptyState>Nobody is scheduled right now.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100">
                {location.onDuty.map((entry) => (
                  <li key={entry.assignmentId} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-xs font-semibold text-green-800">
                      {entry.name[0]}
                    </span>
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium">{entry.name}</p>
                      <p className="text-xs tabular text-slate-500">
                        in at {timeLabel(entry.clockedInAt)} · scheduled{' '}
                        {timeLabel(entry.scheduledStart)}–{timeLabel(entry.scheduledEnd)}
                      </p>
                    </div>
                    {entry.requiredSkill && (
                      <span className={`rounded border px-1.5 text-xs ${skillStyle(entry.requiredSkill)}`}>
                        {entry.requiredSkill}
                      </span>
                    )}
                    {entry.minutesLate > 5 && (
                      <Badge className="bg-amber-100 text-amber-900">
                        {duration(entry.minutesLate)} late
                      </Badge>
                    )}
                    {entry.overdue && (
                      <Badge className="bg-rose-100 text-rose-700">past shift end</Badge>
                    )}
                    <span className="w-16 text-right text-xs tabular text-slate-500">
                      {duration(entry.minutesOnDuty)}
                    </span>
                  </li>
                ))}

                {location.missing.map((person) => (
                  <li key={person.name} className="flex flex-wrap items-center gap-3 py-2.5 opacity-70">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                      {person.name[0]}
                    </span>
                    <div className="min-w-40 flex-1">
                      <p className="text-sm font-medium">{person.name}</p>
                      <p className="text-xs tabular text-slate-500">
                        due at {timeLabel(person.scheduledStart)} · not clocked in
                      </p>
                    </div>
                    <Badge className="bg-rose-100 text-rose-700">
                      {person.minutesLate > 0 ? `${duration(person.minutesLate)} late` : 'due now'}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  )
}
