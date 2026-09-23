import Link from 'next/link'
import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { WeekNav } from '@/components/layout/week-nav'
import { onDutyNow } from '@/lib/scheduling/attendance'
import {
  attributeOvertime,
  locationWeekSummaries,
  overtimeProjection,
  teamOverview,
  weekAssignments,
  COVERAGE_HORIZON_HOURS,
} from '@/lib/scheduling/insights'
import { dropsNearingExpiry, requestsAwaitingApproval } from '@/lib/scheduling/swaps'
import { WEEKLY_OVERTIME_AT, WEEKLY_WARNING_AT } from '@/lib/scheduling/eligibility'
import { hours as fmtHours, longDateLabel, money, timeLabel, weekRangeLabel } from '@/lib/format'
import { RequestRow } from '../requests/_components/request-row'

export const dynamic = 'force-dynamic'

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { week } = await searchParams
  const { weekStart, thisWeek } = await requireManagerPage(week)

  let locations, team, awaitingApproval, assignments, expiring, duty
  try {
    // One round trip each, in parallel: the page is a roll-up, so it should not
    // pay for its three sources serially.
    ;[locations, team, awaitingApproval, assignments, expiring, duty] = await Promise.all([
      locationWeekSummaries(weekStart),
      teamOverview(weekStart),
      requestsAwaitingApproval(),
      weekAssignments(weekStart),
      dropsNearingExpiry(),
      onDutyNow(),
    ])
  } catch (err) {
    handleAuthError(err)
  }

  const onDuty = duty.reduce((n, l) => n + l.onDuty.length, 0)
  const notClockedIn = duty.reduce((n, l) => n + l.missing.length, 0)
  const draftLocations = locations.filter((l) => l.draftShifts > 0)

  const overtime = overtimeProjection(team)
  // Brief §4: not just who is in overtime, but which shift put them there.
  const culprits = new Map(attributeOvertime(assignments).map((c) => [c.staffId, c]))

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  const totals = locations.reduce(
    (acc, l) => ({
      openSlots: acc.openSlots + l.openSlots,
      openSoon: acc.openSoon + l.openSlotsSoon,
      hours: acc.hours + l.assignedHours,
      cents: acc.cents + l.labourCents,
      drafts: acc.drafts + l.draftShifts,
    }),
    { openSlots: 0, openSoon: 0, hours: 0, cents: 0, drafts: 0 },
  )

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`All locations · ${weekRangeLabel(days)}`}
        action={<WeekNav weekStart={weekStart} thisWeek={thisWeek} days={days} path="/overview" />}
      />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            label="On duty now"
            value={String(onDuty)}
            hint={notClockedIn > 0 ? `${notClockedIn} not clocked in` : 'nobody missing'}
            tone={notClockedIn > 0 ? 'warn' : undefined}
          />
          <Stat
            label="Unfilled slots"
            value={String(totals.openSlots)}
            hint={
              totals.openSoon > 0
                ? `${totals.openSoon} within ${COVERAGE_HORIZON_HOURS}h`
                : `none within ${COVERAGE_HORIZON_HOURS}h`
            }
            tone={totals.openSoon > 0 ? 'warn' : undefined}
          />
          <Stat label="Scheduled hours" value={fmtHours(totals.hours)} />
          <Stat label="Projected wages" value={money(totals.cents)} />
          <Stat
            label="Overtime premium"
            value={money(overtime.premiumCents)}
            hint={
              overtime.overtimeHours > 0
                ? `${fmtHours(overtime.overtimeHours)} hrs past ${WEEKLY_OVERTIME_AT}`
                : 'nobody past ' + WEEKLY_OVERTIME_AT
            }
            tone={overtime.premiumCents > 0 ? 'warn' : undefined}
          />
        </div>

        {(expiring.length > 0 || draftLocations.length > 0) && (
          <div className="space-y-2">
            {expiring.length > 0 && (
              <Alert tone="warning">
                <strong>{expiring.length}</strong> offered-up shift
                {expiring.length === 1 ? '' : 's'} will expire unclaimed, and stay with whoever
                offered {expiring.length === 1 ? 'it' : 'them'} up:{' '}
                {expiring
                  .slice(0, 2)
                  .map((r) => `${r.requestedByName} (${longDateLabel(r.shift.localDate)})`)
                  .join(', ')}
                {expiring.length > 2 && ` and ${expiring.length - 2} more`}.
              </Alert>
            )}
            {draftLocations.length > 0 && (
              <Alert tone="info">
                Not yet visible to staff:{' '}
                {draftLocations
                  .map((l) => `${l.name} (${l.draftShifts} draft${l.draftShifts === 1 ? '' : 's'})`)
                  .join(', ')}
                .{' '}
                <Link href="/schedule" className="font-medium text-brand-600 hover:underline">
                  Publish
                </Link>
              </Alert>
            )}
          </div>
        )}

        <Card
          title={`Needs your approval (${awaitingApproval.length})`}
          action={
            awaitingApproval.length > 0 && (
              <Link href="/requests" className="text-xs font-medium text-brand-600 hover:underline">
                Review all
              </Link>
            )
          }
        >
          {awaitingApproval.length === 0 ? (
            <EmptyState>Nothing waiting. Swaps and drops appear here once both staff agree.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {/* The three soonest; the rest are one click away rather than
                  turning the roll-up into a second requests page. */}
              {awaitingApproval.slice(0, 3).map((request) => (
                <RequestRow key={request.id} request={request} />
              ))}
            </ul>
          )}
        </Card>

        {overtime.atRisk.length > 0 && (
          <Card
            title="Overtime watch"
            action={
              <Link href="/reports" className="text-xs font-medium text-brand-600 hover:underline">
                Full report
              </Link>
            }
          >
            <p className="mb-3 text-xs text-slate-500">
              At {WEEKLY_WARNING_AT} hours or more this week, totalled across every location.
              Overtime starts at {WEEKLY_OVERTIME_AT}.
            </p>
            <ul className="space-y-2">
              {overtime.atRisk.slice(0, 5).map((person) => {
                const culprit = culprits.get(person.id)
                return (
                  <li key={person.id}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span>{person.name}</span>
                      <span className="flex items-center gap-2">
                        {person.overtimeHours > 0 && (
                          <Badge className="bg-rose-100 text-rose-700">
                            +{fmtHours(person.overtimeHours)} OT
                          </Badge>
                        )}
                        <span
                          className={`w-16 text-right tabular ${
                            person.overtimeHours > 0
                              ? 'font-semibold text-rose-600'
                              : 'text-amber-700'
                          }`}
                        >
                          {fmtHours(person.hours)} hrs
                        </span>
                      </span>
                    </div>
                    {culprit && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {longDateLabel(culprit.tipping.localDate)}{' '}
                        <span className="tabular">
                          {timeLabel(culprit.tipping.startLocal)}–
                          {timeLabel(culprit.tipping.endLocal)}
                        </span>{' '}
                        at {culprit.tipping.location} took them past {WEEKLY_OVERTIME_AT} (from{' '}
                        <span className="tabular">{fmtHours(culprit.hoursBefore)}</span>)
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        <Card title="By location">
          {locations.length === 0 ? (
            <EmptyState>No locations are assigned to this account.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="pb-2 font-semibold">Location</th>
                    <th className="pb-2 font-semibold">Shifts</th>
                    <th className="pb-2 font-semibold">Unfilled</th>
                    <th className="pb-2 font-semibold">Hours</th>
                    <th className="pb-2 font-semibold">Wages</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {locations.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2.5">
                        <Link
                          href={`/schedule?location=${l.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {l.name}
                        </Link>
                        <span className="block text-xs text-slate-500">{l.timezone}</span>
                      </td>
                      <td className="tabular">{l.shifts}</td>
                      <td className="tabular">
                        {l.openSlots > 0 ? (
                          <Badge className="bg-amber-100 text-amber-900">{l.openSlots} open</Badge>
                        ) : (
                          <span className="text-slate-400">covered</span>
                        )}
                      </td>
                      <td className="tabular">{fmtHours(l.assignedHours)}</td>
                      <td className="tabular">{money(l.labourCents)}</td>
                      <td>
                        {l.draftShifts > 0 ? (
                          <Badge className="bg-slate-100 text-slate-600">
                            {l.draftShifts} draft
                          </Badge>
                        ) : (
                          <Badge className="bg-green-100 text-green-800">published</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint?: string
  tone?: 'warn'
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular ${tone === 'warn' ? 'text-amber-700' : ''}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-slate-400 tabular">{hint}</p>}
    </div>
  )
}
