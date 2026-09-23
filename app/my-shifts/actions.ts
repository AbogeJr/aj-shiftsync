'use server'

import { revalidatePath } from 'next/cache'
import { assignStaffToShift } from '@/lib/scheduling/assign'
import { ConflictError, EligibilityError, LocationAccessError } from '@/lib/scheduling/errors'
import { ForbiddenError, UnauthorizedError, getSession } from '@/lib/auth'

/** Claim an open published shift for yourself. The service decides if you may. */
export async function claimShiftAction(
  shiftId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await getSession()
    if (!session) return { ok: false, error: 'Your session has expired. Sign in again.' }
    await assignStaffToShift({ shiftId, staffId: session.userId })
    revalidatePath('/my-shifts')
    return { ok: true }
  } catch (err) {
    if (err instanceof EligibilityError) {
      return { ok: false, error: err.violations.map((v) => v.message).join(' ') }
    }
    if (err instanceof ConflictError) {
      return { ok: false, error: err.message }
    }
    if (err instanceof LocationAccessError) {
      return { ok: false, error: 'That shift is no longer available to pick up.' }
    }
    if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
      return { ok: false, error: 'Your session has expired. Sign in again.' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Could not pick up shift' }
  }
}
