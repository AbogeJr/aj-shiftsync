import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import {
  assignments, availabilityRules, certifications, locations, shifts, staff, staffSkills, swapRequests,
} from '@/lib/db/schema'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { updateShift } from '@/lib/scheduling/shifts'
import {
  acceptRequest, approveRequest, cancelRequest, expireStaleDrops,
  MAX_PENDING_REQUESTS, requestDrop, requestSwap,
} from '@/lib/scheduling/swaps'
import { ConflictError, SwapError } from '@/lib/scheduling/errors'

const TZ = 'America/New_York'
const SYS = { kind: 'system' } as const
let locationId: string
let alice: string
let bob: string
const suffix = () => Math.random().toString(36).slice(2, 10)

/** Far enough out that the 24h drop cutoff never bites. */
function future(daysAhead: number, hour: number) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + daysAhead)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

async function makeShift(startsAt: Date, endsAt: Date, headcount = 1) {
  const [s] = await db
    .insert(shifts)
    .values({ locationId, startsAt, endsAt, headcount, publishedAt: sql`now()` as never })
    .returning({ id: shifts.id, version: shifts.version })
  return s
}

async function statusOf(id: string) {
  const [r] = await db.select({ status: swapRequests.status }).from(swapRequests).where(eq(swapRequests.id, id))
  return r?.status
}

async function holderOf(shiftId: string) {
  const rows = await db.execute<{ staff_id: string }>(
    sql`SELECT staff_id FROM assignments WHERE shift_id = ${shiftId} AND status = 'active'`,
  )
  return rows.rows.map((r) => r.staff_id)
}

beforeAll(async () => {
  const [l] = await db.insert(locations).values({ name: `swap-${suffix()}`, timezone: TZ }).returning({ id: locations.id })
  locationId = l.id
  for (const name of ['Alice', 'Bob']) {
    const [p] = await db.insert(staff)
      .values({ name, email: `${name.toLowerCase()}-${suffix()}@example.test`, availabilityTz: TZ })
      .returning({ id: staff.id })
    if (name === 'Alice') alice = p.id
    else bob = p.id
    await db.insert(certifications).values({ staffId: p.id, locationId, effectiveFrom: new Date('2020-01-01') })
    // Wide availability so it is never the blocking rule here.
    await db.insert(availabilityRules).values(
      [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ staffId: p.id, weekday, startLocal: '00:00', endLocal: '23:59' })),
    )
  }
})

afterAll(async () => {
  await db.delete(locations).where(eq(locations.id, locationId))
  await db.delete(staff).where(eq(staff.id, alice))
  await db.delete(staff).where(eq(staff.id, bob))
  await pool.end()
})

describe('drop requests', () => {
  it('only the assignee may offer a shift up', async () => {
    const shift = await makeShift(future(10, 12), future(10, 18))
    const a = await assignStaffToShift({ shiftId: shift.id, staffId: alice, actor: SYS })
    await expect(
      requestDrop(a.id, null, db, { kind: 'system', staffId: bob }),
    ).rejects.toBeInstanceOf(SwapError)
    await db.delete(assignments).where(eq(assignments.shiftId, shift.id))
  })

  it('caps how many requests one person can have in flight', async () => {
    const created: string[] = []
    for (let i = 0; i < MAX_PENDING_REQUESTS; i++) {
      const shift = await makeShift(future(20 + i, 12), future(20 + i, 18))
      const a = await assignStaffToShift({ shiftId: shift.id, staffId: alice, actor: SYS })
      const r = await requestDrop(a.id, null, db, { kind: 'system', staffId: alice })
      created.push(r.id)
    }
    const extra = await makeShift(future(40, 12), future(40, 18))
    const a = await assignStaffToShift({ shiftId: extra.id, staffId: alice, actor: SYS })
    await expect(requestDrop(a.id, null, db, { kind: 'system', staffId: alice })).rejects.toThrow(
      /already have 3 requests/,
    )
    for (const id of created) await cancelRequest(id, db, { kind: 'system', staffId: alice })
    await db.delete(assignments).where(eq(assignments.staffId, alice))
  })

  it('refuses a drop inside the 24 hour cutoff, and expires unclaimed ones', async () => {
    const soon = new Date(Date.now() + 6 * 60 * 60 * 1000)
    const shift = await makeShift(soon, new Date(soon.getTime() + 4 * 60 * 60 * 1000))
    const a = await assignStaffToShift({ shiftId: shift.id, staffId: alice, actor: SYS })
    await expect(requestDrop(a.id, null, db, { kind: 'system', staffId: alice })).rejects.toThrow(
      /24 hours before/,
    )

    // One created legitimately, then back-dated past its expiry.
    const later = await makeShift(future(30, 12), future(30, 18))
    const b = await assignStaffToShift({ shiftId: later.id, staffId: alice, actor: SYS })
    const r = await requestDrop(b.id, null, db, { kind: 'system', staffId: alice })
    await db.execute(sql`UPDATE swap_requests SET expires_at = now() - interval '1 hour' WHERE id = ${r.id}`)
    expect(await expireStaleDrops(db)).toBeGreaterThanOrEqual(1)
    expect(await statusOf(r.id)).toBe('expired')
    await db.delete(assignments).where(eq(assignments.staffId, alice))
  })
})

describe('the full drop lifecycle', () => {
  it('lets a colleague claim a drop, then a manager approve the handover', async () => {
    const shift = await makeShift(future(90, 12), future(90, 18))
    const a = await assignStaffToShift({ shiftId: shift.id, staffId: alice, actor: SYS })

    const req = await requestDrop(a.id, 'dentist', db, { kind: 'system', staffId: alice })
    expect(await statusOf(req.id)).toBe('open')

    // Claiming names the claimant on a row created with nobody named: the
    // shape constraint has to allow that, or the claim fails.
    await acceptRequest(req.id, db, { kind: 'system', staffId: bob })
    expect(await statusOf(req.id)).toBe('peer_accepted')
    expect(await holderOf(shift.id)).toEqual([alice]) // still Alice until approval

    await approveRequest(req.id, SYS, db)
    expect(await statusOf(req.id)).toBe('approved')
    expect(await holderOf(shift.id)).toEqual([bob])

    await db.delete(assignments).where(eq(assignments.shiftId, shift.id))
  })
})

describe('claims from someone already on the shift', () => {
  it('refuses, rather than handing them a second seat', async () => {
    // Two seats, both taken. Bob cannot claim Alice's seat on a shift he is
    // already working - approval would give him two assignments on one shift.
    const shift = await makeShift(future(100, 12), future(100, 18), 2)
    const a = await assignStaffToShift({ shiftId: shift.id, staffId: alice, actor: SYS })
    await assignStaffToShift({ shiftId: shift.id, staffId: bob, actor: SYS })

    const req = await requestDrop(a.id, null, db, { kind: 'system', staffId: alice })
    await expect(
      acceptRequest(req.id, db, { kind: 'system', staffId: bob }),
    ).rejects.toBeInstanceOf(SwapError)

    expect(await statusOf(req.id)).toBe('open')
    await db.delete(assignments).where(eq(assignments.shiftId, shift.id))
  })
})

describe('the swap workflow', () => {
  it('leaves the original assignment in place until a manager approves', async () => {
    const s1 = await makeShift(future(50, 12), future(50, 18))
    const s2 = await makeShift(future(52, 12), future(52, 18))
    const a1 = await assignStaffToShift({ shiftId: s1.id, staffId: alice, actor: SYS })
    const a2 = await assignStaffToShift({ shiftId: s2.id, staffId: bob, actor: SYS })

    const req = await requestSwap(a1.id, a2.id, 'family thing', db, { kind: 'system', staffId: alice })
    expect(await statusOf(req.id)).toBe('open')
    expect(await holderOf(s1.id)).toEqual([alice]) // nothing moved yet

    await acceptRequest(req.id, db, { kind: 'system', staffId: bob })
    expect(await statusOf(req.id)).toBe('peer_accepted')
    expect(await holderOf(s1.id)).toEqual([alice]) // still nothing moved

    await approveRequest(req.id, SYS, db)
    expect(await statusOf(req.id)).toBe('approved')
    expect(await holderOf(s1.id)).toEqual([bob])
    expect(await holderOf(s2.id)).toEqual([alice])

    await db.delete(assignments).where(eq(assignments.shiftId, s1.id))
    await db.delete(assignments).where(eq(assignments.shiftId, s2.id))
  })

  it('lets the requester withdraw before approval (the regret swap)', async () => {
    const s1 = await makeShift(future(60, 12), future(60, 18))
    const s2 = await makeShift(future(62, 12), future(62, 18))
    const a1 = await assignStaffToShift({ shiftId: s1.id, staffId: alice, actor: SYS })
    const a2 = await assignStaffToShift({ shiftId: s2.id, staffId: bob, actor: SYS })

    const req = await requestSwap(a1.id, a2.id, null, db, { kind: 'system', staffId: alice })
    await acceptRequest(req.id, db, { kind: 'system', staffId: bob })

    await cancelRequest(req.id, db, { kind: 'system', staffId: alice })
    expect(await statusOf(req.id)).toBe('cancelled')
    // The schedule is untouched, which is the whole point of deferring the move.
    expect(await holderOf(s1.id)).toEqual([alice])
    expect(await holderOf(s2.id)).toEqual([bob])

    await expect(approveRequest(req.id, SYS, db)).rejects.toBeInstanceOf(SwapError)
    await db.delete(assignments).where(eq(assignments.shiftId, s1.id))
    await db.delete(assignments).where(eq(assignments.shiftId, s2.id))
  })

  it('cancels a pending request when the manager edits the shift', async () => {
    const s1 = await makeShift(future(70, 12), future(70, 18))
    const s2 = await makeShift(future(72, 12), future(72, 18))
    const a1 = await assignStaffToShift({ shiftId: s1.id, staffId: alice, actor: SYS })
    const a2 = await assignStaffToShift({ shiftId: s2.id, staffId: bob, actor: SYS })
    const req = await requestSwap(a1.id, a2.id, null, db, { kind: 'system', staffId: alice })

    await updateShift({
      shiftId: s1.id, version: s1.version,
      startLocal: '13:00', endLocal: '19:00', requiredSkill: null, headcount: 1,
      actor: SYS,
    })

    expect(await statusOf(req.id)).toBe('cancelled')
    await db.delete(assignments).where(eq(assignments.shiftId, s1.id))
    await db.delete(assignments).where(eq(assignments.shiftId, s2.id))
  })

  it('rolls approval back if the trade would break the rest rule', async () => {
    // Bob already works the evening before Alice's shift, so taking hers would
    // leave him under 10 hours' rest.
    const s1 = await makeShift(future(80, 12), future(80, 18))
    const s2 = await makeShift(future(82, 12), future(82, 18))
    const blocker = await makeShift(future(80, 2), future(80, 8))
    const a1 = await assignStaffToShift({ shiftId: s1.id, staffId: alice, actor: SYS })
    const a2 = await assignStaffToShift({ shiftId: s2.id, staffId: bob, actor: SYS })

    const req = await requestSwap(a1.id, a2.id, null, db, { kind: 'system', staffId: alice })
    await acceptRequest(req.id, db, { kind: 'system', staffId: bob })
    // Only now does Bob pick up the conflicting early shift.
    await assignStaffToShift({ shiftId: blocker.id, staffId: bob, actor: SYS })

    await expect(approveRequest(req.id, SYS, db)).rejects.toBeInstanceOf(ConflictError)
    expect(await holderOf(s1.id)).toEqual([alice]) // unchanged
    expect(await statusOf(req.id)).toBe('peer_accepted')

    for (const s of [s1.id, s2.id, blocker.id]) {
      await db.delete(assignments).where(eq(assignments.shiftId, s))
    }
  })
})
