'use client'

import { useState } from 'react'
import { Badge, Card, EmptyState } from '@/components/ui/feedback'
import { hours as fmtHours, longDateLabel, timeLabel, weekdayLabel } from '@/lib/format'
import { skillStyle } from '@/components/ui/skill-style'
import { groupByLocalDate } from '@/lib/scheduling/week-view'
import type { MyShift, MyWeek, OpenShift } from '@/lib/scheduling/staff-view'
import { ClaimButton } from './claim-button'
import { ClockButton } from './clock-button'
import { OfferUp } from './offer-up'

/**
 * Owns the calendar/list choice for a staff member's own week. The shift cards
 * are shared by both views, so the two can never drift apart on what a shift
 * says - only on how the week is laid out around them.
 */
export function MyWeekView({
  week,
  offers,
  days,
  today,
}: {
  week: MyWeek
  offers: OpenShift[]
  days: string[]
  today: string
}) {
  const [view, setView] = useState<'calendar' | 'list'>('calendar')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 sm:px-6">
        <p className="text-sm text-slate-500">
          {week.shifts.length} shift{week.shifts.length === 1 ? '' : 's'}
          {offers.length > 0 && ` · ${offers.length} to pick up`}
        </p>
        <div
          className="ml-auto flex rounded-lg border border-slate-300 p-0.5"
          role="group"
          aria-label="View"
        >
          {(['calendar', 'list'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`rounded-md px-2.5 py-1 text-sm font-medium capitalize ${
                view === option ? 'bg-brand-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {view === 'calendar' ? (
        <WeekCalendar week={week} offers={offers} days={days} today={today} />
      ) : (
        <WeekList week={week} offers={offers} />
      )}
    </div>
  )
}

/** Seven day columns, mirroring the manager grid so both read the same way. */
function WeekCalendar({
  week,
  offers,
  days,
  today,
}: {
  week: MyWeek
  offers: OpenShift[]
  days: string[]
  today: string
}) {
  const mine = groupByLocalDate(week.shifts, days)
  const open = groupByLocalDate(offers, days)

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="min-w-[56rem] overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const { weekday, day: dayNum } = weekdayLabel(day)
            const isToday = day === today
            return (
              <div
                key={day}
                className={`border-r border-b border-slate-200 px-3 py-2 text-center last:border-r-0 ${
                  isToday ? 'bg-brand-50' : ''
                }`}
              >
                <span className="block text-xs text-slate-500 uppercase">{weekday}</span>
                <span
                  className={`text-sm font-semibold tabular ${isToday ? 'text-brand-600' : ''}`}
                >
                  {dayNum}
                </span>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-7">
          {days.map((day) => {
            const shifts = mine.get(day) ?? []
            const pickups = open.get(day) ?? []
            return (
              <div
                key={day}
                className={`min-h-36 space-y-1.5 border-r border-slate-200 p-1.5 last:border-r-0 ${
                  day === today ? 'bg-brand-50/40' : ''
                }`}
              >
                {shifts.map((shift) => (
                  <MyShiftCard key={shift.assignmentId} shift={shift} />
                ))}
                {pickups.map((shift) => (
                  <OpenShiftCard key={shift.id} shift={shift} />
                ))}
                {shifts.length === 0 && pickups.length === 0 && (
                  <p className="pt-2 text-center text-xs text-slate-300">—</p>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** One of your shifts, inside a day column. */
function MyShiftCard({ shift }: { shift: MyShift }) {
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 p-2">
      <p className="text-xs font-semibold tabular text-brand-800">
        {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
        {shift.overnight && <span className="text-brand-400"> +1</span>}
      </p>
      <p className="truncate text-xs text-slate-500" title={shift.location}>
        {shift.location} · {fmtHours(shift.hours)}h
      </p>
      {shift.requiredSkill && (
        <span
          className={`mt-1 inline-block rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}
        >
          {shift.requiredSkill}
        </span>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <ClockButton
          assignmentId={shift.assignmentId}
          clockedIn={shift.clockedIn}
          clockedOut={shift.clockedOut}
          startsSoonOrStarted={shift.clockable}
        />
        <OfferUp assignmentId={shift.assignmentId} pendingRequest={shift.pendingRequest} />
      </div>
    </div>
  )
}

/** A shift you could pick up. Dashed, so it reads as not-yours at a glance. */
function OpenShiftCard({ shift }: { shift: OpenShift }) {
  return (
    <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2">
      <p className="text-xs font-semibold tabular text-amber-900">
        {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
      </p>
      <p className="truncate text-xs text-amber-700" title={shift.location}>
        {shift.location} · {shift.openSlots} open
      </p>
      {shift.requiredSkill && (
        <span
          className={`mt-1 inline-block rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}
        >
          {shift.requiredSkill}
        </span>
      )}
      <div className="mt-1.5">
        <ClaimButton shiftId={shift.id} />
      </div>
    </div>
  )
}

/** The original two-card layout, unchanged in substance. */
function WeekList({ week, offers }: { week: MyWeek; offers: OpenShift[] }) {
  return (
    <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
      <Card title="This week">
        {week.shifts.length === 0 ? (
          <EmptyState>
            Nothing scheduled. Only published shifts appear here — your manager may still be
            building the schedule.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {week.shifts.map((shift) => (
              <li key={shift.assignmentId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-medium">{longDateLabel(shift.localDate)}</p>
                  <p className="text-xs text-slate-500">
                    {shift.location} · {shift.timezone.replace('_', ' ')}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular">
                  {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                  {shift.overnight && <span className="text-slate-400"> +1</span>}
                </p>
                {shift.requiredSkill && (
                  <span
                    className={`rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}
                  >
                    {shift.requiredSkill}
                  </span>
                )}
                <span className="w-14 text-right text-xs tabular text-slate-500">
                  {fmtHours(shift.hours)}h
                </span>
                <ClockButton
                  assignmentId={shift.assignmentId}
                  clockedIn={shift.clockedIn}
                  clockedOut={shift.clockedOut}
                  startsSoonOrStarted={shift.clockable}
                />
                <OfferUp assignmentId={shift.assignmentId} pendingRequest={shift.pendingRequest} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Shifts you can pick up">
        <p className="mb-3 text-xs text-slate-500">
          Published shifts with room, at locations you are certified for, that need a skill you have
          and fall inside your availability.
        </p>
        {offers.length === 0 ? (
          <EmptyState>Nothing available to pick up right now.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {offers.map((shift) => (
              <li key={shift.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-40 flex-1">
                  <p className="text-sm font-medium">{longDateLabel(shift.localDate)}</p>
                  <p className="text-xs text-slate-500">{shift.location}</p>
                </div>
                <p className="text-sm font-semibold tabular">
                  {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                </p>
                {shift.requiredSkill && (
                  <span
                    className={`rounded border px-1.5 text-xs ${skillStyle(shift.requiredSkill)}`}
                  >
                    {shift.requiredSkill}
                  </span>
                )}
                <Badge className="bg-amber-100 text-amber-900">{shift.openSlots} open</Badge>
                <ClaimButton shiftId={shift.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
