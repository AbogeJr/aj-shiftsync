import { describe, expect, it } from 'vitest'
import { evaluateEligibility, type EligibilityContext } from '@/lib/scheduling/eligibility'

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
