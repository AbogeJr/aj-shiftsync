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
  | 'daily_limit'
  | 'seventh_consecutive_day'
  | 'shift_ended'

/** Surfaced to the manager but never blocking. */
export type ComplianceCode =
  | 'daily_warning'
  | 'weekly_warning'
  | 'sixth_consecutive_day'
  | 'shift_in_progress'

export interface EligibilityViolation {
  code: EligibilityCode | ComplianceCode
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

  /* Labour-law figures, all in the staff member's own timezone and already
     including this shift. */
  shiftHours: number
  dailyHours: number
  weeklyHours: number
  /** Run of consecutive worked days ending on this shift's day, inclusive. */
  consecutiveDays: number
  /** A manager has documented a reason to exceed a rule that allows one. */
  overrideProvided?: boolean

  /** The shift is over. Nobody can be scheduled for it. */
  hasEnded: boolean
  /** Under way but not finished - allowed, because cover is often found late. */
  hasStarted: boolean
}

/** Brief §4. Daily 12h is a hard block; the 7th day needs a documented reason. */
export const DAILY_HARD_LIMIT = 12
export const DAILY_WARNING_AT = 8
export const WEEKLY_WARNING_AT = 35
export const WEEKLY_OVERTIME_AT = 40

export function evaluateEligibility(ctx: EligibilityContext): EligibilityViolation[] {
  const violations: EligibilityViolation[] = []

  // Checked before anything else: a finished shift cannot be staffed, and no
  // other reason is worth reporting about one.
  if (ctx.hasEnded) {
    return [
      {
        code: 'shift_ended',
        message: 'This shift has already finished, so nobody can be added to it.',
      },
    ]
  }

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

  if (ctx.dailyHours > DAILY_HARD_LIMIT) {
    violations.push({
      code: 'daily_limit',
      message: `This would put ${ctx.staffName} on ${ctx.dailyHours.toFixed(1)} hours in one day. ${DAILY_HARD_LIMIT} is the hard limit and cannot be overridden.`,
    })
  }

  // The brief allows a 7th consecutive day only with a documented reason.
  if (ctx.consecutiveDays >= 7 && !ctx.overrideProvided) {
    violations.push({
      code: 'seventh_consecutive_day',
      message: `This would be ${ctx.staffName}'s ${ctx.consecutiveDays}th consecutive day. A manager must record a reason to allow it.`,
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

/**
 * Figures a manager should see but that never block an assignment.
 *
 * Kept separate from evaluateEligibility so that "would this be refused?" and
 * "should someone look at this?" cannot be confused at a call site.
 */
export function evaluateCompliance(ctx: EligibilityContext): EligibilityViolation[] {
  const warnings: EligibilityViolation[] = []

  // Allowed on purpose: the brief's call-out scenario means cover is routinely
  // found after a shift has begun. Worth flagging, not worth refusing.
  if (ctx.hasStarted && !ctx.hasEnded) {
    warnings.push({
      code: 'shift_in_progress',
      message: 'This shift is already under way.',
    })
  }

  if (ctx.dailyHours > DAILY_WARNING_AT && ctx.dailyHours <= DAILY_HARD_LIMIT) {
    warnings.push({
      code: 'daily_warning',
      message: `${ctx.staffName} would work ${ctx.dailyHours.toFixed(1)} hours that day, over the ${DAILY_WARNING_AT}-hour guideline.`,
    })
  }

  if (ctx.weeklyHours >= WEEKLY_WARNING_AT) {
    const overtime = ctx.weeklyHours > WEEKLY_OVERTIME_AT
    warnings.push({
      code: 'weekly_warning',
      message: overtime
        ? `${ctx.staffName} would reach ${ctx.weeklyHours.toFixed(1)} hours this week — past ${WEEKLY_OVERTIME_AT} and into overtime.`
        : `${ctx.staffName} would reach ${ctx.weeklyHours.toFixed(1)} hours this week, approaching the ${WEEKLY_OVERTIME_AT}-hour overtime threshold.`,
    })
  }

  if (ctx.consecutiveDays === 6) {
    warnings.push({
      code: 'sixth_consecutive_day',
      message: `This would be ${ctx.staffName}'s 6th consecutive day.`,
    })
  }

  return warnings
}
