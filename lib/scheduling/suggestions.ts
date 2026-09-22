import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db } from '@/lib/db'
import { requireLocationAccess } from './access'
import { evaluateCompliance, evaluateEligibility } from './eligibility'
import { loadEligibility } from './eligibility-query'
import { NotFoundError } from './errors'

export interface Candidate {
  staffId: string
  name: string
  skills: string[]
  /** Hours already assigned in the shift's week, for spreading work fairly. */
  assignedHoursThisWeek: number
  desiredWeeklyHours: number
  /** Allowed, but the manager should see these before confirming. */
  warnings: string[]
}

export interface BlockedCandidate {
  staffId: string
  name: string
  reasons: string[]
}

export interface CoverageSuggestions {
  shiftId: string
  eligible: Candidate[]
  blocked: BlockedCandidate[]
}

/**
 * Who can cover this shift, and why everyone else cannot.
 *
 * The brief asks for alternatives when an assignment is refused ("Sarah is
 * unavailable, but John and Maria have the required skill and availability").
 * This runs the same rules the write path enforces, so a suggestion can never
 * disagree with what the service will accept.
 *
 * Eligible candidates are ordered by how far below their stated desired hours
 * they are, which puts the most under-scheduled person first.
 */
export async function suggestCoverage(
  shiftId: string,
  db: Db = defaultDb,
): Promise<CoverageSuggestions> {
  const [location] = (
    await db.execute<{ location_id: string }>(
      sql`SELECT location_id FROM shifts WHERE id = ${shiftId}`,
    )
  ).rows
  if (!location) throw new NotFoundError('Shift', shiftId)
  await requireLocationAccess(location.location_id, db)

  const candidates = await loadEligibility(db, shiftId)

  // Weekly load for fairness ordering, in the shift's own week.
  const load = await db.execute<{ staff_id: string; hours: string; desired: number }>(sql`
    SELECT st.id AS staff_id,
           COALESCE(SUM(EXTRACT(EPOCH FROM (a.ends_at - a.starts_at)) / 3600), 0) AS hours,
           st.desired_weekly_hours AS desired
    FROM staff st
    LEFT JOIN assignments a
      ON a.staff_id = st.id
     AND a.status = 'active'
     AND a.starts_at >= date_trunc('week', (SELECT starts_at FROM shifts WHERE id = ${shiftId}))
     AND a.starts_at <  date_trunc('week', (SELECT starts_at FROM shifts WHERE id = ${shiftId})) + interval '7 days'
    GROUP BY st.id, st.desired_weekly_hours
  `)
  const byStaff = new Map(
    load.rows.map((r) => [r.staff_id, { hours: Number(r.hours), desired: r.desired }] as const),
  )

  const eligible: Candidate[] = []
  const blocked: BlockedCandidate[] = []

  for (const { staffId, context } of candidates) {
    const violations = evaluateEligibility(context)
    const stats = byStaff.get(staffId) ?? { hours: 0, desired: 0 }

    if (violations.length === 0) {
      eligible.push({
        staffId,
        name: context.staffName,
        skills: context.staffSkills,
        assignedHoursThisWeek: stats.hours,
        desiredWeeklyHours: stats.desired,
        warnings: evaluateCompliance(context).map((w) => w.message),
      })
    } else if (!violations.some((v) => v.code === 'already_assigned')) {
      blocked.push({
        staffId,
        name: context.staffName,
        reasons: violations.map((v) => v.message),
      })
    }
  }

  // Clean candidates first, then by how far below their desired hours they are,
  // so the fair pick and the compliant pick are the same click.
  eligible.sort((a, b) => {
    if (a.warnings.length !== b.warnings.length) return a.warnings.length - b.warnings.length
    const shortfall = (c: Candidate) => c.desiredWeeklyHours - c.assignedHoursThisWeek
    return shortfall(b) - shortfall(a)
  })

  return { shiftId, eligible, blocked }
}
