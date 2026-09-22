import { EventEmitter } from 'node:events'

export interface ScheduleChangeEvent {
  locationId: string
  type: 'assignment.created' | 'assignment.cancelled' | 'shift.updated' | 'attendance.changed'
  shiftId?: string
  assignmentId?: string
  staffId?: string
  at: string
}

type ScheduleChangeListener = (event: ScheduleChangeEvent) => void

const EVENT = 'schedule_change'

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
