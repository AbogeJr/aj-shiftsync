import { redirect } from 'next/navigation'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { getSession } from '@/lib/auth'
import { myAvailability } from '@/lib/scheduling/availability'
import { longDateLabel, timeLabel, WEEKDAYS } from '@/lib/format'
import { AddException, AddRule, RemoveButton } from './_components/editors'

export const dynamic = 'force-dynamic'

export default async function MyAvailabilityPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  let data
  try {
    data = await myAvailability()
  } catch (err) {
    handleAuthError(err)
  }

  return (
    <>
      <PageHeader
        title="My availability"
        subtitle={`Times are your own local time — ${data.timezone.replace('_', ' ')}`}
      />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        {data.conflicts.length > 0 && (
          <Alert tone="warning">
            You are already scheduled for {data.conflicts.length} shift
            {data.conflicts.length === 1 ? '' : 's'} outside these hours. Existing shifts are not
            cancelled automatically — speak to your manager or offer them up.
          </Alert>
        )}

        <Card title="Every week">
          <AddRule />
          {data.rules.length === 0 ? (
            <EmptyState>
              No weekly availability set. Without any, you will not be scheduled.
            </EmptyState>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {data.rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 py-2">
                  <span className="w-28 text-sm font-medium">{WEEKDAYS[rule.weekday]}</span>
                  <span className="flex-1 text-sm tabular text-slate-600">
                    {timeLabel(rule.startLocal)} – {timeLabel(rule.endLocal)}
                  </span>
                  <RemoveButton id={rule.id} kind="rule" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="One-off changes">
          <AddException />
          {data.exceptions.length === 0 ? (
            <EmptyState>Nothing coming up.</EmptyState>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {data.exceptions.map((exception) => (
                <li key={exception.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-44 text-sm font-medium">
                    {longDateLabel(exception.date)}
                  </span>
                  <span className="flex-1 text-sm tabular text-slate-600">
                    {timeLabel(exception.startLocal)} – {timeLabel(exception.endLocal)}
                  </span>
                  <Badge
                    className={
                      exception.kind === 'unavailable'
                        ? 'bg-rose-100 text-rose-700'
                        : 'bg-green-100 text-green-800'
                    }
                  >
                    {exception.kind}
                  </Badge>
                  <RemoveButton id={exception.id} kind="exception" />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.conflicts.length > 0 && (
          <Card title="Shifts outside your availability">
            <ul className="divide-y divide-slate-100">
              {data.conflicts.map((conflict, i) => (
                <li key={i} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="min-w-44 font-medium">{longDateLabel(conflict.date)}</span>
                  <span className="tabular text-slate-600">
                    {timeLabel(conflict.startLocal)} – {timeLabel(conflict.endLocal)}
                  </span>
                  <span className="text-slate-500">{conflict.location}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  )
}
