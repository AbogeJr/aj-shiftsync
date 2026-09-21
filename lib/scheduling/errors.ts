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

export class NotFoundError extends Error {
  readonly name = 'NotFoundError'
  readonly code = 'NOT_FOUND' as const

  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`)
  }
}

/** Postgres SQLSTATE for exclusion_violation. */
const PG_EXCLUSION_VIOLATION = '23P01'

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
