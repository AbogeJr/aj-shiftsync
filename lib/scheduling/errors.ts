// Typed errors raised by lib/scheduling/*. Callers map these to status codes.

export const NO_OVERLAP_OR_SHORT_REST = 'no_overlap_or_short_rest'

/** A write rejected by a database-enforced scheduling invariant. */
export class ConflictError extends Error {
  readonly name = 'ConflictError'
  readonly code = 'SCHEDULING_CONFLICT' as const
  readonly constraint: string
  /** Which shift collided and why. Populated by the validator; see assign.ts. */
  readonly explanation?: string
  /** Raw Postgres DETAIL, for logs only. Never shown to an end user. */
  readonly detail?: string

  constructor(args: {
    message: string
    constraint: string
    explanation?: string
    detail?: string
    cause?: unknown
  }) {
    super(args.message, { cause: args.cause })
    this.constraint = args.constraint
    this.explanation = args.explanation
    this.detail = args.detail
  }
}

/** The caller may not act on this location. */
export class LocationAccessError extends Error {
  readonly name = 'LocationAccessError'
  readonly code = 'LOCATION_FORBIDDEN' as const
  constructor(locationId: string) {
    super(`Not permitted for location ${locationId}`)
  }
}

/** One or more eligibility rules rejected the assignment. */
export class EligibilityError extends Error {
  readonly name = 'EligibilityError'
  readonly code = 'NOT_ELIGIBLE' as const
  readonly violations: ReadonlyArray<{ code: string; message: string }>

  constructor(violations: ReadonlyArray<{ code: string; message: string }>) {
    super(violations.map((v) => v.message).join(' '))
    this.violations = violations
  }
}

/** Someone else changed the shift since it was loaded. */
export class ConcurrentEditError extends Error {
  readonly name = 'ConcurrentEditError'
  readonly code = 'STALE_VERSION' as const
  constructor() {
    super('This shift was changed by someone else. Reload and try again.')
  }
}

/** The schedule has locked for this shift. */
export class CutoffError extends Error {
  readonly name = 'CutoffError'
  readonly code = 'PAST_CUTOFF' as const
  constructor(hours: number) {
    super(`Published shifts lock ${hours} hours before they start and can no longer be edited.`)
  }
}

export class NotFoundError extends Error {
  readonly name = 'NotFoundError'
  readonly code = 'NOT_FOUND' as const

  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`)
  }
}

/** Postgres SQLSTATE for exclusion_violation. */
const PG_EXCLUSION_VIOLATION = '23P01'
/** deadlock_detected and serialization_failure: retryable, not fatal. */
const PG_DEADLOCK = '40P01'
const PG_SERIALIZATION_FAILURE = '40001'

export function isRetryableConcurrencyError(err: unknown): boolean {
  const code = asPostgresError(err)?.code
  return code === PG_DEADLOCK || code === PG_SERIALIZATION_FAILURE
}

interface PgErrorShape {
  code?: string
  constraint?: string
  detail?: string
}

/** Drizzle wraps driver errors, so walk the `cause` chain rather than assume a depth. */
export function asPostgresError(err: unknown): PgErrorShape | undefined {
  let current: unknown = err
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === 'object' && 'code' in current) {
      const candidate = current as PgErrorShape
      if (typeof candidate.code === 'string') return candidate
    }
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export function isExclusionViolation(err: unknown, constraint?: string): boolean {
  const pgError = asPostgresError(err)
  if (pgError?.code !== PG_EXCLUSION_VIOLATION) return false
  return constraint ? pgError.constraint === constraint : true
}
