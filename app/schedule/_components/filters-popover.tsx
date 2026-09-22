'use client'

import * as Popover from '@radix-ui/react-popover'
import { Chevron, Filter } from '@/components/icons'
import { skillStyle } from '@/components/ui/skill-style'
import { countActiveFilters, NO_FILTERS, type ScheduleFilters } from '@/lib/scheduling/week-view'

export function FiltersPopover({
  skills,
  filters,
  onChange,
}: {
  skills: string[]
  filters: ScheduleFilters
  onChange: (next: ScheduleFilters) => void
}) {
  const active = countActiveFilters(filters)

  return (
    <Popover.Root>
      <Popover.Trigger className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-50">
        <Filter className="h-4 w-4" />
        Filters{active > 0 ? ` (${active})` : ''}
        <Chevron className="h-4 w-4 text-slate-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Required skill
          </p>
          <div className="space-y-1">
            {skills.map((skill) => (
              <label key={skill} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.skills.includes(skill)}
                  onChange={(e) =>
                    onChange({
                      ...filters,
                      skills: e.target.checked
                        ? [...filters.skills, skill]
                        : filters.skills.filter((s) => s !== skill),
                    })
                  }
                />
                <span className={`rounded border px-1.5 text-xs ${skillStyle(skill)}`}>{skill}</span>
              </label>
            ))}
          </div>

          <p className="mt-3 mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Status
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={filters.unpublishedOnly}
              onChange={(e) => onChange({ ...filters, unpublishedOnly: e.target.checked })}
            />
            Unpublished only
          </label>

          {active > 0 && (
            <button
              onClick={() => onChange({ ...NO_FILTERS, search: filters.search })}
              className="mt-3 w-full rounded-md border border-slate-300 py-1.5 text-sm hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
