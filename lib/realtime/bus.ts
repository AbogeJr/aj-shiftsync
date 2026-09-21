import { EventEmitter } from 'node:events'

/**
 * In-process event bus for schedule changes.
 *
 * Fan-out happens inside this Node process and nowhere else: a service function
 * emits, and every SSE stream held open by this instance receives it. That
 * assumes a single instance - see the note in the README about what scaling out
 * would require.
 */

export interface ScheduleChangeEvent {
  /** Subscribers are filtered on this, so it is required on every event. */
  locationId: string
  type: 'assignment.created' | 'assignment.cancelled' | 'shift.updated'
  shiftId?: string
  assignmentId?: string
  staffId?: string
  /** ISO-8601 instant, set by the emitter. */
  at: string
}

type ScheduleChangeListener = (event: ScheduleChangeEvent) => void

const EVENT = 'schedule_change'

// Cached on globalThis so Next's dev-mode module reloading does not orphan the
// listeners registered against a previous copy of this module. In production
// the module is evaluated once, so the module-scope binding is already the
// singleton. Same pattern as a singleton database client.
const globalForBus = globalThis as unknown as { __shiftsyncBus?: EventEmitter }

function createBus(): EventEmitter {
  const emitter = new EventEmitter()
  // One SSE response per connected browser tab; the default ceiling of 10 is
  // far too low and would print a spurious leak warning.
  emitter.setMaxListeners(0)
  return emitter
}

const bus: EventEmitter = globalForBus.__shiftsyncBus ?? createBus()

if (process.env.NODE_ENV !== 'production') {
  globalForBus.__shiftsyncBus = bus
}

/**
 * Announce a schedule change.
 *
 * Callers MUST invoke this only after their transaction has committed. Emitting
 * from inside a transaction would announce writes that a later rollback undoes,
 * and an in-process emitter has no way to take that back.
 */
export function publishScheduleChange(
  event: Omit<ScheduleChangeEvent, 'at'> & { at?: string },
): void {
  bus.emit(EVENT, { ...event, at: event.at ?? new Date().toISOString() })
}

/**
 * Subscribe to schedule changes. Returns an unsubscribe function - callers MUST
 * invoke it (SSE routes do so on request abort) or the emitter accumulates
 * listeners for every disconnected client.
 */
export function subscribeToScheduleChanges(
  listener: ScheduleChangeListener,
): () => void {
  bus.on(EVENT, listener)
  return () => {
    bus.off(EVENT, listener)
  }
}
