import { sql } from 'drizzle-orm'
import { db as defaultDb, type Db, type Tx } from '@/lib/db'
import { requireRole, type Role } from '@/lib/auth'
import { publishNotification } from '@/lib/realtime/bus'

/**
 * Persisted notifications (brief §7).
 *
 * Writes take the transaction handle wherever one exists, so a notification
 * cannot survive a rolled-back change: nobody is told about a shift that was
 * never assigned.
 *
 * Email is *simulated* - a row in email_log rather than an actual send - which
 * is what the brief asks for and keeps the demo self-contained.
 */

export type NotificationType =
  | 'shift.assigned'
  | 'shift.unassigned'
  | 'shift.changed'
  | 'schedule.published'
  | 'swap.requested'
  | 'swap.accepted'
  | 'swap.approved'
  | 'swap.rejected'
  | 'swap.cancelled'
  | 'compliance.warning'

export interface NotifyInput {
  staffId: string
  type: NotificationType
  title: string
  body?: string
  /** Identifiers only - subscribers re-read what they need. */
  meta?: Record<string, string>
}

/**
 * Record a notification, and simulate an email when that staff member has
 * opted in. A missing preferences row means in-app only, so nobody is emailed
 * by default.
 */
export async function notify(executor: Db | Tx, input: NotifyInput): Promise<void> {
  const payload = JSON.stringify({ title: input.title, body: input.body ?? null, ...input.meta })

  await executor.execute(sql`
    INSERT INTO notifications (staff_id, type, payload)
    VALUES (${input.staffId}, ${input.type}, ${payload}::jsonb)
  `)

  await executor.execute(sql`
    INSERT INTO email_log (notification_id, staff_id, to_email, subject, body)
    SELECT n.id, st.id, st.email, ${input.title}, ${input.body ?? input.title}
    FROM staff st
    JOIN notification_preferences p ON p.staff_id = st.id
    JOIN LATERAL (
      SELECT id FROM notifications
      WHERE staff_id = st.id ORDER BY created_at DESC LIMIT 1
    ) n ON true
    WHERE st.id = ${input.staffId}
      AND p.email_simulation_enabled
      AND NOT (p.muted_types ? ${input.type})
  `)

  publishNotification({ staffId: input.staffId, title: input.title })
}

/** Notify several people about the same thing. */
export async function notifyAll(
  executor: Db | Tx,
  staffIds: string[],
  input: Omit<NotifyInput, 'staffId'>,
): Promise<void> {
  for (const staffId of new Set(staffIds)) {
    await notify(executor, { ...input, staffId })
  }
}

/** Everyone who manages a location, for approval requests and warnings. */
export async function managersOf(executor: Db | Tx, locationId: string): Promise<string[]> {
  const rows = await executor.execute<{ staff_id: string }>(sql`
    SELECT ml.staff_id FROM manager_locations ml WHERE ml.location_id = ${locationId}
    UNION
    SELECT st.id FROM staff st WHERE st.role = 'admin'
  `)
  return rows.rows.map((r) => r.staff_id)
}

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  createdAt: string
  read: boolean
  /** Where clicking it takes you. */
  href: string
}

/** Swaps land on whichever queue that role acts from; everything else is a shift. */
export function notificationHref(type: string, role: Role): string {
  if (type === 'compliance.warning') return role === 'staff' ? '/my-availability' : '/team'
  if (type === 'swap.accepted' || type === 'swap.requested') {
    return role === 'staff' ? '/my-requests' : '/requests'
  }
  if (type.startsWith('swap.')) return '/my-requests'
  return '/my-shifts'
}

export async function myNotifications(
  limit = 50,
  db: Db = defaultDb,
): Promise<{ items: NotificationRow[]; unread: number }> {
  const session = await requireRole('admin', 'manager', 'staff')

  const rows = await db.execute<{
    id: string
    type: string
    title: string | null
    body: string | null
    created_at: string
    read: boolean
  }>(sql`
    SELECT id, type, payload->>'title' AS title, payload->>'body' AS body,
           to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
           read_at IS NOT NULL AS read
    FROM notifications
    WHERE staff_id = ${session.userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `)

  const unread = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE staff_id = ${session.userId} AND read_at IS NULL
  `)

  return {
    items: rows.rows.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title ?? r.type,
      body: r.body,
      createdAt: r.created_at,
      read: r.read,
      href: notificationHref(r.type, session.role),
    })),
    unread: unread.rows[0]?.n ?? 0,
  }
}

/** Scoped to the caller, so an id from somebody else's list does nothing. */
export async function markRead(id: string, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  await db.execute(sql`
    UPDATE notifications SET read_at = now()
    WHERE id = ${id} AND staff_id = ${session.userId} AND read_at IS NULL
  `)
}

export async function markAllRead(db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  await db.execute(sql`
    UPDATE notifications SET read_at = now()
    WHERE staff_id = ${session.userId} AND read_at IS NULL
  `)
}

export async function unreadCount(db: Db = defaultDb): Promise<number> {
  const session = await requireRole('admin', 'manager', 'staff')
  const rows = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM notifications
    WHERE staff_id = ${session.userId} AND read_at IS NULL
  `)
  return rows.rows[0]?.n ?? 0
}

/** Preferences, defaulting to in-app only when no row exists. */
export async function setEmailSimulation(enabled: boolean, db: Db = defaultDb): Promise<void> {
  const session = await requireRole('admin', 'manager', 'staff')
  await db.execute(sql`
    INSERT INTO notification_preferences (staff_id, email_simulation_enabled)
    VALUES (${session.userId}, ${enabled})
    ON CONFLICT (staff_id) DO UPDATE SET email_simulation_enabled = ${enabled}
  `)
}

export async function emailSimulationEnabled(db: Db = defaultDb): Promise<boolean> {
  const session = await requireRole('admin', 'manager', 'staff')
  const rows = await db.execute<{ enabled: boolean }>(sql`
    SELECT email_simulation_enabled AS enabled
    FROM notification_preferences WHERE staff_id = ${session.userId}
  `)
  return rows.rows[0]?.enabled ?? false
}
