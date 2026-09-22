import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { assignments, certifications, complianceOverrides, locations, shifts, staff } from '@/lib/db/schema'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { loadEligibility } from '@/lib/scheduling/eligibility-query'
import { evaluateCompliance, evaluateEligibility } from '@/lib/scheduling/eligibility'
import { EligibilityError } from '@/lib/scheduling/errors'

// Real database: the figures these rules depend on are computed in SQL, in the
// staff member's own timezone, so only a real query proves them.
const TZ = 'America/New_York'
const SYS = { kind: 'system' } as const
let locationId: string
let workerId: string
const suffix = () => Math.random().toString(36).slice(2, 10)

/** 09:00-17:00 local on a given day offset from a fixed Monday. */
async function shiftOn(dayOffset: number, startHour = 13, hours = 8) {
  const start = new Date(Date.UTC(2027, 2, 1 + dayOffset, startHour, 0, 0))
  const [s] = await db
    .insert(shifts)
    .values({
      locationId,
      startsAt: start,
      endsAt: new Date(start.getTime() + hours * 3600_000),
      headcount: 5,
      publishedAt: sql`now()` as never,
    })
    .returning({ id: shifts.id })
  return s.id
}

async function contextFor(shiftId: string) {
  const [row] = await loadEligibility(db, shiftId, workerId)
  return row.context
}

beforeAll(async () => {
  const [l] = await db.insert(locations).values({ name: `comp-${suffix()}`, timezone: TZ }).returning({ id: locations.id })
  locationId = l.id
  const [p] = await db.insert(staff)
    .values({ name: 'Runner', email: `runner-${suffix()}@example.test`, availabilityTz: TZ })
    .returning({ id: staff.id })
  workerId = p.id
  await db.insert(certifications).values({ staffId: workerId, locationId, effectiveFrom: new Date('2020-01-01') })
})

afterAll(async () => {
  await db.delete(locations).where(eq(locations.id, locationId))
  await db.delete(staff).where(eq(staff.id, workerId))
  await pool.end()
})

describe('consecutive days, counted in the staff member\'s timezone', () => {
  it('blocks the 7th straight day and lets a documented reason through', async () => {
    // Six days worked back to back.
    for (let day = 0; day < 6; day++) {
      await assignStaffToShift({ shiftId: await shiftOn(day), staffId: workerId, actor: SYS })
    }

    const sixth = await contextFor(await shiftOn(5, 20, 2))
    expect(sixth.consecutiveDays).toBe(6)
    expect(evaluateCompliance(sixth).map((v) => v.code)).toContain('sixth_consecutive_day')

    const seventhShift = await shiftOn(6)
    const seventh = await contextFor(seventhShift)
    expect(seventh.consecutiveDays).toBe(7)
    expect(evaluateEligibility(seventh).map((v) => v.code)).toContain('seventh_consecutive_day')

    await expect(
      assignStaffToShift({ shiftId: seventhShift, staffId: workerId, actor: SYS }),
    ).rejects.toBeInstanceOf(EligibilityError)

    // With a documented reason it goes through, and the reason is recorded.
    const assignment = await assignStaffToShift({
      shiftId: seventhShift,
      staffId: workerId,
      actor: { kind: 'system', staffId: workerId },
      override: { rule: 'seventh_consecutive_day', reason: 'Two call-outs, no other cover' },
    })
    const [recorded] = await db
      .select()
      .from(complianceOverrides)
      .where(eq(complianceOverrides.assignmentId, assignment.id))
    expect(recorded.rule).toBe('seventh_consecutive_day')
    expect(recorded.reason).toBe('Two call-outs, no other cover')

    await db.delete(assignments).where(eq(assignments.staffId, workerId))
  })

  it('restarts the count after a day off', async () => {
    for (const day of [10, 11, 12]) {
      await assignStaffToShift({ shiftId: await shiftOn(day), staffId: workerId, actor: SYS })
    }
    // Day 13 is off; day 14 starts a fresh run.
    expect((await contextFor(await shiftOn(14))).consecutiveDays).toBe(1)
    await db.delete(assignments).where(eq(assignments.staffId, workerId))
  })
})

describe('daily and weekly hours', () => {
  it('blocks past 12 hours in one day', async () => {
    await assignStaffToShift({ shiftId: await shiftOn(20, 13, 8), staffId: workerId, actor: SYS })
    // A further 5 hours the same local day takes the total to 13.
    const extra = await shiftOn(20, 22, 5)
    const ctx = await contextFor(extra)
    expect(ctx.dailyHours).toBeCloseTo(13, 1)
    expect(evaluateEligibility(ctx).map((v) => v.code)).toContain('daily_limit')
    await expect(
      assignStaffToShift({ shiftId: extra, staffId: workerId, actor: SYS }),
    ).rejects.toBeInstanceOf(EligibilityError)
    await db.delete(assignments).where(eq(assignments.staffId, workerId))
  })

  it('warns as the week approaches overtime, without blocking', async () => {
    // 2027-03-01 is a Monday, so offsets 21-25 are Mon-Fri of one week. Weeks
    // are truncated Mon-Sun, so the days must not straddle a boundary.
    for (const day of [21, 22, 23, 24]) {
      await assignStaffToShift({ shiftId: await shiftOn(day), staffId: workerId, actor: SYS })
    }
    const fifth = await contextFor(await shiftOn(25))
    expect(fifth.weeklyHours).toBeCloseTo(40, 1)
    expect(evaluateCompliance(fifth).map((v) => v.code)).toContain('weekly_warning')
    expect(evaluateEligibility(fifth)).toEqual([]) // a warning, never a block
    await db.delete(assignments).where(eq(assignments.staffId, workerId))
  })
})
