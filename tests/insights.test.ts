import { describe, expect, it } from 'vitest'
import {
  attributeOvertime,
  overtimeProjection,
  OVERTIME_MULTIPLIER,
  premiumFairness,
} from '@/lib/scheduling/insights'
import type { FairnessRow, TeamMember, WeekAssignment } from '@/lib/scheduling/insights'

// Pure derivation over already-loaded rows: no database, no mocks.
const member = (over: Partial<TeamMember> & { id: string }): TeamMember => ({
  name: `Person ${over.id}`,
  role: 'staff',
  skills: [],
  locations: [],
  hoursThisWeek: 0,
  desiredWeeklyHours: 40,
  hourlyRateCents: 2000,
  byLocation: [],
  ...over,
})

describe('overtimeProjection', () => {
  it('counts nothing when everyone is below the warning threshold', () => {
    const p = overtimeProjection([member({ id: 'a', hoursThisWeek: 34.9 })])
    expect(p.overtimeHours).toBe(0)
    expect(p.overtimeCents).toBe(0)
    expect(p.atRisk).toHaveLength(0)
  })

  it('flags 39.9 hours as at risk while owing no overtime', () => {
    const p = overtimeProjection([member({ id: 'a', hoursThisWeek: 39.9 })])
    expect(p.overtimeHours).toBe(0)
    expect(p.overtimeCents).toBe(0)
    expect(p.atRisk).toHaveLength(1)
  })

  it('counts only the hours past 40, not the whole week', () => {
    const p = overtimeProjection([member({ id: 'a', hoursThisWeek: 46 })])
    expect(p.overtimeHours).toBe(6)
    // 6 hrs * $20 * 1.5
    expect(p.overtimeCents).toBe(6 * 2000 * OVERTIME_MULTIPLIER)
    // The avoidable part is the 0.5x on top of straight time.
    expect(p.premiumCents).toBe(6 * 2000 * 0.5)
  })

  it('flags people approaching the threshold with zero overtime hours', () => {
    const p = overtimeProjection([member({ id: 'a', hoursThisWeek: 36 })])
    expect(p.atRisk).toEqual([
      { id: 'a', name: 'Person a', hours: 36, overtimeHours: 0 },
    ])
    expect(p.overtimeHours).toBe(0)
  })

  it('counts hours but no money for somebody with no rate on file', () => {
    const p = overtimeProjection([
      member({ id: 'a', hoursThisWeek: 44, hourlyRateCents: null }),
    ])
    expect(p.overtimeHours).toBe(4)
    expect(p.overtimeCents).toBe(0)
    // Still visible as a risk - the hours are real even if the cost is unknown.
    expect(p.atRisk).toHaveLength(1)
  })

  it('totals across people and sorts the worst first', () => {
    const p = overtimeProjection([
      member({ id: 'a', hoursThisWeek: 42 }),
      member({ id: 'b', hoursThisWeek: 50 }),
      member({ id: 'c', hoursThisWeek: 10 }),
      member({ id: 'd', hoursThisWeek: 35 }),
    ])
    expect(p.overtimeHours).toBe(12)
    expect(p.atRisk.map((r) => r.id)).toEqual(['b', 'a', 'd'])
  })

  it('is exactly at the boundary: 40 hours is not overtime', () => {
    const p = overtimeProjection([member({ id: 'a', hoursThisWeek: 40 })])
    expect(p.overtimeHours).toBe(0)
    // But 40 is past the 35-hour warning, so it is still worth showing.
    expect(p.atRisk).toHaveLength(1)
  })
})

describe('premiumFairness', () => {
  const row = (over: Partial<FairnessRow> & { id: string }): FairnessRow => ({
    name: `Person ${over.id}`,
    hours: 20,
    desired: 20,
    premiumShifts: 0,
    ...over,
  })

  it('scores an empty week as fair rather than inventing a grievance', () => {
    expect(premiumFairness([]).score).toBe(100)
    expect(premiumFairness([row({ id: 'a', hours: 0 })]).score).toBe(100)
  })

  it('scores a week with no premium shifts as fair', () => {
    const f = premiumFairness([row({ id: 'a' }), row({ id: 'b' })])
    expect(f.score).toBe(100)
    expect(f.totalPremium).toBe(0)
  })

  it('scores a proportional split as perfect', () => {
    const f = premiumFairness([
      row({ id: 'a', hours: 20, premiumShifts: 2 }),
      row({ id: 'b', hours: 20, premiumShifts: 2 }),
    ])
    expect(f.score).toBe(100)
    expect(f.misallocated).toBe(0)
  })

  it('benchmarks against hours worked, not an equal split', () => {
    // b works three times the hours, so three times the premium shifts is fair.
    const f = premiumFairness([
      row({ id: 'a', hours: 10, premiumShifts: 1 }),
      row({ id: 'b', hours: 30, premiumShifts: 3 }),
    ])
    expect(f.score).toBe(100)
  })

  it('counts how many shifts would have to move', () => {
    // Equal hours, but a has all four premium shifts: two must change hands.
    const f = premiumFairness([
      row({ id: 'a', hours: 20, premiumShifts: 4 }),
      row({ id: 'b', hours: 20, premiumShifts: 0 }),
    ])
    expect(f.misallocated).toBe(2)
    expect(f.score).toBe(50)
  })

  it('puts the worst-served person first', () => {
    const f = premiumFairness([
      row({ id: 'a', hours: 20, premiumShifts: 4 }),
      row({ id: 'b', hours: 20, premiumShifts: 0 }),
      row({ id: 'c', hours: 20, premiumShifts: 2 }),
    ])
    expect(f.rows[0].id).toBe('b')
    expect(f.rows[0].delta).toBeLessThan(0)
  })

  it('ignores people who worked nothing this week', () => {
    const f = premiumFairness([
      row({ id: 'a', hours: 20, premiumShifts: 2 }),
      row({ id: 'b', hours: 20, premiumShifts: 2 }),
      row({ id: 'c', hours: 0, premiumShifts: 0 }),
    ])
    expect(f.score).toBe(100)
    expect(f.rows.map((r) => r.id)).not.toContain('c')
  })
})

describe('attributeOvertime', () => {
  const shift = (over: Partial<WeekAssignment> & { staffId: string; localDate: string }): WeekAssignment => ({
    staffName: `Person ${over.staffId}`,
    shiftId: `${over.staffId}-${over.localDate}`,
    location: 'Back Bay',
    startLocal: '09:00',
    endLocal: '17:00',
    hours: 8,
    ...over,
  })

  it('names nobody when nobody passes 40 hours', () => {
    const week = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']
      .map((localDate) => shift({ staffId: 'a', localDate }))
    expect(attributeOvertime(week)).toHaveLength(0) // 5 x 8 = exactly 40
  })

  it('names the shift that carries the total past the threshold', () => {
    const week = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09']
      .map((localDate) => shift({ staffId: 'a', localDate }))
    const [culprit] = attributeOvertime(week)
    expect(culprit.tipping.localDate).toBe('2027-01-09') // the 6th day crosses 40
    expect(culprit.hoursBefore).toBe(40)
    expect(culprit.overtimeHours).toBe(8)
    expect(culprit.totalHours).toBe(48)
  })

  it('attributes chronologically, not to the longest shift', () => {
    const week = [
      shift({ staffId: 'a', localDate: '2027-01-04', hours: 38 }),
      shift({ staffId: 'a', localDate: '2027-01-05', hours: 4 }),
      shift({ staffId: 'a', localDate: '2027-01-06', hours: 12 }),
    ]
    const [culprit] = attributeOvertime(week)
    // The 4-hour shift is what crosses 40, even though the 12-hour one is bigger.
    expect(culprit.tipping.localDate).toBe('2027-01-05')
    expect(culprit.hoursBefore).toBe(38)
  })

  it('sorts input, so row order from the database cannot change the answer', () => {
    const week = [
      shift({ staffId: 'a', localDate: '2027-01-06', hours: 12 }),
      shift({ staffId: 'a', localDate: '2027-01-04', hours: 38 }),
      shift({ staffId: 'a', localDate: '2027-01-05', hours: 4 }),
    ]
    expect(attributeOvertime(week)[0].tipping.localDate).toBe('2027-01-05')
  })

  it('handles several people independently, worst first', () => {
    const week = [
      ...['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08', '2027-01-09']
        .map((localDate) => shift({ staffId: 'a', localDate })),
      shift({ staffId: 'b', localDate: '2027-01-04', hours: 41 }),
      shift({ staffId: 'c', localDate: '2027-01-04', hours: 8 }),
    ]
    const culprits = attributeOvertime(week)
    expect(culprits.map((c) => c.staffId)).toEqual(['a', 'b']) // c never passes 40
    expect(culprits[0].overtimeHours).toBe(8)
    expect(culprits[1].overtimeHours).toBe(1)
  })

  it('names a single oversized shift as its own cause', () => {
    const [culprit] = attributeOvertime([shift({ staffId: 'a', localDate: '2027-01-04', hours: 45 })])
    expect(culprit.tipping.hours).toBe(45)
    expect(culprit.hoursBefore).toBe(0)
  })
})
