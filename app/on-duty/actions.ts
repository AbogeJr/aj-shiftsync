'use server'

import { revalidatePath } from 'next/cache'
import { clockIn, clockOut } from '@/lib/scheduling/attendance'
import { SwapError } from '@/lib/scheduling/errors'
import { ForbiddenError, UnauthorizedError } from '@/lib/auth'

export interface ActionResult { ok: boolean; error?: string }

function describe(err: unknown): string {
  if (err instanceof SwapError) return err.message
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return 'Your session has expired. Reload and sign in again.'
  }
  return err instanceof Error ? err.message : 'Something went wrong.'
}

export async function clockInAction(assignmentId: string): Promise<ActionResult> {
  try {
    await clockIn(assignmentId)
    revalidatePath('/my-shifts')
    revalidatePath('/on-duty')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function clockOutAction(assignmentId: string): Promise<ActionResult> {
  try {
    await clockOut(assignmentId)
    revalidatePath('/my-shifts')
    revalidatePath('/on-duty')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}
