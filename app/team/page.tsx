import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { WeekNav } from '@/components/layout/week-nav'
import { teamOverview } from '@/lib/scheduling/insights'
import { hours as fmtHours, money } from '@/lib/format'
import { skillStyle } from '@/components/ui/skill-style'
import { OVERTIME_HOURS } from '@/lib/scheduling/week-view'

export const dynamic = 'force-dynamic'

export default async function TeamPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { week } = await searchParams
  const { weekStart, thisWeek } = await requireManagerPage(week)

  let team
  try {
    team = await teamOverview(weekStart)
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
        title="Team"
        subtitle="Hours are totals across every location, not just the one you are viewing"
        action={<WeekNav weekStart={weekStart} thisWeek={thisWeek} days={days} path="/team" />}
      />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Card title={`${team.length} people`}>
          {team.length === 0 ? (
            <EmptyState>Nobody is certified at your locations yet.</EmptyState>
          ) : (
            // Scrolls sideways on narrow screens rather than collapsing: the same
            // treatment the audit table gets, so the two read alike.
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="pb-2 font-semibold">Person</th>
                    <th className="pb-2 font-semibold">Skills</th>
                    <th className="pb-2 font-semibold">Certified at</th>
                    <th className="pb-2 font-semibold">Hours</th>
                    <th className="pb-2 text-right font-semibold">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {team.map((member) => {
                    const over = member.hoursThisWeek > OVERTIME_HOURS
                    const multiLocation = member.byLocation.length > 1
                    return (
                      <tr
                        key={member.id}
                        className="border-b border-slate-100 align-top last:border-0"
                      >
                        <td className="py-2.5 pr-3">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                              {member.name[0]}
                            </span>
                            <span className="min-w-0">
                              <span className="block font-medium whitespace-nowrap">
                                {member.name}
                              </span>
                              <span className="block text-xs text-slate-500">{member.role}</span>
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 pr-3">
                          <div className="flex flex-wrap gap-1">
                            {member.skills.map((skill) => (
                              <span
                                key={skill}
                                className={`rounded border px-1.5 text-xs ${skillStyle(skill)}`}
                              >
                                {skill}
                              </span>
                            ))}
                            {member.skills.length === 0 && (
                              <span className="text-xs text-slate-400">none on file</span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 pr-3 text-slate-600">
                          {member.locations.join(', ') || '—'}
                        </td>

                        <td className="py-2.5 pr-3 whitespace-nowrap">
                          <span className={`tabular ${over ? 'font-semibold text-rose-600' : ''}`}>
                            {fmtHours(member.hoursThisWeek)}
                          </span>{' '}
                          <span className="tabular text-slate-400">
                            / {member.desiredWeeklyHours} desired
                          </span>
                          {over && (
                            <Badge className="ml-1.5 bg-rose-100 text-rose-700">overtime</Badge>
                          )}
                          {multiLocation && (
                            <span className="mt-0.5 block text-xs tabular text-amber-700">
                              split:{' '}
                              {member.byLocation
                                .map((b) => `${b.location} ${fmtHours(b.hours)}`)
                                .join(' · ')}
                            </span>
                          )}
                        </td>

                        <td className="py-2.5 text-right tabular whitespace-nowrap">
                          {member.hourlyRateCents === null ? '—' : money(member.hourlyRateCents)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
