import { sql } from 'drizzle-orm'
import type { Db, Tx } from '@/lib/db'
import type { EligibilityContext } from './eligibility'

export interface StaffEligibility {
  staffId: string
  context: EligibilityContext
}

/**
 * Eligibility context for one shift, for one staff member or for everyone.
 *
 * One round trip either way: assigning needs a single row, suggesting coverage
 * needs them all, and issuing a query per candidate would not scale past a
 * small roster. Wall-clock comparisons happen in Postgres against each staff
 * member's own timezone, so "09:00-17:00" keeps meaning that through DST.
 */
export async function loadEligibility(
  executor: Db | Tx,
  shiftId: string,
  staffId?: string,
): Promise<StaffEligibility[]> {
  const result = await executor.execute<{
    staff_id: string
    staff_name: string
    location_name: string
    required_skill: string | null
    staff_skills: string[] | null
    headcount: number
    active_assignments: number
    already_assigned: boolean
    certified: boolean
    within_availability: boolean | null
    weekday: string
    local_start: string
    local_end: string
  }>(sql`
    SELECT
      st.id AS staff_id,
      st.name AS staff_name,
      l.name  AS location_name,
      sh.required_skill,
      ARRAY(SELECT k.skill FROM staff_skills k WHERE k.staff_id = st.id ORDER BY k.skill) AS staff_skills,
      sh.headcount,
      (SELECT count(*)::int FROM assignments a
        WHERE a.shift_id = sh.id AND a.status = 'active')                        AS active_assignments,
      EXISTS (SELECT 1 FROM assignments a
        WHERE a.shift_id = sh.id AND a.staff_id = st.id AND a.status = 'active') AS already_assigned,
      EXISTS (SELECT 1 FROM certifications c
        WHERE c.staff_id = st.id AND c.location_id = sh.location_id
          AND c.effective_from <= sh.starts_at
          AND (c.revoked_at IS NULL OR c.revoked_at > sh.starts_at))             AS certified,
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM availability_rules r WHERE r.staff_id = st.id)
          THEN NULL
        ELSE EXISTS (
          SELECT 1 FROM availability_rules r
          WHERE r.staff_id = st.id
            AND r.weekday = EXTRACT(DOW FROM (sh.starts_at AT TIME ZONE st.availability_tz))::int
            AND r.start_local <= (sh.starts_at AT TIME ZONE st.availability_tz)::time
            AND r.end_local   >= (sh.ends_at   AT TIME ZONE st.availability_tz)::time
        ) AND NOT EXISTS (
          SELECT 1 FROM availability_exceptions e
          WHERE e.staff_id = st.id
            AND e.kind = 'unavailable'
            AND e.date = (sh.starts_at AT TIME ZONE st.availability_tz)::date
            AND e.start_local < (sh.ends_at   AT TIME ZONE st.availability_tz)::time
            AND e.end_local   > (sh.starts_at AT TIME ZONE st.availability_tz)::time
        )
      END AS within_availability,
      to_char(sh.starts_at AT TIME ZONE st.availability_tz, 'Dy')      AS weekday,
      to_char(sh.starts_at AT TIME ZONE st.availability_tz, 'HH24:MI') AS local_start,
      to_char(sh.ends_at   AT TIME ZONE st.availability_tz, 'HH24:MI') AS local_end
    FROM shifts sh
    JOIN locations l ON l.id = sh.location_id
    JOIN staff st ON (${staffId ?? null}::uuid IS NULL OR st.id = ${staffId ?? null}::uuid)
    WHERE sh.id = ${shiftId}
    ORDER BY st.name
  `)

  return result.rows.map((row) => ({
    staffId: row.staff_id,
    context: {
      staffName: row.staff_name,
      locationName: row.location_name,
      requiredSkill: row.required_skill,
      staffSkills: row.staff_skills ?? [],
      headcount: row.headcount,
      activeAssignments: row.active_assignments,
      alreadyAssigned: row.already_assigned,
      certifiedAtLocation: row.certified,
      withinAvailability: row.within_availability,
      localWindow: { weekday: row.weekday, start: row.local_start, end: row.local_end },
    },
  }))
}
