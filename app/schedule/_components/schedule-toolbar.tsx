'use client'

import { Chevron, Upload } from '@/components/icons'
import { addWeeks, weekRangeLabel } from '@/lib/format'
import type { ScheduleFilters } from '@/lib/scheduling/week-view'
import { FiltersPopover } from './filters-popover'

export function ScheduleToolbar({
  days,
  weekStart,
  today,
  skills,
  filters,
  unpublished,
  publishing,
  canEdit,
  view,
  onViewChange,
  onFiltersChange,
  onNavigate,
  onPublish,
}: {
  days: string[]
  weekStart: string
  today: string
  skills: string[]
  filters: ScheduleFilters
  unpublished: number
  publishing: boolean
  canEdit: boolean
  view: 'calendar' | 'list'
  onViewChange: (view: 'calendar' | 'list') => void
  onFiltersChange: (next: ScheduleFilters) => void
  onNavigate: (week: string) => void
  onPublish: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
      <button
        onClick={() => onNavigate(today)}
        className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
      >
        Today
      </button>
      <div className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium tabular">
        {weekRangeLabel(days)}
      </div>
      <button
        aria-label="Previous week"
        onClick={() => onNavigate(addWeeks(weekStart, -1))}
        className="rounded-lg border border-slate-300 px-2 py-1.5 hover:bg-slate-50"
      >
        <Chevron className="h-4 w-4 rotate-90" />
      </button>
      <button
        aria-label="Next week"
        onClick={() => onNavigate(addWeeks(weekStart, 1))}
        className="rounded-lg border border-slate-300 px-2 py-1.5 hover:bg-slate-50"
      >
        <Chevron className="h-4 w-4 -rotate-90" />
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div className="flex rounded-lg border border-slate-300 p-0.5" role="group" aria-label="View">
          {(['calendar', 'list'] as const).map((option) => (
            <button
              key={option}
              onClick={() => onViewChange(option)}
              aria-pressed={view === option}
              className={`rounded-md px-2.5 py-1 text-sm font-medium capitalize ${
                view === option ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        <FiltersPopover skills={skills} filters={filters} onChange={onFiltersChange} />
        {canEdit && (
        <button
          disabled={unpublished === 0 || publishing}
          onClick={onPublish}
          className="flex items-center gap-1.5 rounded-lg bg-brand-500 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Upload className="h-4 w-4" />
          {publishing ? 'Publishing…' : `Publish${unpublished > 0 ? ` (${unpublished})` : ''}`}
        </button>
        )}
      </div>
    </div>
  )
}
