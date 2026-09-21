/** Typed errors raised by lib/scheduling/*. Route handlers map these to status codes. */

export const NO_OVERLAP_OR_SHORT_REST = 'no_overlap_or_short_rest'

/**
 * A write was rejected because it would have broken a scheduling invariant that
 * the database enforces. Currently only ever raised for the
 * no_overlap_or_short_rest exclusion constraint.
 */
export class ConflictError extends Error {
  readonly name = 'ConflictError'
  /** Stable discriminator for callers that switch on the failure. */
  readonly code = 'SCHEDULING_CONFLICT' as const
  /** Postgres constraint that rejected the write. */
  readonly constraint: string
  /**
   * Human-readable account of WHICH shift conflicted and whether it was an
   * overlap or a short rest. Populated by the pure validator; undefined when
   * the validator has not run. See lib/scheduling/assign.ts.
   */
  readonly explanation?: string
  /** Raw Postgres DETAIL line, for logs. Never show this to an end user. */
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

/**
 * Drizzle wraps driver errors, so the pg error can sit one or more `cause`
 * levels down. Walk the chain rather than assuming a depth.
 */
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
