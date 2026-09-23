'use server'

import { revalidatePath } from 'next/cache'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { suggestCoverage, type CoverageSuggestions } from '@/lib/scheduling/suggestions'
import { createShifts, deleteShift, publishWeek, unassign, unpublishWeek, updateShift } from '@/lib/scheduling/shifts'
import type { ShiftDraft } from '@/lib/scheduling/shifts'
import { shiftHistory } from '@/lib/scheduling/audit'
import type { AuditEntry } from '@/lib/scheduling/audit'
import { ConflictError, EligibilityError } from '@/lib/scheduling/errors'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth'

export interface ActionResult {
  ok: boolean
  error?: string
}

/** Thin wrapper: the service function authorizes and enforces the rules. */
export async function assignAction(shiftId: string, staffId: string): Promise<ActionResult> {
  try {
    await assignStaffToShift({ shiftId, staffId })
    revalidatePath('/schedule')
    return { ok: true }
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, error: 'Your session has expired. Reload the page and sign in again.' }
    }
    if (err instanceof ForbiddenError) {
      return { ok: false, error: 'You do not manage this location.' }
    }
    if (err instanceof EligibilityError) {
      return { ok: false, error: err.violations.map((v) => v.message).join(' ') }
    }
    if (err instanceof ConflictError) {
      return { ok: false, error: err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign' }
  }
}

export async function publishWeekAction(
  locationId: string,
  weekStart: string,
): Promise<ActionResult & { published?: number }> {
  try {
    const { published } = await publishWeek(locationId, weekStart)
    revalidatePath('/schedule')
    return { ok: true, published }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not publish' }
  }
}

/** Who can cover an open shift, and why everyone else cannot. */
export async function suggestCoverageAction(
  shiftId: string,
): Promise<{ ok: true; data: CoverageSuggestions } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await suggestCoverage(shiftId) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not load suggestions' }
  }
}

export async function unpublishWeekAction(
  locationId: string,
  weekStart: string,
): Promise<ActionResult & { unpublished?: number; locked?: number }> {
  try {
    const { unpublished, locked } = await unpublishWeek(locationId, weekStart)
    revalidatePath('/schedule')
    return { ok: true, unpublished, locked }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

/** Brief §9: the history of one shift. Loaded on demand, not with the grid. */
export async function shiftHistoryAction(
  shiftId: string,
): Promise<{ ok: true; data: AuditEntry[] } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await shiftHistory(shiftId) }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

function describe(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'Your session has expired. Reload and sign in again.'
  if (err instanceof ForbiddenError) return 'You do not manage this location.'
  if (err instanceof EligibilityError) return err.violations.map((v) => v.message).join(' ')
  if (err instanceof ConflictError) return err.message
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export async function createShiftsAction(
  locationId: string,
  dates: string[],
  draft: ShiftDraft,
): Promise<ActionResult & { created?: number }> {
  try {
    const { created } = await createShifts({ locationId, dates, ...draft })
    revalidatePath('/schedule')
    return { ok: true, created }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function updateShiftAction(
  shiftId: string,
  version: number,
  draft: ShiftDraft,
): Promise<ActionResult> {
  try {
    await updateShift({ shiftId, version, ...draft })
    revalidatePath('/schedule')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function deleteShiftAction(shiftId: string, version: number): Promise<ActionResult> {
  try {
    await deleteShift(shiftId, version)
    revalidatePath('/schedule')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function unassignAction(assignmentId: string): Promise<ActionResult> {
  try {
    await unassign(assignmentId)
    revalidatePath('/schedule')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}
