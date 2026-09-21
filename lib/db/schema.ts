import { sql } from 'drizzle-orm'
import {
  boolean,
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
 * Time model: every *instant* is `timestamptz`, never split into a date and a
 * time. Wall-clock intent (availability rules and exceptions) is a local `time`
 * plus the staff member's own IANA timezone, resolved at query time - which is
 * what keeps it correct across DST. See docs/schema.md.
 */

export const staffRole = pgEnum('staff_role', ['staff', 'manager', 'admin'])

/** `active` is what the no_overlap_or_short_rest constraint filters on. */
export const assignmentStatus = pgEnum('assignment_status', [
  'active',
  'cancelled',
  'declined',
])

export const availabilityExceptionKind = pgEnum('availability_exception_kind', [
  'available',
  'unavailable',
])

export const swapRequestKind = pgEnum('swap_request_kind', ['swap', 'drop'])

/**
 * Peer acceptance and manager approval are distinct steps: the brief requires
 * the original assignment to stand until a manager approves.
 */
export const swapRequestStatus = pgEnum('swap_request_status', [
  'open',
  'peer_accepted',
  'approved',
  'rejected',
  'cancelled',
  'expired',
])

export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  // IANA identifier, never a fixed UTC offset.
  timezone: text('timezone').notNull(),
  /** How long before a shift starts the schedule locks. Brief default: 48h. */
  editCutoffHours: integer('edit_cutoff_hours').notNull().default(48),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** Canonical skill names. Free text here would let a typo silently make someone ineligible. */
export const skills = pgTable('skills', {
  name: text('name').primaryKey(),
  description: text('description'),
})

export const staff = pgTable(
  'staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    role: staffRole('role').notNull().default('staff'),
    desiredWeeklyHours: integer('desired_weekly_hours').notNull().default(0),
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
    skill: text('skill')
      .notNull()
      .references(() => skills.name, { onUpdate: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.skill] }), index('staff_skills_skill_idx').on(t.skill)],
)

/** Eligibility to work a location. Valid over [effective_from, revoked_at). */
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
    // 0 = Sunday .. 6 = Saturday, matching Postgres extract(dow).
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

/** One-off override for a single local calendar day in the staff member's timezone. */
export const availabilityExceptions = pgTable(
  'availability_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    // mode 'string' keeps this a plain YYYY-MM-DD, so JS Date cannot
    // reinterpret it as UTC.
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
    requiredSkill: text('required_skill').references(() => skills.name, {
      onUpdate: 'cascade',
    }),
    headcount: integer('headcount').notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    // Bumped on every edit; the handle for optimistic concurrency.
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
 * starts_at / ends_at are denormalized from `shifts` on purpose: a table
 * constraint can only see its own row, and no_overlap_or_short_rest must
 * compare time ranges per staff member.
 *
 * The cost is a sync obligation - any transaction editing a shift's times MUST
 * update its active assignments in the same transaction.
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
    // Actual attendance, as opposed to the scheduled times above. The
    // on-duty-now board reads these, not starts_at/ends_at.
    clockedInAt: timestamp('clocked_in_at', { withTimezone: true }),
    clockedOutAt: timestamp('clocked_out_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('assignments_shift_idx').on(t.shiftId),
    index('assignments_on_duty_idx').on(t.clockedInAt),
    index('assignments_staff_starts_at_idx').on(t.staffId, t.startsAt),
    check('assignments_time_order', sql`${t.endsAt} > ${t.startsAt}`),
    // The exclusion constraint lives in drizzle/0001_*.sql; drizzle-kit cannot
    // express EXCLUDE USING gist.
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
    // Null means offered to anyone eligible.
    /** The named counterparty on a swap. Always null on a drop. */
    requestedTo: uuid('requested_to').references(() => staff.id, {
      onDelete: 'cascade',
    }),
    kind: swapRequestKind('kind').notNull().default('swap'),
    /** The other side of a true swap. Null for a drop. */
    targetAssignmentId: uuid('target_assignment_id').references(() => assignments.id, {
      onDelete: 'cascade',
    }),
    /** Drops expire 24h before the shift if unclaimed. Null for a swap. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => staff.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    status: swapRequestStatus('status').notNull().default('open'),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    index('swap_requests_assignment_idx').on(t.assignmentId, t.status),
    // Supports the "no more than 3 pending per staff member" rule.
    index('swap_requests_requester_open_idx').on(t.requestedBy, t.status),
    // A swap trades two named assignments between two named people. A drop is
    // offered to nobody in particular and expires. One constraint, so a row
    // cannot be half of each.
    check(
      'swap_requests_shape',
      sql`(
        ${t.kind} = 'swap'
        AND ${t.requestedTo} IS NOT NULL
        AND ${t.targetAssignmentId} IS NOT NULL
        AND ${t.expiresAt} IS NULL
      ) OR (
        ${t.kind} = 'drop'
        AND ${t.requestedTo} IS NULL
        AND ${t.targetAssignmentId} IS NULL
        AND ${t.expiresAt} IS NOT NULL
      )`,
    ),
  ],
)

/**
 * A manager authorising an exception to a labour rule - currently the 7th
 * consecutive day. Distinct from audit_log: that records what changed, this
 * records who permitted a rule to be broken and why.
 */
export const complianceOverrides = pgTable(
  'compliance_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    rule: text('rule').notNull(),
    reason: text('reason').notNull(),
    overriddenBy: uuid('overridden_by')
      .notNull()
      .references(() => staff.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('compliance_overrides_assignment_idx').on(t.assignmentId)],
)

export const notificationPreferences = pgTable('notification_preferences', {
  staffId: uuid('staff_id')
    .primaryKey()
    .references(() => staff.id, { onDelete: 'cascade' }),
  emailSimulationEnabled: boolean('email_simulation_enabled').notNull().default(false),
  /** Notification `type` values this staff member has muted. */
  mutedTypes: jsonb('muted_types').notNull().default(sql`'[]'::jsonb`),
})

/** Simulated outbound email, so the in-app + email preference is observable. */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    notificationId: uuid('notification_id').references(() => notifications.id, {
      onDelete: 'set null',
    }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('email_log_staff_idx').on(t.staffId, t.sentAt)],
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
    // Null for system-initiated changes.
    actorStaffId: uuid('actor_staff_id').references(() => staff.id, {
      onDelete: 'set null',
    }),
    // Denormalized so admins can export by location without joining through
    // every polymorphic entity type.
    locationId: uuid('location_id').references(() => locations.id, {
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
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_log_location_idx').on(t.locationId, t.createdAt),
  ],
)
