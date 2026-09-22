import Link from 'next/link'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { locationWeekSummaries } from '@/lib/scheduling/insights'
import { hours as fmtHours, money, weekRangeLabel } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function OverviewPage() {
  const { weekStart } = await requireManagerPage()

  let locations
  try {
    locations = await locationWeekSummaries(weekStart)
  } catch (err) {
    handleAuthError(err)
  }

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })

  const totals = locations.reduce(
    (acc, l) => ({
      openSlots: acc.openSlots + l.openSlots,
      hours: acc.hours + l.assignedHours,
      cents: acc.cents + l.labourCents,
      drafts: acc.drafts + l.draftShifts,
    }),
    { openSlots: 0, hours: 0, cents: 0, drafts: 0 },
  )

  return (
    <>
      <PageHeader title="Overview" subtitle={`All locations · ${weekRangeLabel(days)}`} />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Locations" value={String(locations.length)} />
          <Stat
            label="Unfilled slots"
            value={String(totals.openSlots)}
            tone={totals.openSlots > 0 ? 'warn' : undefined}
          />
          <Stat label="Scheduled hours" value={fmtHours(totals.hours)} />
          <Stat label="Projected wages" value={money(totals.cents)} />
        </div>

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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular ${tone === 'warn' ? 'text-amber-700' : ''}`}>
        {value}
      </p>
    </div>
  )
}
