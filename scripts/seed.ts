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
  ['Avery Admin', 'admin', 'America/Los_Angeles', 0, 6000, [], ['mission', 'santa', 'village', 'backbay']],
  ['Morgan Manager', 'manager', 'America/Los_Angeles', 40, 4200, ['server'], ['mission', 'santa']],
  ['Sam Staff', 'staff', 'America/Los_Angeles', 32, 2100, ['server', 'host'], ['mission']],
  ['Rosa Alvarez', 'staff', 'America/Los_Angeles', 40, 2600, ['line cook'], ['mission', 'santa']],
  ['Dev Patel', 'staff', 'America/Los_Angeles', 24, 2400, ['bartender', 'server'], ['santa']],
  ['Kim Nguyen', 'staff', 'America/Los_Angeles', 40, 2300, ['server'], ['mission', 'santa']],
  ['Theo Brooks', 'staff', 'America/New_York', 36, 2500, ['line cook', 'server'], ['village', 'backbay']],
  ['Nina Okafor', 'staff', 'America/New_York', 40, 2700, ['bartender'], ['village']],
  ['Priya Shah', 'staff', 'America/New_York', 20, 2200, ['host', 'server'], ['backbay']],
  ['Marco Rossi', 'manager', 'America/New_York', 40, 4400, ['line cook'], ['village', 'backbay']],
  // Certified in BOTH timezones - the brief's "Timezone Tangle" scenario.
  ['Jordan Cross', 'staff', 'America/Los_Angeles', 38, 2800, ['server', 'bartender'], ['santa', 'village']],
] as const

async function main() {
  // Dependency order.
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
      staffId: staffId.get('Morgan Manager')!,
      locationId: locId.get(k)!,
    })),
    ...['village', 'backbay'].map((k) => ({
      staffId: staffId.get('Marco Rossi')!,
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

  // A week of shifts. Some published, some still draft.
  const monday = mondayOfThisWeek()
  const plan: Array<[string, number, string, string, string, number, boolean]> = [
    // location, day offset, start, end, skill, headcount, published
    ['mission', 0, '09:00', '17:00', 'server', 2, true],
    ['mission', 1, '09:00', '17:00', 'line cook', 1, true],
    ['mission', 2, '11:00', '19:00', 'server', 2, true],
    ['mission', 3, '09:00', '17:00', 'host', 1, false],
    ['mission', 4, '16:00', '23:00', 'server', 2, false],
    ['mission', 5, '16:00', '23:00', 'bartender', 1, false],
    ['santa', 0, '10:00', '18:00', 'server', 1, true],
    ['santa', 2, '10:00', '18:00', 'bartender', 1, true],
    ['santa', 4, '17:00', '23:00', 'server', 2, false],
    ['village', 1, '09:00', '17:00', 'line cook', 1, true],
    ['village', 3, '12:00', '20:00', 'bartender', 1, true],
    ['village', 5, '17:00', '23:00', 'server', 2, false],
    ['backbay', 2, '09:00', '17:00', 'host', 1, true],
    ['backbay', 4, '16:00', '23:00', 'line cook', 1, false],
  ]

  const insertedShifts = await db
    .insert(shifts)
    .values(
      plan.map(([key, offset, start, end, skill, headcount, published]) => {
        const tz = locTz.get(key)!
        const date = dayString(monday, offset)
        return {
          locationId: locId.get(key)!,
          startsAt: localInstant(date, start, tz) as never,
          endsAt: localInstant(date, end, tz) as never,
          requiredSkill: skill,
          headcount,
          publishedAt: published ? (sql`now()` as never) : null,
        }
      }),
    )
    .returning({ id: shifts.id, locationId: shifts.locationId, startsAt: shifts.startsAt, endsAt: shifts.endsAt })

  // Fill a few shifts. Times are copied from the shift, as assign.ts does.
  const fills: Array<[number, string]> = [
    [0, 'Sam Staff'],
    [0, 'Kim Nguyen'],
    [1, 'Rosa Alvarez'],
    [2, 'Kim Nguyen'],
    [6, 'Dev Patel'],
    // Jordan works BOTH a Pacific and an Eastern location in the same week:
    // the brief's Timezone Tangle, and what cross-location load looks like.
    [7, 'Jordan Cross'],
    [11, 'Jordan Cross'],
    [9, 'Theo Brooks'],
    [10, 'Nina Okafor'],
    [12, 'Priya Shah'],
  ]
  await db.insert(assignments).values(
    fills.map(([shiftIndex, name]) => ({
      shiftId: insertedShifts[shiftIndex].id,
      staffId: staffId.get(name)!,
      startsAt: insertedShifts[shiftIndex].startsAt,
      endsAt: insertedShifts[shiftIndex].endsAt,
    })),
  )

  console.log(`week of ${dayString(monday, 0)}`)
  console.log(`  ${SKILLS.length} skills, ${insertedLocations.length} locations`)
  console.log(`  ${insertedStaff.length} staff, ${insertedShifts.length} shifts, ${fills.length} assignments`)
  for (const a of DEMO_ACCOUNTS) console.log(`  login: ${a.role.padEnd(8)} ${a.email}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
