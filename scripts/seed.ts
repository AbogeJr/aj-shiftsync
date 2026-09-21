// Seed stub: four locations and the demo sign-in accounts. `npm run seed`.
import { pool, db } from '@/lib/db'
import { locations, managerLocations, skills, staff } from '@/lib/db/schema'
import { DEMO_ACCOUNTS } from '@/lib/auth'

const SKILLS = [
  { name: 'bartender', description: 'Mixes and serves drinks' },
  { name: 'line cook', description: 'Works the hot line' },
  { name: 'server', description: 'Takes orders and runs food' },
  { name: 'host', description: 'Seats guests and manages the waitlist' },
]

const LOCATIONS = [
  { name: 'Mission Bay', timezone: 'America/Los_Angeles' },
  { name: 'Santa Monica', timezone: 'America/Los_Angeles' },
  { name: 'West Village', timezone: 'America/New_York' },
  { name: 'Back Bay', timezone: 'America/New_York' },
]

async function main() {
  await db.insert(skills).values(SKILLS).onConflictDoNothing()
  console.log(`skills: ${SKILLS.map((s) => s.name).join(', ')}`)

  const insertedLocations = await db
    .insert(locations)
    .values(LOCATIONS)
    .returning({ id: locations.id, name: locations.name, timezone: locations.timezone })

  for (const location of insertedLocations) {
    console.log(`${location.id}  ${location.timezone.padEnd(20)}  ${location.name}`)
  }

  // Re-runnable: onConflictDoUpdate keeps the email unique index happy.
  const insertedStaff = await db
    .insert(staff)
    .values(
      DEMO_ACCOUNTS.map((account) => ({
        name: account.name,
        email: account.email,
        role: account.role,
        availabilityTz: 'America/Los_Angeles',
        desiredWeeklyHours: 40,
      })),
    )
    .onConflictDoUpdate({ target: staff.email, set: { name: staff.name } })
    .returning({ id: staff.id, email: staff.email, role: staff.role })

  for (const member of insertedStaff) {
    console.log(`${member.id}  ${member.role.padEnd(20)}  ${member.email}`)
  }

  // Give the demo manager locations to authorize against.
  const manager = insertedStaff.find((m) => m.role === 'manager')
  if (manager) {
    await db
      .insert(managerLocations)
      .values(insertedLocations.map((l) => ({ staffId: manager.id, locationId: l.id })))
      .onConflictDoNothing()
  }

  // TODO: skills, certifications, availability rules with a DST-crossing week,
  // and a few published shifts.
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
