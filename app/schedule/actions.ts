'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { shifts } from '@/lib/db/schema'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { requireLocationAccess } from '@/lib/scheduling/access'
import { suggestCoverage, type CoverageSuggestions } from '@/lib/scheduling/suggestions'
import { createShifts, deleteShift, unassign, updateShift } from '@/lib/scheduling/shifts'
import type { ShiftDraft } from '@/lib/scheduling/shifts'
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
      return { ok: false, error: err.explanation ?? err.message }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Could not assign' }
  }
}

export async function publishWeekAction(
  locationId: string,
  weekStart: string,
): Promise<ActionResult> {
  try {
    await requireLocationAccess(locationId)
    await db
      .update(shifts)
      .set({ publishedAt: sql`now()` })
      .where(
        and(
          eq(shifts.locationId, locationId),
          isNull(shifts.publishedAt),
          sql`${shifts.startsAt} >= (${weekStart} || ' 00:00')::timestamp AT TIME ZONE (select timezone from locations where id = ${locationId})`,
          sql`${shifts.startsAt} <  ((${weekStart}::date + 7) || ' 00:00')::timestamp AT TIME ZONE (select timezone from locations where id = ${locationId})`,
        ),
      )
    revalidatePath('/schedule')
    return { ok: true }
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

function describe(err: unknown): string {
  if (err instanceof UnauthorizedError) return 'Your session has expired. Reload and sign in again.'
  if (err instanceof ForbiddenError) return 'You do not manage this location.'
  if (err instanceof EligibilityError) return err.violations.map((v) => v.message).join(' ')
  if (err instanceof ConflictError) return err.explanation ?? err.message
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
