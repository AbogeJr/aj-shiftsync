import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { teamOverview } from '@/lib/scheduling/insights'
import { hours as fmtHours, money } from '@/lib/format'
import { skillStyle } from '@/components/ui/skill-style'
import { OVERTIME_HOURS } from '@/lib/scheduling/week-view'

export const dynamic = 'force-dynamic'

export default async function TeamPage() {
  const { weekStart } = await requireManagerPage()

  let team
  try {
    team = await teamOverview(weekStart)
  } catch (err) {
    handleAuthError(err)
  }

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Hours are totals across every location, not just the one you are viewing"
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Card title={`${team.length} people`}>
          {team.length === 0 ? (
            <EmptyState>Nobody is certified at your locations yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {team.map((member) => {
                const over = member.hoursThisWeek > OVERTIME_HOURS
                const multiLocation = member.byLocation.length > 1
                return (
                  <li key={member.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 py-3 sm:flex sm:flex-wrap sm:items-start">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                      {member.name[0]}
                    </div>

                    <div className="min-w-48 sm:flex-1">
                      <p className="text-sm font-medium">
                        {member.name}{' '}
                        <span className="text-xs font-normal text-slate-500">{member.role}</span>
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {member.skills.map((skill) => (
                          <span
                            key={skill}
                            className={`rounded border px-1.5 text-xs ${skillStyle(skill)}`}
                          >
                            {skill}
                          </span>
                        ))}
                        {member.skills.length === 0 && (
                          <span className="text-xs text-slate-400">no skills on file</span>
                        )}
                      </div>
                    </div>

                    <div className="col-start-2 min-w-40">
                      <p className="text-xs text-slate-500">Certified at</p>
                      <p className="text-sm">{member.locations.join(', ') || '—'}</p>
                    </div>

                    <div className="col-start-2 min-w-44">
                      <p className="text-xs text-slate-500">This week</p>
                      <p className="text-sm tabular">
                        <span className={over ? 'font-semibold text-rose-600' : ''}>
                          {fmtHours(member.hoursThisWeek)}
                        </span>{' '}
                        <span className="text-slate-400">/ {member.desiredWeeklyHours} desired</span>
                        {over && <Badge className="ml-1.5 bg-rose-100 text-rose-700">overtime</Badge>}
                      </p>
                      {multiLocation && (
                        <p className="mt-0.5 text-xs text-amber-700">
                          split:{' '}
                          {member.byLocation
                            .map((b) => `${b.location} ${fmtHours(b.hours)}`)
                            .join(' · ')}
                        </p>
                      )}
                    </div>

                    <div className="col-start-2 min-w-20 sm:text-right">
                      <p className="text-xs text-slate-500">Rate</p>
                      <p className="text-sm tabular">
                        {member.hourlyRateCents === null ? '—' : money(member.hourlyRateCents)}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
