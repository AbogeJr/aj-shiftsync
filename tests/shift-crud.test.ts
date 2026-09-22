import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { assignments, certifications, locations, shifts, staff } from '@/lib/db/schema'
import { createShifts, deleteShift, unassign, updateShift } from '@/lib/scheduling/shifts'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { ConcurrentEditError, ConflictError } from '@/lib/scheduling/errors'

// Real database. The service authorizes via session, so these call the same
// functions the server actions do, with the system actor for assignment.
let locationId: string
let staffId: string
const TZ = 'America/New_York'

const suffix = () => Math.random().toString(36).slice(2, 10)

async function shiftRow(id: string) {
  const r = await db.execute<{
    local_start: string
    local_end: string
    local_date: string
    end_date: string
    version: number
    headcount: number
  }>(sql`
    SELECT to_char(starts_at AT TIME ZONE ${TZ}, 'HH24:MI') local_start,
           to_char(ends_at   AT TIME ZONE ${TZ}, 'HH24:MI') local_end,
           to_char(starts_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') local_date,
           to_char(ends_at   AT TIME ZONE ${TZ}, 'YYYY-MM-DD') end_date,
           version, headcount
    FROM shifts WHERE id = ${id}`)
  return r.rows[0]
}

beforeAll(async () => {
  const [l] = await db
    .insert(locations)
    .values({ name: `crud-${suffix()}`, timezone: TZ })
    .returning({ id: locations.id })
  locationId = l.id
  const [s] = await db
    .insert(staff)
    .values({ name: 'CRUD Fixture', email: `crud-${suffix()}@example.test`, availabilityTz: TZ })
    .returning({ id: staff.id })
  staffId = s.id
  await db
    .insert(certifications)
    .values({ staffId, locationId, effectiveFrom: new Date('2020-01-01T00:00:00Z') })
})

afterAll(async () => {
  await db.delete(locations).where(eq(locations.id, locationId))
  await db.delete(staff).where(eq(staff.id, staffId))
  await pool.end()
})

describe('shift CRUD', () => {
  it('creates one shift per selected day', async () => {
    const { created } = await createShifts({
      locationId,
      dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
      startLocal: '09:00',
      endLocal: '17:00',
      requiredSkill: null,
      headcount: 2,
      actor: { kind: 'system' },
    })
    expect(created).toBe(3)
    const rows = await db.select().from(shifts).where(eq(shifts.locationId, locationId))
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.version === 1)).toBe(true)
  })

  it('treats an overnight shift as one shift ending the next local day', async () => {
    await createShifts({
      locationId,
      dates: ['2026-06-10'],
      startLocal: '23:00',
      endLocal: '03:00',
      requiredSkill: null,
      headcount: 1,
      actor: { kind: 'system' },
    })
    const [row] = await db.execute<{ id: string }>(
      sql`SELECT id FROM shifts WHERE location_id = ${locationId}
          AND to_char(starts_at AT TIME ZONE ${TZ}, 'HH24:MI') = '23:00'`,
    ).then((r) => r.rows)
    const s = await shiftRow(row.id)
    expect(s.local_date).toBe('2026-06-10')
    expect(s.end_date).toBe('2026-06-11')
    expect(s.local_start).toBe('23:00')
    expect(s.local_end).toBe('03:00')
  })

  it('moves the assignments when the shift moves', async () => {
    const [created] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-07-01T13:00:00Z'),
        endsAt: new Date('2026-07-01T21:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id, version: shifts.version })

    await assignStaffToShift({ shiftId: created.id, staffId, actor: { kind: 'system' } })

    await updateShift({
      shiftId: created.id,
      version: created.version,
      startLocal: '14:00',
      endLocal: '20:00',
      requiredSkill: null,
      headcount: 1,
      actor: { kind: 'system' },
    })

    const after = await shiftRow(created.id)
    expect(after.local_start).toBe('14:00')
    expect(after.version).toBe(2)

    // The denormalized copy must have followed, or the constraint reasons
    // about times that no longer exist.
    const [a] = await db.select().from(assignments).where(eq(assignments.shiftId, created.id))
    expect(a.startsAt.toISOString()).toBe('2026-07-01T18:00:00.000Z')
    expect(a.endsAt.toISOString()).toBe('2026-07-02T00:00:00.000Z')
  })

  it('refuses an edit made against a stale version', async () => {
    const [created] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-08-01T13:00:00Z'),
        endsAt: new Date('2026-08-01T21:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id, version: shifts.version })

    const edit = {
      shiftId: created.id,
      startLocal: '10:00',
      endLocal: '18:00',
      requiredSkill: null,
      headcount: 1,
      actor: { kind: 'system' } as const,
    }
    await updateShift({ ...edit, version: created.version })
    // Second manager still holding version 1.
    await expect(updateShift({ ...edit, version: created.version })).rejects.toBeInstanceOf(
      ConcurrentEditError,
    )
  })

  it('rolls the whole edit back when moving a shift would break rest', async () => {
    // A runs 14:00-22:00 local on Sep 1 (ends 02:00 local on Sep 2).
    const [a] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-09-01T18:00:00Z'),
        endsAt: new Date('2026-09-02T02:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id, version: shifts.version })
    // B runs 14:00-18:00 local on Sep 2: a 12-hour gap, which is legal.
    const [b] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-09-02T18:00:00Z'),
        endsAt: new Date('2026-09-02T22:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id, version: shifts.version })

    await assignStaffToShift({ shiftId: a.id, staffId, actor: { kind: 'system' } })
    await assignStaffToShift({ shiftId: b.id, staffId, actor: { kind: 'system' } })

    // Drag B back to 06:00 local, leaving 4 hours' rest where 10 is required.
    await expect(
      updateShift({
        shiftId: b.id,
        version: b.version,
        startLocal: '06:00',
        endLocal: '10:00',
        requiredSkill: null,
        headcount: 1,
        actor: { kind: 'system' },
      }),
    ).rejects.toBeInstanceOf(ConflictError)

    // Nothing half-applied.
    const after = await shiftRow(b.id)
    expect(after.version).toBe(1)
  })

  it('cancels an assignment without deleting the shift', async () => {
    const [created] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-10-01T13:00:00Z'),
        endsAt: new Date('2026-10-01T21:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id })
    const assignment = await assignStaffToShift({
      shiftId: created.id,
      staffId,
      actor: { kind: 'system' },
    })

    await unassign(assignment.id, db, { kind: 'system' })

    const [row] = await db.select().from(assignments).where(eq(assignments.id, assignment.id))
    expect(row.status).toBe('cancelled')
    // The seat is free again, so the same person can be put back on.
    await expect(
      assignStaffToShift({ shiftId: created.id, staffId, actor: { kind: 'system' } }),
    ).resolves.toBeTruthy()
  })

  it('deletes a shift and its assignments', async () => {
    const [created] = await db
      .insert(shifts)
      .values({
        locationId,
        startsAt: new Date('2026-11-01T13:00:00Z'),
        endsAt: new Date('2026-11-01T21:00:00Z'),
        headcount: 1,
      })
      .returning({ id: shifts.id, version: shifts.version })
    await assignStaffToShift({ shiftId: created.id, staffId, actor: { kind: 'system' } })

    await deleteShift(created.id, created.version, db, { kind: 'system' })

    expect(await db.select().from(shifts).where(eq(shifts.id, created.id))).toHaveLength(0)
    expect(
      await db.select().from(assignments).where(eq(assignments.shiftId, created.id)),
    ).toHaveLength(0)
  })
})
