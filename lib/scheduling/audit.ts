import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db, type Tx } from '@/lib/db'
import { getSession, requireRole } from '@/lib/auth'
import { requireLocationAccess } from './access'
import { listAccessibleLocations } from './schedule'

/**
 * The audit trail (brief §9).
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

/** Audit rows for locations the caller can see. */
export async function auditTrail(
  query: AuditQuery,
  limit = 200,
  db: Db = defaultDb,
): Promise<AuditEntry[]> {
  await requireRole('admin', 'manager')
  const scope = (await listAccessibleLocations(db)).map((l) => l.id)
  if (scope.length === 0) return []
  if (query.locationId) await requireLocationAccess(query.locationId, db)

  const rows = await db.execute<{
    id: string
    at: string
    actor: string | null
    action: string
    entity_type: string
    entity_id: string
    location: string | null
    before: string | null
    after: string | null
  }>(sql`
    SELECT al.id, to_char(al.created_at, 'YYYY-MM-DD HH24:MI') AS at,
           st.name AS actor, al.action, al.entity_type, al.entity_id,
           l.name AS location, al.before::text, al.after::text
    FROM audit_log al
    LEFT JOIN staff st ON st.id = al.actor_staff_id
    LEFT JOIN locations l ON l.id = al.location_id
    WHERE (al.location_id IS NULL OR al.location_id = ANY(${sql.param(scope)}::uuid[]))
      AND (${query.locationId ?? null}::uuid IS NULL OR al.location_id = ${query.locationId ?? null}::uuid)
      AND (${query.from ?? null}::date IS NULL OR al.created_at >= ${query.from ?? null}::date)
      AND (${query.to ?? null}::date IS NULL OR al.created_at < ${query.to ?? null}::date + 1)
    ORDER BY al.created_at DESC
    LIMIT ${limit}
  `)

  return rows.rows.map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor ?? 'system',
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    location: r.location,
    before: r.before,
    after: r.after,
  }))
}

/** History of one shift, for the brief's "view the history of any shift". */
export async function shiftHistory(shiftId: string, db: Db = defaultDb): Promise<AuditEntry[]> {
  await requireRole('admin', 'manager')
  const rows = await db.execute<{ location_id: string | null }>(
    sql`SELECT location_id FROM shifts WHERE id = ${shiftId}`,
  )
  const locationId = rows.rows[0]?.location_id
  if (locationId) await requireLocationAccess(locationId, db)

  const entries = await auditTrail({}, 500, db)
  return entries.filter((e) => e.entityId === shiftId || (e.after ?? '').includes(shiftId))
}

function csvCell(value: string | null): string {
  const text = value ?? ''
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Admin-only CSV export (brief §9). */
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
