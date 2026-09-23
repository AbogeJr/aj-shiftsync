'use server'

import { revalidatePath } from 'next/cache'
import {
  acceptRequest, approveRequest, cancelRequest, rejectRequest, requestDrop, requestSwap,
} from '@/lib/scheduling/swaps'
import { ConflictError, SwapError } from '@/lib/scheduling/errors'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth'

export interface ActionResult { ok: boolean; error?: string }

function describe(err: unknown): string {
  if (err instanceof SwapError) return err.message
  if (err instanceof ConflictError) return err.message
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return 'Your session has expired. Reload and sign in again.'
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn()
    revalidatePath('/requests')
    revalidatePath('/my-shifts')
    revalidatePath('/schedule')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

// Each must be a declared async function: Next rejects arrow-const exports
// from a "use server" module.
export async function dropShiftAction(
  assignmentId: string,
  reason: string | null,
): Promise<ActionResult> {
  return run(() => requestDrop(assignmentId, reason))
}

export async function swapShiftAction(
  assignmentId: string,
  targetAssignmentId: string,
  reason: string | null,
): Promise<ActionResult> {
  return run(() => requestSwap(assignmentId, targetAssignmentId, reason))
}

export async function acceptRequestAction(id: string): Promise<ActionResult> {
  return run(() => acceptRequest(id))
}

export async function cancelRequestAction(id: string): Promise<ActionResult> {
  return run(() => cancelRequest(id))
}

export async function approveRequestAction(id: string): Promise<ActionResult> {
  return run(() => approveRequest(id))
}

export async function rejectRequestAction(id: string): Promise<ActionResult> {
  return run(() => rejectRequest(id))
}
