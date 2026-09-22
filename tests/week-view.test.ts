import { describe, expect, it } from 'vitest'
import type { ScheduleShift, ScheduleStaff } from '@/lib/scheduling/schedule'
import {
  availableSkills,
  dayTotals,
  filterShifts,
  filterStaff,
  indexByStaffDay,
  openSlotsByDay,
  staffTotals,
  totalOpenSlots,
} from '@/lib/scheduling/week-view'
import { addWeeks, money, timeLabel, weekRangeLabel } from '@/lib/format'

// Pure functions over already-loaded rows: no database, no mocks, no browser.
const staff: ScheduleStaff[] = [
  { id: 'a', name: 'Ada', role: 'staff', hourlyRateCents: 2000, desiredWeeklyHours: 40, skills: ['server'] },
  { id: 'b', name: 'Ben', role: 'staff', hourlyRateCents: 3000, desiredWeeklyHours: 20, skills: ['host'] },
]

const shift = (over: Partial<ScheduleShift> & { id: string }): ScheduleShift => ({
  localDate: '2026-09-21',
  startLocal: '09:00',
  endLocal: '17:00',
  overnight: false,
  requiredSkill: 'server',
  headcount: 1,
  published: true,
  hours: 8,
  version: 1,
  assignedStaffIds: [],
  assignmentIds: {},
  ...over,
})

describe('week-view derivation', () => {
  it('indexes assignments by staff and local day', () => {
    const shifts = [
      shift({ id: '1', assignedStaffIds: ['a'] }),
      shift({ id: '2', localDate: '2026-09-22', assignedStaffIds: ['a', 'b'] }),
    ]
    const index = indexByStaffDay(shifts)
    expect(index.get('a|2026-09-21')?.map((s) => s.id)).toEqual(['1'])
    expect(index.get('a|2026-09-22')?.map((s) => s.id)).toEqual(['2'])
    expect(index.get('b|2026-09-21')).toBeUndefined()
  })

  it('counts open slots as headcount minus active assignments', () => {
    const shifts = [
      shift({ id: '1', headcount: 3, assignedStaffIds: ['a'] }),
      shift({ id: '2', headcount: 1, assignedStaffIds: ['b'] }),
    ]
    expect(openSlotsByDay(shifts).get('2026-09-21')).toHaveLength(1)
    expect(totalOpenSlots(shifts)).toEqual({ slots: 2, hours: 16 })
  })

  it('bills each assignee separately on a shared shift', () => {
    const shifts = [shift({ id: '1', headcount: 2, assignedStaffIds: ['a', 'b'] })]
    // 8h x $20 + 8h x $30
    expect(dayTotals(shifts, staff, '2026-09-21')).toEqual({ people: 2, hours: 16, cents: 400_00 })
    expect(staffTotals(shifts, staff, 'a').cents).toBe(160_00)
  })

  it('filters by skill and publish state independently', () => {
    const shifts = [
      shift({ id: '1', requiredSkill: 'server' }),
      shift({ id: '2', requiredSkill: 'host', published: false }),
    ]
    expect(filterShifts(shifts, { skills: ['host'], unpublishedOnly: false, search: '' })).toHaveLength(1)
    expect(filterShifts(shifts, { skills: [], unpublishedOnly: true, search: '' })).toHaveLength(1)
    expect(filterShifts(shifts, { skills: ['server'], unpublishedOnly: true, search: '' })).toHaveLength(0)
    expect(availableSkills(shifts)).toEqual(['host', 'server'])
  })

  it('searches staff case-insensitively', () => {
    expect(filterStaff(staff, 'ADA').map((s) => s.name)).toEqual(['Ada'])
    expect(filterStaff(staff, '  ')).toHaveLength(2)
  })
})

describe('formatting', () => {
  it('renders 12-hour labels, dropping :00', () => {
    expect(timeLabel('09:00')).toBe('9am')
    expect(timeLabel('17:30')).toBe('5:30pm')
    expect(timeLabel('00:00')).toBe('12am')
    expect(timeLabel('12:00')).toBe('12pm')
  })

  it('steps whole weeks without drifting across DST', () => {
    // 2026-11-01 is a US DST transition; date maths must not lose an hour.
    expect(addWeeks('2026-10-26', 1)).toBe('2026-11-02')
    expect(addWeeks('2026-09-21', -1)).toBe('2026-09-14')
  })

  it('formats money from integer cents', () => {
    expect(money(400_00)).toBe('$400.00')
    expect(money(0)).toBe('$0.00')
  })

  it('labels the week range from first and last day', () => {
    expect(weekRangeLabel(['2026-09-21', '2026-09-27'])).toBe('Sep 21, 2026 – Sep 27, 2026')
  })
})
