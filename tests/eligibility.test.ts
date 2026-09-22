import { describe, expect, it } from 'vitest'
import {
  DAILY_HARD_LIMIT,
  evaluateCompliance,
  evaluateEligibility,
  type EligibilityContext,
} from '@/lib/scheduling/eligibility'

const base: EligibilityContext = {
  staffName: 'Sam',
  locationName: 'Mission Bay',
  requiredSkill: 'host',
  staffSkills: ['host'],
  headcount: 2,
  activeAssignments: 0,
  alreadyAssigned: false,
  certifiedAtLocation: true,
  withinAvailability: true,
  localWindow: { weekday: 'Thu', start: '09:00', end: '17:00' },
  shiftHours: 8,
  dailyHours: 8,
  weeklyHours: 8,
  consecutiveDays: 1,
  hasEnded: false,
  hasStarted: false,
}

const codes = (ctx: Partial<EligibilityContext>) =>
  evaluateEligibility({ ...base, ...ctx }).map((v) => v.code)

describe('eligibility rules', () => {
  it('allows a certified, skilled, available person onto a shift with room', () => {
    expect(codes({})).toEqual([])
  })

  it('blocks once the shift has its full headcount', () => {
    expect(codes({ activeAssignments: 2 })).toContain('shift_full')
    expect(codes({ activeAssignments: 1 })).not.toContain('shift_full')
  })

  it('blocks a missing required skill, and names what they do have', () => {
    const [violation] = evaluateEligibility({ ...base, staffSkills: ['server'] })
    expect(violation.code).toBe('missing_skill')
    expect(violation.message).toContain('requires host')
    expect(violation.message).toContain('server')
  })

  it('does not require a skill when the shift asks for none', () => {
    expect(codes({ requiredSkill: null, staffSkills: [] })).toEqual([])
  })

  it('blocks an uncertified staff member', () => {
    expect(codes({ certifiedAtLocation: false })).toContain('not_certified')
  })

  it('blocks outside availability but not on unknown availability', () => {
    expect(codes({ withinAvailability: false })).toContain('outside_availability')
    // Null means no rules on file: unknown must not make someone unschedulable.
    expect(codes({ withinAvailability: null })).toEqual([])
  })

  it('refuses a shift that has already finished, and says only that', () => {
    const violations = evaluateEligibility({ ...base, hasEnded: true, staffSkills: [] })
    // One clear reason, not a pile of others that no longer matter.
    expect(violations).toHaveLength(1)
    expect(violations[0].code).toBe('shift_ended')
  })

  it('still allows an in-progress shift, because cover is often found late', () => {
    expect(codes({ hasStarted: true, hasEnded: false })).toEqual([])
  })

  it('blocks past the daily hard limit, which no override can lift', () => {
    expect(codes({ dailyHours: DAILY_HARD_LIMIT + 0.5 })).toContain('daily_limit')
    expect(codes({ dailyHours: DAILY_HARD_LIMIT })).not.toContain('daily_limit')
    // Explicitly not overridable - the brief calls 12 hours a hard block.
    expect(codes({ dailyHours: 13, overrideProvided: true })).toContain('daily_limit')
  })

  it('blocks a 7th consecutive day unless a reason is recorded', () => {
    expect(codes({ consecutiveDays: 7 })).toContain('seventh_consecutive_day')
    expect(codes({ consecutiveDays: 6 })).not.toContain('seventh_consecutive_day')
    expect(codes({ consecutiveDays: 7, overrideProvided: true })).not.toContain(
      'seventh_consecutive_day',
    )
  })

  it('reports every reason at once so a manager fixes them together', () => {
    expect(
      codes({ activeAssignments: 2, staffSkills: [], certifiedAtLocation: false }),
    ).toEqual(['shift_full', 'missing_skill', 'not_certified'])
  })

  it('short-circuits when already assigned', () => {
    expect(codes({ alreadyAssigned: true, certifiedAtLocation: false })).toEqual([
      'already_assigned',
    ])
  })
})
