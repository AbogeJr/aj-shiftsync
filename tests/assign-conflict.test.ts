import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { assignments, locations, shifts, staff } from '@/lib/db/schema'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { ConflictError } from '@/lib/scheduling/errors'

/**
 * Integration test against a REAL Postgres. Nothing here is mocked, on purpose:
 * the thing under test is a database constraint, and a mock of the database
 * would be a mock of the only component whose behaviour is in question.
 *
 * Requires DATABASE_URL and a migrated database (npm run migrate).
 */

const H = 60 * 60 * 1000
let locationId: string
let staffId: string

// Anchored well clear of any DST transition so the fixtures stay boring; DST
// correctness is the availability layer's problem, not this constraint's.
const BASE = new Date('2026-06-02T09:00:00.000Z')

async function createShift(startsAt: Date, endsAt: Date): Promise<string> {
  const [shift] = await db
    .insert(shifts)
    .values({ locationId, startsAt, endsAt, headcount: 2 })
    .returning({ id: shifts.id })
  return shift.id
}

async function countActive(): Promise<number> {
  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .where(and(eq(assignments.staffId, staffId), eq(assignments.status, 'active')))
  return rows.length
}

beforeAll(async () => {
  // Fail loudly rather than passing vacuously if migration 0001 never ran.
  const constraint = await db.execute(sql`
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlap_or_short_rest'
  `)
  expect(
    constraint.rows.length,
    'no_overlap_or_short_rest is missing - run `npm run migrate` first',
  ).toBe(1)

  const [location] = await db
    .insert(locations)
    .values({ name: `test-${randomSuffix()}`, timezone: 'America/Los_Angeles' })
    .returning({ id: locations.id })
  locationId = location.id

  const [member] = await db
    .insert(staff)
    .values({
      name: 'Concurrency Fixture',
      email: `fixture-${randomSuffix()}@example.test`,
      availabilityTz: 'America/Los_Angeles',
      desiredWeeklyHours: 40,
    })
    .returning({ id: staff.id })
  staffId = member.id
})

afterAll(async () => {
  // Cascades clear shifts and assignments.
  if (locationId) await db.delete(locations).where(eq(locations.id, locationId))
  if (staffId) await db.delete(staff).where(eq(staff.id, staffId))
  await pool.end()
})

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10)
}

describe('no_overlap_or_short_rest under concurrency', () => {
  it('lets exactly one of two racing conflicting assignments through', async () => {
    // Two different shifts, 4 hours apart: they overlap, so both assignments
    // cannot legally coexist. Two separate transactions on two separate pooled
    // connections, started together.
    const shiftA = await createShift(BASE, new Date(BASE.getTime() + 8 * H))
    const shiftB = await createShift(
      new Date(BASE.getTime() + 4 * H),
      new Date(BASE.getTime() + 12 * H),
    )

    const results = await Promise.allSettled([
      assignStaffToShift({ shiftId: shiftA, staffId }),
      assignStaffToShift({ shiftId: shiftB, staffId }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The loser must surface as a typed ConflictError, not a raw pg error.
    const error = (rejected[0] as PromiseRejectedResult).reason
    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).code).toBe('SCHEDULING_CONFLICT')
    expect((error as ConflictError).constraint).toBe('no_overlap_or_short_rest')

    // And the losing transaction left nothing behind.
    expect(await countActive()).toBe(1)
  })

  it('treats under-10h rest as a conflict and exactly-10h as legal', async () => {
    // Runs after the first test, which already left one active assignment
    // covering BASE .. BASE+8h (or BASE+4h .. BASE+12h). Work from a clean slate.
    await db.delete(assignments).where(eq(assignments.staffId, staffId))

    const day1 = await createShift(BASE, new Date(BASE.getTime() + 8 * H))
    await assignStaffToShift({ shiftId: day1, staffId })

    // Starts 9h after day1 ends: legal overlap-wise, illegal rest-wise.
    const tooSoon = await createShift(
      new Date(BASE.getTime() + 17 * H),
      new Date(BASE.getTime() + 21 * H),
    )
    await expect(assignStaffToShift({ shiftId: tooSoon, staffId })).rejects.toBeInstanceOf(
      ConflictError,
    )

    // Starts exactly 10h after day1 ends. Half-open ranges touch without
    // overlapping, so compliant rest is not rejected.
    const exactlyTenHours = await createShift(
      new Date(BASE.getTime() + 18 * H),
      new Date(BASE.getTime() + 22 * H),
    )
    await expect(
      assignStaffToShift({ shiftId: exactlyTenHours, staffId }),
    ).resolves.toMatchObject({ staffId, status: 'active' })

    expect(await countActive()).toBe(2)
  })
})
