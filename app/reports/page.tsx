import { Alert, Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { fairnessReport } from '@/lib/scheduling/insights'
import { hours as fmtHours } from '@/lib/format'
import { OVERTIME_HOURS } from '@/lib/scheduling/week-view'

export const dynamic = 'force-dynamic'

const OVERTIME_WARNING_AT = 35

export default async function ReportsPage() {
  const { weekStart } = await requireManagerPage()

  let rows
  try {
    rows = await fairnessReport(weekStart)
  } catch (err) {
    handleAuthError(err)
  }

  const atRisk = rows.filter((r) => r.hours >= OVERTIME_WARNING_AT)
  const premiumTotal = rows.reduce((n, r) => n + r.premiumShifts, 0)
  const scheduled = rows.filter((r) => r.hours > 0)
  const maxHours = Math.max(1, ...rows.map((r) => Math.max(r.hours, r.desired)))

  return (
    <>
      <PageHeader title="Reports" subtitle="Overtime exposure and shift fairness for this week" />

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
