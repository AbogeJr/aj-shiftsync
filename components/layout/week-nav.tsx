import Link from 'next/link'
import { Chevron } from '@/components/icons'
import { addWeeks, weekRangeLabel } from '@/lib/format'

/**
 * Week navigation for the roll-up pages.
 *
 * Links rather than buttons, so these pages stay server components and a week
 * is shareable and back-button-able. The schedule has its own control because
 * it also carries a location in the URL.
 */
export function WeekNav({
  weekStart,
  thisWeek,
  days,
  path,
}: {
  weekStart: string
  thisWeek: string
  days: string[]
  path: string
}) {
  const link = 'rounded-lg border border-slate-300 px-2 py-1.5 hover:bg-slate-50'
  return (
    <div className="flex items-center gap-2">
      {weekStart !== thisWeek && (
        <Link href={path} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
          Today
        </Link>
      )}
      <Link href={`${path}?week=${addWeeks(weekStart, -1)}`} aria-label="Previous week" className={link}>
        <Chevron className="h-4 w-4 rotate-90" />
      </Link>
      <span className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium tabular">
        {weekRangeLabel(days)}
      </span>
      <Link href={`${path}?week=${addWeeks(weekStart, 1)}`} aria-label="Next week" className={link}>
        <Chevron className="h-4 w-4 -rotate-90" />
      </Link>
    </div>
  )
}
