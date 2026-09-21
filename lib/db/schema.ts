import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Time model, applied throughout this file:
 *
 *  - Every *instant* is `timestamptz`. There is no column pair anywhere that
 *    splits an instant into a date and a time.
 *  - Wall-clock intent (an availability rule, an exception window) is stored as
 *    a naked local `time` - and, for exceptions, a local calendar `date` -
 *    alongside the staff member's own IANA timezone on `staff.availability_tz`.
 *    These are not instants; "I work 09:00-17:00 on Tuesdays" stays true across
 *    a DST transition precisely because it is never frozen into a UTC offset.
 *    Resolution to an instant happens at query time against the timezone.
 */

export const staffRole = pgEnum('staff_role', ['staff', 'manager', 'admin'])

/** `active` is the status the no_overlap_or_short_rest constraint filters on. */
export const assignmentStatus = pgEnum('assignment_status', [
  'active',
  'cancelled',
  'declined',
])

export const availabilityExceptionKind = pgEnum('availability_exception_kind', [
  'available',
  'unavailable',
])

export const swapRequestStatus = pgEnum('swap_request_status', [
  'open',
  'accepted',
  'rejected',
  'cancelled',
])

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** IANA identifier, e.g. 'America/Los_Angeles'. Never a fixed UTC offset. */
  timezone: text('timezone').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: staffRole('role').notNull().default('staff'),
    desiredWeeklyHours: integer('desired_weekly_hours').notNull().default(0),
    /** The staff member's own IANA timezone. Availability resolves against it. */
    availabilityTz: text('availability_tz').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('staff_email_key').on(t.email),
    check(
      'staff_desired_weekly_hours_sane',
      sql`${t.desiredWeeklyHours} >= 0 AND ${t.desiredWeeklyHours} <= 168`,
    ),
  ],
)

export const staffSkills = pgTable(
  'staff_skills',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.skill] }), index('staff_skills_skill_idx').on(t.skill)],
)

/**
 * A certification is what makes a staff member eligible to work a location.
 * Open-ended until revoked, so validity is a half-open interval of instants.
 */
export const certifications = pgTable(
  'certifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('certifications_staff_location_idx').on(t.staffId, t.locationId),
    check(
      'certifications_revoked_after_effective',
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} > ${t.effectiveFrom}`,
    ),
  ],
)

export const managerLocations = pgTable(
  'manager_locations',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.locationId] })],
)

/** Recurring weekly availability, in the staff member's local wall-clock time. */
export const availabilityRules = pgTable(
  'availability_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    /** 0 = Sunday .. 6 = Saturday, matching Postgres `extract(dow ...)`. */
    weekday: smallint('weekday').notNull(),
    startLocal: time('start_local').notNull(),
    endLocal: time('end_local').notNull(),
  },
  (t) => [
    index('availability_rules_staff_idx').on(t.staffId, t.weekday),
    check('availability_rules_weekday_range', sql`${t.weekday} BETWEEN 0 AND 6`),
    check('availability_rules_local_order', sql`${t.endLocal} > ${t.startLocal}`),
  ],
)

/**
 * A one-off override for a single local calendar day. `date` here is a real
 * calendar date in the staff member's timezone, not half of a split instant.
 */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    /** Local calendar date in the staff member's timezone (mode 'string' keeps
     *  it a plain YYYY-MM-DD and stops JS Date from reinterpreting it as UTC). */
    date: date('date', { mode: 'string' }).notNull(),
    startLocal: time('start_local').notNull(),
    endLocal: time('end_local').notNull(),
    kind: availabilityExceptionKind('kind').notNull(),
  },
  (t) => [
    index('availability_exceptions_staff_date_idx').on(t.staffId, t.date),
    check('availability_exceptions_local_order', sql`${t.endLocal} > ${t.startLocal}`),
  ],
)

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    requiredSkill: text('required_skill'),
    headcount: integer('headcount').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    /** Bumped on every edit; the handle for optimistic concurrency. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('shifts_location_starts_at_idx').on(t.locationId, t.startsAt),
    check('shifts_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    check('shifts_headcount_positive', sql`${t.headcount} > 0`),
  ],
)

/**
 * starts_at / ends_at are deliberately denormalized from `shifts`.
 *
 * A Postgres table constraint can only see columns on its own row, and the
 * no_overlap_or_short_rest exclusion constraint has to compare time ranges per
 * staff member. Putting the times here is what lets the database - rather than
 * application code - be the thing that enforces the rule.
 *
 * The cost is a sync obligation: any transaction that edits shifts.starts_at or
 * shifts.ends_at MUST update the active assignment rows in the same
 * transaction. See lib/scheduling/assign.ts.
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    status: assignmentStatus('status').notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('assignments_shift_idx').on(t.shiftId),
    index('assignments_staff_starts_at_idx').on(t.staffId, t.startsAt),
    check('assignments_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    // The exclusion constraint itself lives in the hand-written migration
    // drizzle/0001_no_overlap_or_short_rest.sql - drizzle-kit cannot express
    // EXCLUDE USING gist.
  ],
)

export const swapRequests = pgTable(
  'swap_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    /** Null means offered to anyone eligible rather than a named colleague. */
    requestedTo: uuid('requested_to').references(() => staff.id, {
      onDelete: 'set null',
    }),
    status: swapRequestStatus('status').notNull().default('open'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('swap_requests_assignment_idx').on(t.assignmentId, t.status)],
)

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_staff_unread_idx').on(t.staffId, t.createdAt)],
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null for system-initiated changes (migrations, jobs). */
    actorStaffId: uuid('actor_staff_id').references(() => staff.id, {
      onDelete: 'set null',
    }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
)
