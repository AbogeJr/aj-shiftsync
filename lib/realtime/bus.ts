import { EventEmitter } from 'node:events'

export interface ScheduleChangeEvent {
  locationId: string
  type: 'assignment.created' | 'assignment.cancelled' | 'shift.updated' | 'attendance.changed'
  shiftId?: string
  assignmentId?: string
  staffId?: string
  at: string
}

/** Addressed to one person rather than a location. */
export interface NotificationEvent {
  staffId: string
  title: string
  at: string
}

type ScheduleChangeListener = (event: ScheduleChangeEvent) => void
type NotificationListener = (event: NotificationEvent) => void

const EVENT = 'schedule_change'
const NOTIFICATION_EVENT = 'notification'

// Fan-out is in-process, so subscribers must live in the emitting process: this
// assumes a single instance. Scaling out means moving to Postgres LISTEN/NOTIFY,
// which is confined to this file. Cached on globalThis so dev-mode reloading
// does not orphan listeners registered against an older copy of the module.
const globalForBus = globalThis as unknown as { __shiftsyncBus?: EventEmitter }

function createBus(): EventEmitter {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0) // one listener per open SSE stream
  return emitter
}

const bus: EventEmitter = globalForBus.__shiftsyncBus ?? createBus()

if (process.env.NODE_ENV !== 'production') {
  globalForBus.__shiftsyncBus = bus
}

/** Call only after the transaction commits - an emitter has no rollback. */
export function publishScheduleChange(
  event: Omit<ScheduleChangeEvent, 'at'> & { at?: string },
): void {
  bus.emit(EVENT, { ...event, at: event.at ?? new Date().toISOString() })
}

/** Returns an unsubscribe function. Callers must invoke it on disconnect. */
export function subscribeToScheduleChanges(
  listener: ScheduleChangeListener,
): () => void {
  bus.on(EVENT, listener)
  return () => {
    bus.off(EVENT, listener)
  }
}

/**
 * Announce a notification.
 *
 * Deliberately a hint, not the payload: the client refetches its unread count
 * and latest items. That means a hint emitted inside a transaction that later
 * rolls back is harmless - the refetch simply finds nothing new - so this can
 * be called from the same place the row is written.
 */
export function publishNotification(event: Omit<NotificationEvent, 'at'>): void {
  bus.emit(NOTIFICATION_EVENT, { ...event, at: new Date().toISOString() })
}

export function subscribeToNotifications(listener: NotificationListener): () => void {
  bus.on(NOTIFICATION_EVENT, listener)
  return () => {
    bus.off(NOTIFICATION_EVENT, listener)
  }
}
