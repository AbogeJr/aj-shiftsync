import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { WeekNav } from '@/components/layout/week-nav'
import { fairnessReport, premiumFairness } from '@/lib/scheduling/insights'
import { hours as fmtHours } from '@/lib/format'
import { OVERTIME_HOURS } from '@/lib/scheduling/week-view'
import { WEEKLY_WARNING_AT as OVERTIME_WARNING_AT } from '@/lib/scheduling/eligibility'

export const dynamic = 'force-dynamic'


export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>
}) {
  const { week } = await searchParams
  const { weekStart, thisWeek } = await requireManagerPage(week)

  let rows
  try {
    rows = await fairnessReport(weekStart)
  } catch (err) {
    handleAuthError(err)
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  const fairness = premiumFairness(rows)
  const atRisk = rows.filter((r) => r.hours >= OVERTIME_WARNING_AT)
  const premiumTotal = rows.reduce((n, r) => n + r.premiumShifts, 0)
  const scheduled = rows.filter((r) => r.hours > 0)
  const maxHours = Math.max(1, ...rows.map((r) => Math.max(r.hours, r.desired)))

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Overtime exposure and shift fairness"
        action={<WeekNav weekStart={weekStart} thisWeek={thisWeek} days={days} path="/reports" />}
      />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <Card title="Overtime watch">
          {atRisk.length === 0 ? (
            <EmptyState>Nobody is at {OVERTIME_WARNING_AT} hours or more.</EmptyState>
          ) : (
            <>
              <Alert tone="warning">
                {atRisk.length} {atRisk.length === 1 ? 'person is' : 'people are'} at or past{' '}
                {OVERTIME_WARNING_AT} hours. Overtime starts at {OVERTIME_HOURS}.
              </Alert>
              <ul className="mt-3 space-y-2">
                {atRisk.map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span>{r.name}</span>
                    <span
                      className={`tabular ${r.hours > OVERTIME_HOURS ? 'font-semibold text-rose-600' : 'text-amber-700'}`}
                    >
                      {fmtHours(r.hours)} hrs
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>

        <Card title="Hours against stated preference">
          {scheduled.length === 0 ? (
            <EmptyState>Nothing scheduled this week.</EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r) => {
                const shortfall = r.desired - r.hours
                return (
                  <li key={r.id}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{r.name}</span>
                      <span className="text-xs tabular text-slate-500">
                        {fmtHours(r.hours)} / {r.desired} desired
                        {shortfall > 1 && (
                          <span className="ml-1 text-amber-700">
                            {fmtHours(shortfall)} under
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full ${
                          r.hours > OVERTIME_HOURS ? 'bg-rose-500' : 'bg-brand-500'
                        }`}
                        style={{ width: `${Math.min(100, (r.hours / maxHours) * 100)}%` }}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card title="Premium shifts">
          <p className="mb-3 text-xs text-slate-500">
            Friday and Saturday evenings from 17:00, in each location&apos;s own timezone. Derived
            from shift times rather than stored, so it cannot drift.
          </p>

          {fairness.totalPremium > 0 && (
            <div className="mb-4 rounded-lg bg-slate-50 p-3">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular">{fairness.score}</span>
                <span className="text-xs text-slate-500">/ 100 fairness score</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${
                    fairness.score >= 85
                      ? 'bg-green-500'
                      : fairness.score >= 70
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                  }`}
                  style={{ width: `${fairness.score}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {fairness.misallocated < 0.5 ? (
                  <>Premium shifts match everyone&apos;s share of the hours worked.</>
                ) : (
                  <>
                    <strong className="tabular">{fairness.misallocated.toFixed(1)}</strong> of{' '}
                    {fairness.totalPremium} premium shifts would have to change hands to match each
                    person&apos;s share of the hours worked.
                  </>
                )}
              </p>
              {fairness.rows[0] && fairness.rows[0].delta < -0.5 && (
                <p className="mt-1 text-xs text-amber-700">
                  Least served: {fairness.rows[0].name} — {fairness.rows[0].premium} against{' '}
                  {fairness.rows[0].expected.toFixed(1)} expected for their hours.
                </p>
              )}
            </div>
          )}
          {premiumTotal === 0 ? (
            <EmptyState>No premium shifts assigned this week.</EmptyState>
          ) : (
            <ul className="space-y-1.5">
              {rows
                .filter((r) => r.premiumShifts > 0 || r.hours > 0)
                .map((r) => (
                  <li key={r.id} className="flex items-center justify-between text-sm">
                    <span>{r.name}</span>
                    {r.premiumShifts > 0 ? (
                      <Badge className="bg-brand-100 text-brand-700">
                        {r.premiumShifts} premium
                      </Badge>
                    ) : (
                      <span className="text-xs text-slate-400">none</span>
                    )}
                  </li>
                ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
