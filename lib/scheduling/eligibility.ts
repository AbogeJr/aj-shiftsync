/**
 * Eligibility rules from the brief that a table constraint cannot express.
 *
 * `evaluateEligibility` is pure over already-loaded rows, so every rule is
 * unit-testable without a database. Loading the context and taking the lock
 * that makes the headcount check concurrency-safe is the caller's job - see
 * assign.ts.
 *
 * Double-booking and the 10-hour rest gap are NOT here: those stay in the
 * no_overlap_or_short_rest exclusion constraint, which holds under concurrency
 * no matter what does the writing.
 */

export type EligibilityCode =
  | 'already_assigned'
  | 'shift_full'
  | 'missing_skill'
  | 'not_certified'
  | 'outside_availability'

export interface EligibilityViolation {
  code: EligibilityCode
  /** Written for a manager, naming the person and the specific reason. */
  message: string
}

export interface EligibilityContext {
  staffName: string
  locationName: string
  /** Skill the shift requires, or null when it takes anyone. */
  requiredSkill: string | null
  staffSkills: string[]
  headcount: number
  activeAssignments: number
  alreadyAssigned: boolean
  certifiedAtLocation: boolean
  /** Null when availability could not be resolved (no rules on file). */
  withinAvailability: boolean | null
  /** The shift in the staff member's own wall clock, for the message. */
  localWindow: { weekday: string; start: string; end: string } | null
}

export function evaluateEligibility(ctx: EligibilityContext): EligibilityViolation[] {
  const violations: EligibilityViolation[] = []

  if (ctx.alreadyAssigned) {
    violations.push({
      code: 'already_assigned',
      message: `${ctx.staffName} is already on this shift.`,
    })
    return violations
  }

  if (ctx.activeAssignments >= ctx.headcount) {
    violations.push({
      code: 'shift_full',
      message: `This shift already has all ${ctx.headcount} of the people it needs. Raise the headcount to add another.`,
    })
  }

  if (ctx.requiredSkill && !ctx.staffSkills.includes(ctx.requiredSkill)) {
    const has = ctx.staffSkills.length > 0 ? ctx.staffSkills.join(', ') : 'no skills on file'
    violations.push({
      code: 'missing_skill',
      message: `This shift requires ${ctx.requiredSkill}, and ${ctx.staffName} has ${has}.`,
    })
  }

  if (!ctx.certifiedAtLocation) {
    violations.push({
      code: 'not_certified',
      message: `${ctx.staffName} is not certified to work at ${ctx.locationName}.`,
    })
  }

  // Null means no availability rules exist for this person, which is treated as
  // "unknown, do not block" rather than "unavailable" - blocking on absent data
  // would make a newly added staff member unschedulable.
  if (ctx.withinAvailability === false) {
    const w = ctx.localWindow
    violations.push({
      code: 'outside_availability',
      message: w
        ? `${ctx.staffName} is not available ${w.weekday} ${w.start}–${w.end} in their own timezone.`
        : `${ctx.staffName} is not available during this shift.`,
    })
  }

  return violations
}

export function describeViolations(violations: EligibilityViolation[]): string {
  return violations.map((v) => v.message).join(' ')
}
