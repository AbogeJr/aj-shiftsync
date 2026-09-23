import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db, type Tx } from '@/lib/db'
import { getSession, requireRole } from '@/lib/auth'
import { requireLocationAccess } from './access'
import { listAccessibleLocations } from './schedule'

/**
 * The audit trail.
 *
 * Rows outlive what they describe: entity_type/entity_id are polymorphic with
 * no foreign key, and actor/location are ON DELETE SET NULL, so deleting a
 * shift or a staff member never erases the record of what was done.
 */

export interface AuditInput {
  locationId: string | null
  entityType: string
  entityId: string
  action: string
  before?: unknown
  after?: unknown
}

/** Writes with the caller's transaction where there is one, so it rolls back with the change. */
export async function recordAudit(executor: Db | Tx, input: AuditInput): Promise<void> {
  const actorId = (await getSession().catch(() => null))?.userId ?? null
  await executor.execute(sql`
    INSERT INTO audit_log (actor_staff_id, location_id, entity_type, entity_id, action, before, after)
    VALUES (${actorId}, ${input.locationId}, ${input.entityType}, ${input.entityId}, ${input.action},
            ${input.before === undefined ? null : JSON.stringify(input.before)}::jsonb,
            ${input.after === undefined ? null : JSON.stringify(input.after)}::jsonb)
  `)
}

export interface AuditEntry {
  id: string
  at: string
  actor: string
  action: string
  entityType: string
  entityId: string
  location: string | null
  before: string | null
  after: string | null
}

export interface AuditQuery {
  from?: string
  to?: string
  locationId?: string
}

/**
 * A GET form submits its untouched fields as empty strings, so "no filter"
 * arrives as '' rather than undefined. Passed through, that reaches Postgres as
 * ''::uuid or ''::date, which is a syntax error rather than a no-op.
 */
function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** One place for the projection, so the trail and a single shift's history agree. */
interface AuditRow extends Record<string, unknown> {
  id: string
  at: string
  actor: string | null
  action: string
  entity_type: string
  entity_id: string
  location: string | null
  before: string | null
  after: string | null
}

const AUDIT_SELECT = sql`
  SELECT al.id, to_char(al.created_at, 'YYYY-MM-DD HH24:MI') AS at,
         st.name AS actor, al.action, al.entity_type, al.entity_id,
         l.name AS location, al.before::text, al.after::text
  FROM audit_log al
  LEFT JOIN staff st ON st.id = al.actor_staff_id
  LEFT JOIN locations l ON l.id = al.location_id
`

function toEntry(r: AuditRow): AuditEntry {
  return {
    id: r.id,
    at: r.at,
    actor: r.actor ?? 'system',
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    location: r.location,
    before: r.before,
    after: r.after,
  }
}

/** Audit rows for locations the caller can see. */
export async function auditTrail(
  query: AuditQuery,
  limit = 200,
  db: Db = defaultDb,
): Promise<AuditEntry[]> {
  await requireRole('admin', 'manager')
  const scope = (await listAccessibleLocations(db)).map((l) => l.id)
  if (scope.length === 0) return []
  const locationId = blankToNull(query.locationId)
  const from = blankToNull(query.from)
  const to = blankToNull(query.to)
  if (locationId) await requireLocationAccess(locationId, db)

  const rows = await db.execute<AuditRow>(sql`
    ${AUDIT_SELECT}
    WHERE (al.location_id IS NULL OR al.location_id = ANY(${sql.param(scope)}::uuid[]))
      AND (${locationId}::uuid IS NULL OR al.location_id = ${locationId}::uuid)
      AND (${from}::date IS NULL OR al.created_at >= ${from}::date)
      AND (${to}::date IS NULL OR al.created_at < ${to}::date + 1)
    ORDER BY al.created_at DESC
    LIMIT ${limit}
  `)

  return rows.rows.map(toEntry)
}

/**
 * History of one shift.
 *
 * Matching happens in SQL rather than by filtering a page of the general trail:
 * a shift's own entries can be arbitrarily far back, so any LIMIT applied before
 * the filter silently truncates its history.
 *
 * Three ways an entry can belong to a shift: it names the shift directly, or it
 * is an assignment whose before/after state mentions the shift id. The JSON is
 * matched as text because the shape differs per action, and a uuid is specific
 * enough that a substring match cannot collide.
 */
export async function shiftHistory(shiftId: string, db: Db = defaultDb): Promise<AuditEntry[]> {
  await requireRole('admin', 'manager')
  const scope = (await listAccessibleLocations(db)).map((l) => l.id)
  if (scope.length === 0) return []

  const shift = await db.execute<{ location_id: string | null }>(
    sql`SELECT location_id FROM shifts WHERE id = ${shiftId}`,
  )
  // A deleted shift leaves no row to authorize against, so the scope filter
  // below is what keeps its history from leaking to another manager.
  const locationId = shift.rows[0]?.location_id
  if (locationId) await requireLocationAccess(locationId, db)

  const rows = await db.execute<AuditRow>(sql`
    ${AUDIT_SELECT}
    WHERE (al.location_id IS NULL OR al.location_id = ANY(${sql.param(scope)}::uuid[]))
      AND (al.entity_id = ${shiftId}
           OR al.after::text  LIKE '%' || ${shiftId}::text || '%'
           OR al.before::text LIKE '%' || ${shiftId}::text || '%')
    ORDER BY al.created_at DESC
  `)
  return rows.rows.map(toEntry)
}

function csvCell(value: string | null): string {
  const text = value ?? ''
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Admin-only CSV export. */
export async function exportAuditCsv(query: AuditQuery, db: Db = defaultDb): Promise<string> {
  await requireRole('admin')
  const entries = await auditTrail(query, 10_000, db)
  const header = ['timestamp', 'actor', 'action', 'entity_type', 'entity_id', 'location', 'before', 'after']
  const lines = entries.map((e) =>
    [e.at, e.actor, e.action, e.entityType, e.entityId, e.location, e.before, e.after]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...lines].join('\n')
}
