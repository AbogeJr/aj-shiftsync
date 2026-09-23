import type { ScheduleShift, ScheduleStaff } from './schedule'

/**
 * Derivation for the week grid. Pure functions over rows that are already
 * loaded, so the grid's arithmetic is testable without a database or a browser.
 */

/**
 * The sentinel the switcher and the `?location=` param use for "every location
 * I can see". Not a real id, so it can never collide with one.
 *
 * It lives here rather than in schedule.ts because client components need it,
 * and schedule.ts reaches the session through next/headers - importing a value
 * from there into a client bundle breaks the build.
 */
export const ALL_LOCATIONS = 'all'

export interface ScheduleFilters {
  skills: string[]
  unpublishedOnly: boolean
  search: string
}

export const NO_FILTERS: ScheduleFilters = { skills: [], unpublishedOnly: false, search: '' }

export function countActiveFilters(filters: ScheduleFilters): number {
  return filters.skills.length + (filters.unpublishedOnly ? 1 : 0)
}

export function filterShifts(
  shifts: ScheduleShift[],
  filters: ScheduleFilters,
): ScheduleShift[] {
  return shifts.filter(
    (shift) =>
      (filters.skills.length === 0 ||
        (shift.requiredSkill !== null && filters.skills.includes(shift.requiredSkill))) &&
      (!filters.unpublishedOnly || !shift.published),
  )
}

export function filterStaff(staff: ScheduleStaff[], search: string): ScheduleStaff[] {
  const needle = search.trim().toLowerCase()
  if (!needle) return staff
  return staff.filter((member) => member.name.toLowerCase().includes(needle))
}

export function availableSkills(shifts: ScheduleShift[]): string[] {
  return [...new Set(shifts.map((s) => s.requiredSkill).filter((s): s is string => s !== null))].sort()
}

/** Key is `${staffId}|${localDate}`. */
export function indexByStaffDay(shifts: ScheduleShift[]): Map<string, ScheduleShift[]> {
  const index = new Map<string, ScheduleShift[]>()
  for (const shift of shifts) {
    for (const staffId of shift.assignedStaffIds) {
      const key = `${staffId}|${shift.localDate}`
      index.set(key, [...(index.get(key) ?? []), shift])
    }
  }
  return index
}

export interface OpenSlot {
  shift: ScheduleShift
  open: number
}

export function openSlotsByDay(shifts: ScheduleShift[]): Map<string, OpenSlot[]> {
  const index = new Map<string, OpenSlot[]>()
  for (const shift of shifts) {
    const open = shift.headcount - shift.assignedStaffIds.length
    if (open <= 0) continue
    index.set(shift.localDate, [...(index.get(shift.localDate) ?? []), { shift, open }])
  }
  return index
}

export function totalOpenSlots(shifts: ScheduleShift[]): { slots: number; hours: number } {
  let slots = 0
  let hours = 0
  for (const shift of shifts) {
    const open = Math.max(0, shift.headcount - shift.assignedStaffIds.length)
    slots += open
    hours += open * shift.hours
  }
  return { slots, hours }
}

export interface Totals {
  people: number
  hours: number
  cents: number
}

function rateOf(staff: ScheduleStaff[], staffId: string): number {
  return staff.find((member) => member.id === staffId)?.hourlyRateCents ?? 0
}

export function staffTotals(
  shifts: ScheduleShift[],
  staff: ScheduleStaff[],
  staffId: string,
): Totals {
  const assigned = shifts.filter((shift) => shift.assignedStaffIds.includes(staffId))
  const hours = assigned.reduce((total, shift) => total + shift.hours, 0)
  return { people: assigned.length > 0 ? 1 : 0, hours, cents: Math.round(hours * rateOf(staff, staffId)) }
}

export function dayTotals(
  shifts: ScheduleShift[],
  staff: ScheduleStaff[],
  day: string,
): Totals {
  const onDay = shifts.filter((shift) => shift.localDate === day)
  const people = new Set(onDay.flatMap((shift) => shift.assignedStaffIds))
  let hours = 0
  let cents = 0
  for (const shift of onDay) {
    for (const staffId of shift.assignedStaffIds) {
      hours += shift.hours
      cents += Math.round(shift.hours * rateOf(staff, staffId))
    }
  }
  return { people: people.size, hours, cents }
}

export function weekTotals(
  shifts: ScheduleShift[],
  staff: ScheduleStaff[],
  days: string[],
): Totals {
  return days.reduce<Totals>(
    (acc, day) => {
      const t = dayTotals(shifts, staff, day)
      return { people: acc.people + t.people, hours: acc.hours + t.hours, cents: acc.cents + t.cents }
    },
    { people: 0, hours: 0, cents: 0 },
  )
}

/** Above this, the row is flagged as heading into overtime. */
export const OVERTIME_HOURS = 40

/**
 * Bucket a staff member's own items into the seven day columns.
 *
 * Grouping is on the shift's local date rather than its instant, so an
 * overnight shift stays in the column of the day it starts - the day the person
 * actually turns up. Every day is seeded so empty columns still render.
 */
export function groupByLocalDate<T extends { localDate: string; startLocal: string }>(
  items: T[],
  days: string[],
): Map<string, T[]> {
  const byDay = new Map<string, T[]>(days.map((day) => [day, []]))
  for (const item of items) byDay.get(item.localDate)?.push(item)
  for (const list of byDay.values()) list.sort((a, b) => a.startLocal.localeCompare(b.startLocal))
  return byDay
}
