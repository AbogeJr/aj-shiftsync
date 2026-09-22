import Link from 'next/link'
import { Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { getSession } from '@/lib/auth'
import { auditTrail } from '@/lib/scheduling/audit'
import { listAccessibleLocations } from '@/lib/scheduling/schedule'

export const dynamic = 'force-dynamic'

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; location?: string }>
}) {
  await requireManagerPage()
  const session = await getSession()
  const params = await searchParams

  let entries, locations
  try {
    ;[entries, locations] = await Promise.all([
      auditTrail({ from: params.from, to: params.to, locationId: params.location }),
      listAccessibleLocations(),
    ])
  } catch (err) {
    handleAuthError(err)
  }

  const exportHref = `/audit/export?${new URLSearchParams(
    Object.entries(params).filter(([, v]) => v) as [string, string][],
  )}`

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Every schedule change: who, when, and what changed"
        action={
          session?.role === 'admin' && (
            <Link
              href={exportHref}
              prefetch={false}
              className="rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Export CSV
            </Link>
          )
        }
      />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <Card title="Filter">
          <form className="flex flex-wrap items-end gap-2" method="GET">
            <label className="text-xs text-slate-500">
              From
              <input
                type="date"
                name="from"
                defaultValue={params.from}
                className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular"
              />
            </label>
            <label className="text-xs text-slate-500">
              To
              <input
                type="date"
                name="to"
                defaultValue={params.to}
                className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular"
              />
            </label>
            <label className="text-xs text-slate-500">
              Location
              <select
                name="location"
                defaultValue={params.location ?? ''}
                className="mt-1 block rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm"
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
            >
              Apply
            </button>
          </form>
        </Card>

        <Card title={`${entries.length} entries`}>
          {entries.length === 0 ? (
            <EmptyState>Nothing recorded for that range.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="pb-2 font-semibold">When</th>
                    <th className="pb-2 font-semibold">Who</th>
                    <th className="pb-2 font-semibold">Action</th>
                    <th className="pb-2 font-semibold">Location</th>
                    <th className="pb-2 font-semibold">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100 align-top last:border-0">
                      <td className="py-2 tabular whitespace-nowrap text-slate-600">{entry.at}</td>
                      <td className="py-2 whitespace-nowrap">{entry.actor}</td>
                      <td className="py-2 whitespace-nowrap font-medium">{entry.action}</td>
                      <td className="py-2 whitespace-nowrap text-slate-500">
                        {entry.location ?? '—'}
                      </td>
                      <td className="py-2">
                        <code className="block max-w-md truncate text-xs text-slate-500">
                          {entry.after ?? entry.before ?? '—'}
                        </code>
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
