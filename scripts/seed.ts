/**
 * Seeds a known demo dataset. DESTRUCTIVE: clears its own tables first so the
 * result is the same every run. `npm run seed`.
 *
 * Shift instants are built by Postgres from a local wall-clock time in the
 * location's own timezone (`'2026-09-21 09:00'::timestamp AT TIME ZONE tz`),
 * which is the only way "9am at this restaurant" stays correct across DST.
 */
import { sql } from 'drizzle-orm'
import { pool, db } from '@/lib/db'
import {
  assignments,
  availabilityRules,
  certifications,
  locations,
  managerLocations,
  shifts,
  skills,
  staff,
  staffSkills,
} from '@/lib/db/schema'
import { DEMO_ACCOUNTS } from '@/lib/auth'

const SKILLS = [
  { name: 'bartender', description: 'Mixes and serves drinks' },
  { name: 'line cook', description: 'Works the hot line' },
  { name: 'server', description: 'Takes orders and runs food' },
  { name: 'host', description: 'Seats guests and manages the waitlist' },
]

const LOCATIONS = [
  { key: 'mission', name: 'Mission Bay', timezone: 'America/Los_Angeles' },
  { key: 'santa', name: 'Santa Monica', timezone: 'America/Los_Angeles' },
  { key: 'village', name: 'West Village', timezone: 'America/New_York' },
  { key: 'backbay', name: 'Back Bay', timezone: 'America/New_York' },
]

/** Monday of the current week, as a plain local date string. */
function mondayOfThisWeek(): Date {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dow = d.getUTCDay() // 0 = Sunday
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7))
  return d
}

function dayString(monday: Date, offset: number): string {
  const d = new Date(monday)
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

/** A timestamptz for `HH:MM` local time on `date` in `tz`. */
function localInstant(date: string, time: string, tz: string) {
  return sql`(${`${date} ${time}`}::timestamp AT TIME ZONE ${tz})`
}

const PEOPLE = [
  // name, role, tz, desired hrs, rate (cents), skills, certified at
  ['Michael Scott', 'admin', 'America/Los_Angeles', 0, 6000, [], ['mission', 'santa', 'village', 'backbay']],
  ['Pam Beesly', 'manager', 'America/Los_Angeles', 40, 4200, ['server'], ['mission', 'santa']],
  ['Jim Halpert', 'staff', 'America/Los_Angeles', 32, 2100, ['server', 'host'], ['mission']],
  ['Dwight Schrute', 'staff', 'America/Los_Angeles', 40, 2600, ['line cook'], ['mission', 'santa']],
  ['Kevin Malone', 'staff', 'America/Los_Angeles', 24, 2400, ['bartender', 'server'], ['santa']],
  ['Angela Martin', 'staff', 'America/Los_Angeles', 40, 2300, ['server'], ['mission', 'santa']],
  ['Stanley Hudson', 'staff', 'America/New_York', 36, 2500, ['line cook', 'server'], ['village', 'backbay']],
  ['Phyllis Vance', 'staff', 'America/New_York', 40, 2700, ['bartender'], ['village']],
  ['Kelly Kapoor', 'staff', 'America/New_York', 20, 2200, ['host', 'server'], ['backbay']],
  ['Andy Bernard', 'manager', 'America/New_York', 40, 4400, ['line cook'], ['village', 'backbay']],
  // Certified in BOTH timezones, so one availability window spans two clocks.
  ['Oscar Martinez', 'staff', 'America/Los_Angeles', 38, 2800, ['server', 'bartender'], ['santa', 'village']],
] as const

async function main() {
  // Dependency order. audit_log is SET NULL on its references rather than
  // cascading, so it survives a reseed unless cleared explicitly.
  await db.execute(sql`TRUNCATE audit_log`)
  await db.delete(assignments)
  await db.delete(shifts)
  await db.delete(availabilityRules)
  await db.delete(certifications)
  await db.delete(managerLocations)
  await db.delete(staffSkills)
  await db.delete(staff)
  await db.delete(locations)
  await db.delete(skills)

  await db.insert(skills).values(SKILLS)

  const insertedLocations = await db
    .insert(locations)
    .values(LOCATIONS.map(({ name, timezone }) => ({ name, timezone })))
    .returning({ id: locations.id, name: locations.name, timezone: locations.timezone })
  const locId = new Map(
    LOCATIONS.map((l, i) => [l.key, insertedLocations[i].id] as const),
  )
  const locTz = new Map(LOCATIONS.map((l) => [l.key, l.timezone] as const))

  const demoEmail = new Map(DEMO_ACCOUNTS.map((a) => [a.name, a.email] as const))
  const insertedStaff = await db
    .insert(staff)
    .values(
      PEOPLE.map(([name, role, tz, desired, rate]) => ({
        name,
        email:
          demoEmail.get(name) ??
          `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@shiftsync.test`,
        role,
        availabilityTz: tz,
        desiredWeeklyHours: desired,
        hourlyRateCents: rate,
      })),
    )
    .returning({ id: staff.id, name: staff.name })
  const staffId = new Map(insertedStaff.map((s) => [s.name, s.id] as const))

  await db.insert(staffSkills).values(
    PEOPLE.flatMap(([name, , , , , personSkills]) =>
      personSkills.map((skill) => ({ staffId: staffId.get(name)!, skill })),
    ),
  )

  const now = new Date()
  await db.insert(certifications).values(
    PEOPLE.flatMap(([name, , , , , , certs]) =>
      certs.map((key) => ({
        staffId: staffId.get(name)!,
        locationId: locId.get(key)!,
        effectiveFrom: new Date(now.getFullYear() - 1, 0, 1),
      })),
    ),
  )

  await db.insert(managerLocations).values([
    ...['mission', 'santa'].map((k) => ({
      staffId: staffId.get('Pam Beesly')!,
      locationId: locId.get(k)!,
    })),
    ...['village', 'backbay'].map((k) => ({
      staffId: staffId.get('Andy Bernard')!,
      locationId: locId.get(k)!,
    })),
  ])

  // Weekday availability, in each person's own wall-clock time.
  await db.insert(availabilityRules).values(
    PEOPLE.flatMap(([name]) =>
      [1, 2, 3, 4, 5, 6].map((weekday) => ({
        staffId: staffId.get(name)!,
        weekday,
        startLocal: '08:00',
        endLocal: '23:00',
      })),
    ),
  )

  // A week of shifts, keyed so the fills below read as names rather than
  // indexes into a long array.
  const monday = mondayOfThisWeek()
  type Shift = [key: string, loc: string, day: number, start: string, end: string, skill: string | null, headcount: number, published: boolean]
  const plan: Shift[] = [
    // Mission Bay: a full service week, so one location always looks busy.
    ['m-mon', 'mission', 0, '09:00', '17:00', 'server', 2, true],
    ['m-tue', 'mission', 1, '09:00', '17:00', 'server', 2, true],
    ['m-wed', 'mission', 2, '09:00', '17:00', 'server', 2, true],
    ['m-thu', 'mission', 3, '09:00', '17:00', 'server', 2, true],
    ['m-fri', 'mission', 4, '09:00', '17:00', 'server', 2, true],
    ['m-sat', 'mission', 5, '09:00', '17:00', 'server', 2, true],
    ['m-mon-cook', 'mission', 0, '10:00', '18:00', 'line cook', 1, true],
    ['m-wed-cook', 'mission', 2, '10:00', '18:00', 'line cook', 1, true],
    ['m-thu-host', 'mission', 3, '11:00', '19:00', 'host', 1, true],
    ['m-fri-eve', 'mission', 4, '17:00', '23:00', 'server', 2, true],
    ['m-sat-eve', 'mission', 5, '17:00', '23:00', 'server', 2, true],
    ['m-sun', 'mission', 6, '10:00', '18:00', 'server', 2, false],

    ['s-mon', 'santa', 0, '10:00', '18:00', 'server', 1, true],
    ['s-tue', 'santa', 1, '10:00', '18:00', 'bartender', 1, true],
    ['s-wed', 'santa', 2, '10:00', '18:00', 'server', 1, true],
    ['s-thu', 'santa', 3, '16:00', '22:00', 'bartender', 1, true],
    ['s-fri-eve', 'santa', 4, '17:00', '23:00', 'server', 2, true],
    ['s-sat-eve', 'santa', 5, '17:00', '23:00', 'bartender', 1, true],

    ['v-mon', 'village', 0, '09:00', '17:00', 'line cook', 1, true],
    ['v-tue', 'village', 1, '12:00', '20:00', 'bartender', 1, true],
    ['v-wed', 'village', 2, '09:00', '17:00', 'server', 1, true],
    ['v-thu', 'village', 3, '12:00', '20:00', 'bartender', 1, true],
    ['v-thu-srv', 'village', 3, '09:00', '17:00', 'server', 1, true],
    ['v-fri-eve', 'village', 4, '17:00', '23:00', 'server', 2, true],
    ['v-sat-eve', 'village', 5, '18:00', '23:00', 'bartender', 1, true],

    ['b-mon', 'backbay', 0, '09:00', '17:00', 'host', 1, true],
    ['b-tue', 'backbay', 1, '09:00', '17:00', 'server', 1, true],
    ['b-wed', 'backbay', 2, '09:00', '17:00', 'host', 1, true],
    ['b-thu-cook', 'backbay', 3, '16:00', '23:00', 'line cook', 1, true],
    ['b-fri-cook', 'backbay', 4, '09:00', '17:00', 'line cook', 1, true],
    ['b-fri-eve', 'backbay', 4, '17:00', '23:00', 'server', 2, true],
    ['b-sat-eve', 'backbay', 5, '17:00', '23:00', 'server', 1, true],
    ['b-sat-cook', 'backbay', 5, '09:00', '17:00', 'line cook', 1, false],
  ]

  const insertedShifts = await db
    .insert(shifts)
    .values(
      plan.map(([, loc, offset, start, end, skill, headcount, published]) => {
        const tz = locTz.get(loc)!
        const date = dayString(monday, offset)
        return {
          locationId: locId.get(loc)!,
          startsAt: localInstant(date, start, tz) as never,
          endsAt: localInstant(date, end, tz) as never,
          requiredSkill: skill,
          headcount,
          publishedAt: published ? (sql`now()` as never) : null,
        }
      }),
    )
    .returning({ id: shifts.id, startsAt: shifts.startsAt, endsAt: shifts.endsAt })

  const shiftOf = new Map(plan.map(([key], i) => [key, insertedShifts[i]]))

  // Deliberately uneven, so the dashboard has something to say on first load:
  //   Angela  6 days straight, 48h  -> overtime, and a 6th consecutive day
  //   Stanley 36h                   -> at the warning threshold, no overtime
  //   Jim     both Mission evenings -> skews the premium-shift fairness score
  //   Dwight  nothing but the live shift below -> far under his desired hours
  // Every pairing keeps 10 hours clear; b-fri-eve into b-sat-cook is exactly
  // 10, which the half-open constraint allows on purpose.
  const fills: Array<[string, string]> = [
    ['m-mon', 'Angela Martin'], ['m-tue', 'Angela Martin'], ['m-wed', 'Angela Martin'],
    ['m-thu', 'Angela Martin'], ['m-fri', 'Angela Martin'], ['m-sat', 'Angela Martin'],
    ['m-mon', 'Jim Halpert'],
    ['m-thu-host', 'Jim Halpert'],
    ['m-fri-eve', 'Jim Halpert'],
    ['m-sat-eve', 'Jim Halpert'],

    ['s-mon', 'Kevin Malone'], ['s-tue', 'Kevin Malone'], ['s-thu', 'Kevin Malone'],
    ['s-fri-eve', 'Kevin Malone'],
    // Oscar works one Pacific and one Eastern location in the same week, on a
    // single availability window: cross-timezone load, visible on Team.
    ['s-wed', 'Oscar Martinez'], ['s-sat-eve', 'Oscar Martinez'], ['v-fri-eve', 'Oscar Martinez'],

    ['v-mon', 'Andy Bernard'], ['b-thu-cook', 'Andy Bernard'], ['b-fri-cook', 'Andy Bernard'],
    ['b-tue', 'Stanley Hudson'], ['v-wed', 'Stanley Hudson'], ['v-thu-srv', 'Stanley Hudson'],
    ['b-fri-eve', 'Stanley Hudson'], ['b-sat-eve', 'Stanley Hudson'],
    ['v-tue', 'Phyllis Vance'], ['v-thu', 'Phyllis Vance'], ['v-sat-eve', 'Phyllis Vance'],
    ['b-mon', 'Kelly Kapoor'], ['b-wed', 'Kelly Kapoor'],
  ]
  await db.insert(assignments).values(
    fills.map(([key, name]) => ({
      shiftId: shiftOf.get(key)!.id,
      staffId: staffId.get(name)!,
      startsAt: shiftOf.get(key)!.startsAt,
      endsAt: shiftOf.get(key)!.endsAt,
    })),
  )

  // A shift running RIGHT NOW, so the on-duty board always has something to
  // show. Pam and Dwight hold no other seeded shift, which is what makes this
  // safe: the window moves with the clock, and anyone with a fixed shift the
  // same day would sooner or later overlap it and trip the rest constraint.
  // No required skill, because the pair is chosen for availability, not trade.
  const nowStart = new Date(Date.now() - 90 * 60 * 1000)
  const nowEnd = new Date(Date.now() + 6 * 60 * 60 * 1000)
  const [liveShift] = await db
    .insert(shifts)
    .values({
      locationId: locId.get('mission')!,
      startsAt: nowStart,
      endsAt: nowEnd,
      requiredSkill: null,
      headcount: 3,
      publishedAt: sql`now()` as never,
    })
    .returning({ id: shifts.id })

  await db.execute(sql`
    INSERT INTO assignments (shift_id, staff_id, status, starts_at, ends_at, clocked_in_at)
    VALUES (${liveShift.id}, ${staffId.get('Pam Beesly')!}, 'active',
            ${nowStart.toISOString()}, ${nowEnd.toISOString()},
            ${new Date(nowStart.getTime() + 20 * 60 * 1000).toISOString()}),
           (${liveShift.id}, ${staffId.get('Dwight Schrute')!}, 'active',
            ${nowStart.toISOString()}, ${nowEnd.toISOString()}, NULL)
  `)
  await db.execute(sql`
    INSERT INTO swap_requests (assignment_id, requested_by, requested_to, target_assignment_id, kind, status, reason)
    SELECT mine.id, ${staffId.get('Jim Halpert')!}, ${staffId.get('Angela Martin')!}, theirs.id,
           'swap', 'peer_accepted', 'Family thing on Saturday night.'
    FROM assignments mine, assignments theirs
    WHERE mine.shift_id = ${shiftOf.get('m-sat-eve')!.id} AND mine.staff_id = ${staffId.get('Jim Halpert')!}
      AND theirs.shift_id = ${shiftOf.get('m-sat')!.id} AND theirs.staff_id = ${staffId.get('Angela Martin')!}
  `)
  await db.execute(sql`
    INSERT INTO swap_requests (assignment_id, requested_by, kind, status, reason, expires_at)
    SELECT a.id, ${staffId.get('Phyllis Vance')!}, 'drop', 'open',
           'Double booked, sorry.', now() + interval '18 hours'
    FROM assignments a
    WHERE a.shift_id = ${shiftOf.get('v-thu')!.id} AND a.staff_id = ${staffId.get('Phyllis Vance')!}
  `)

  await db.execute(sql`
    INSERT INTO notifications (staff_id, type, payload) VALUES
      (${staffId.get('Jim Halpert')!}, 'schedule.published',
       '{"title":"Your schedule has been published","body":"4 shifts this week."}'),
      (${staffId.get('Jim Halpert')!}, 'shift.assigned',
       '{"title":"You have a new shift","body":"Saturday evening at Mission Bay."}'),
      (${staffId.get('Angela Martin')!}, 'swap.requested',
       '{"title":"Jim Halpert wants to swap with you","body":"Saturday evening for your Saturday day shift."}'),
      (${staffId.get('Pam Beesly')!}, 'swap.accepted',
       '{"title":"A swap is ready for your approval","body":"Jim Halpert and Angela Martin have agreed."}'),
      (${staffId.get('Andy Bernard')!}, 'compliance.warning',
       '{"title":"A shift was offered up","body":"Phyllis Vance, Thursday at West Village."}')
  `)

  console.log(`week of ${dayString(monday, 0)}`)
  console.log(`  ${SKILLS.length} skills, ${insertedLocations.length} locations`)
  console.log(`  ${insertedStaff.length} staff, ${insertedShifts.length + 1} shifts, ${fills.length + 2} assignments`)
  console.log(`  1 shift running now (Mission Bay), 1 swap awaiting approval, 1 drop expiring`)
  for (const a of DEMO_ACCOUNTS) console.log(`  login: ${a.role.padEnd(8)} ${a.email}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
