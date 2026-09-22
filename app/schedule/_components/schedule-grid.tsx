'use client'

import { Search } from '@/components/icons'
import { hours as fmtHours, money, weekdayLabel } from '@/lib/format'
import type { ScheduleShift, ScheduleStaff } from '@/lib/scheduling/schedule'
import {
  dayTotals,
  indexByStaffDay,
  openSlotsByDay,
  OVERTIME_HOURS,
  staffTotals,
  totalOpenSlots,
  weekTotals,
} from '@/lib/scheduling/week-view'
import { OpenShiftBlock, ShiftBlock } from './shift-block'

/** First column is fixed; the seven days share what is left. */
const GRID_COLUMNS = { gridTemplateColumns: '17rem repeat(7, minmax(9rem, 1fr))' }

export function ScheduleGrid({
  days,
  today,
  staff,
  shifts,
  search,
  onSearchChange,
  onAddShift,
  onFindCoverage,
  onEditShift,
  onUnassign,
  onCreateOpenShift,
}: {
  days: string[]
  today: string
  staff: ScheduleStaff[]
  shifts: ScheduleShift[]
  search: string
  onSearchChange: (value: string) => void
  onAddShift: (member: ScheduleStaff, day: string) => void
  onFindCoverage: (shift: ScheduleShift) => void
  onEditShift: (shift: ScheduleShift) => void
  onUnassign: (assignmentId: string) => void
  onCreateOpenShift: (day: string) => void
}) {
  const byStaffDay = indexByStaffDay(shifts)
  const openByDay = openSlotsByDay(shifts)
  const open = totalOpenSlots(shifts)
  const week = weekTotals(shifts, staff, days)

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-[68rem]">
        <div className="sticky top-0 z-20 grid border-b border-slate-200 bg-white" style={GRID_COLUMNS}>
          <div className="flex items-center gap-2 border-r border-slate-200 px-3 py-2.5">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search team"
              aria-label="Search team"
              className="w-full text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          {days.map((day) => {
            const { weekday, day: dayNum } = weekdayLabel(day)
            return (
              <div key={day} className="border-r border-slate-200 px-3 py-2.5 text-center last:border-r-0">
                <span
                  className={`text-sm font-semibold ${
                    day === today
                      ? 'rounded-full bg-brand-100 px-3 py-0.5 text-brand-700'
                      : 'text-slate-700'
                  }`}
                >
                  {weekday}, {dayNum}
                </span>
              </div>
            )
          })}
        </div>

        <div className="grid border-b border-slate-200 bg-white" style={GRID_COLUMNS}>
          <div className="border-r border-slate-200 px-3 py-2.5">
            <div className="text-sm font-medium">Open shifts ({open.slots})</div>
            <div className="text-xs text-slate-500 tabular">{fmtHours(open.hours)} Hrs</div>
          </div>
          {days.map((day) => (
            <div
              key={day}
              className="group/open relative space-y-1 border-r border-slate-200 p-1.5 last:border-r-0"
            >
              <button
                onClick={() => onCreateOpenShift(day)}
                aria-label={`Add a shift on ${day}`}
                title="Add a shift"
                className="absolute top-1 right-1 hidden h-5 w-5 items-center justify-center rounded text-slate-400 group-hover/open:flex hover:bg-slate-100"
              >
                +
              </button>
              {(openByDay.get(day) ?? []).map(({ shift, open: slots }) => (
                <OpenShiftBlock
                  key={shift.id}
                  shift={shift}
                  open={slots}
                  onClick={() => onFindCoverage(shift)}
                />
              ))}
            </div>
          ))}
        </div>

        <div className="bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600">
          Team members ({staff.length})
        </div>

        {staff.map((member) => {
          const totals = staffTotals(shifts, staff, member.id)
          const overtime = totals.hours > OVERTIME_HOURS
          return (
            <div key={member.id} className="group grid border-b border-slate-200 bg-white" style={GRID_COLUMNS}>
              <div className="flex items-center gap-2.5 border-r border-slate-200 px-3 py-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                  {member.name[0]}
                </div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{member.name}</div>
                  <div className="text-xs text-slate-500 tabular">
                    <span className={overtime ? 'font-semibold text-rose-600' : ''}>
                      {fmtHours(totals.hours)} hrs
                    </span>{' '}
                    / {money(totals.cents)}
                    {overtime && <span className="ml-1 font-medium text-rose-600">overtime</span>}
                  </div>
                </div>
              </div>
              {days.map((day) => {
                const cellShifts = byStaffDay.get(`${member.id}|${day}`) ?? []
                return (
                  <div
                    key={day}
                    className="relative min-h-16 space-y-1 border-r border-slate-200 p-1.5 last:border-r-0"
                  >
                    {cellShifts.map((shift) => (
                      <ShiftBlock
                        key={shift.id}
                        shift={shift}
                        onEdit={() => onEditShift(shift)}
                        onUnassign={() => onUnassign(shift.assignmentIds[member.id])}
                      />
                    ))}
                    {cellShifts.length === 0 && (
                      <button
                        onClick={() => onAddShift(member, day)}
                        aria-label={`Assign ${member.name} on ${day}`}
                        className="absolute inset-1.5 hidden items-center justify-center rounded-md text-lg text-slate-400 group-hover:flex hover:bg-slate-100"
                      >
                        +
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })}

        <div className="sticky bottom-0 grid border-t-2 border-slate-300 bg-white" style={GRID_COLUMNS}>
          <div className="border-r border-slate-200 px-3 py-2.5 text-xs">
            <div className="flex justify-between">
              <span className="text-slate-500">Wages</span>
              <span className="font-semibold tabular">{money(week.cents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Hours</span>
              <span className="font-semibold tabular">{fmtHours(week.hours)}</span>
            </div>
          </div>
          {days.map((day) => {
            const totals = dayTotals(shifts, staff, day)
            return (
              <div key={day} className="border-r border-slate-200 px-3 py-2.5 text-xs last:border-r-0">
                <div className="flex justify-between">
                  <span className="text-slate-500 tabular">{totals.people}</span>
                  <span className="font-semibold tabular">{money(totals.cents)}</span>
                </div>
                <div className="text-right font-semibold tabular">{fmtHours(totals.hours)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
