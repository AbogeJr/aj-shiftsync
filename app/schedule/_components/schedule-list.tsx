'use client'

import { Badge, EmptyState } from '@/components/ui/feedback'
import { skillStyle } from '@/components/ui/skill-style'
import { hours as fmtHours, longDateLabel, timeLabel } from '@/lib/format'
import type { ScheduleShift, ScheduleStaff } from '@/lib/scheduling/schedule'

/**
 * The same week as a chronological list.
 *
 * The grid answers "who is on when"; the list answers "what is happening next",
 * which is what a phone screen and a staff member actually want.
 */
export function ScheduleList({
  days,
  today,
  staff,
  shifts,
  canEdit,
  showLocation,
  onEditShift,
  onFindCoverage,
}: {
  days: string[]
  today: string
  staff: ScheduleStaff[]
  shifts: ScheduleShift[]
  canEdit: boolean
  showLocation?: boolean
  onEditShift: (shift: ScheduleShift) => void
  onFindCoverage: (shift: ScheduleShift) => void
}) {
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.name ?? 'Unknown'

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-4">
        {days.map((day) => {
          const onDay = shifts.filter((s) => s.localDate === day)
          if (onDay.length === 0) return null
          return (
            <section key={day}>
              <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
                {longDateLabel(day)}
                {day === today && (
                  <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">
                    today
                  </span>
                )}
              </h2>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
                {onDay.map((shift) => {
                  const open = shift.headcount - shift.assignedStaffIds.length
                  return (
                    <li key={shift.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <span className="w-32 shrink-0 text-sm font-semibold tabular">
                        {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                        {shift.overnight && <span className="text-slate-400"> +1</span>}
                      </span>
                      {showLocation && (
                        <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-600">
                          {shift.locationName}
                        </span>
                      )}
                      {shift.requiredSkill && (
                        <span className={`rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}>
                          {shift.requiredSkill}
                        </span>
                      )}
                      <span className="min-w-40 flex-1 text-sm text-slate-600">
                        {shift.assignedStaffIds.length > 0
                          ? shift.assignedStaffIds.map(nameOf).join(', ')
                          : <span className="text-slate-400">nobody assigned</span>}
                      </span>
                      <span className="text-xs tabular text-slate-500">{fmtHours(shift.hours)}h</span>
                      {!shift.published && <Badge>draft</Badge>}
                      {open > 0 && (
                        canEdit ? (
                          <button
                            onClick={() => onFindCoverage(shift)}
                            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 hover:bg-amber-200"
                          >
                            {open} open — find cover
                          </button>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-900">{open} open</Badge>
                        )
                      )}
                      {canEdit && (
                        <button
                          onClick={() => onEditShift(shift)}
                          className="text-xs font-medium text-brand-600 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        {shifts.length === 0 && <EmptyState>No shifts this week.</EmptyState>}
      </div>
    </div>
  )
}
