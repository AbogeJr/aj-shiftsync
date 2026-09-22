'use server'

import { revalidatePath } from 'next/cache'
import {
  addException, addWeeklyRule, removeException, removeWeeklyRule,
} from '@/lib/scheduling/availability'
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

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn()
    revalidatePath('/my-availability')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: describe(err) }
  }
}

export async function addRuleAction(weekday: number, start: string, end: string) {
  return run(() => addWeeklyRule(weekday, start, end))
}
export async function removeRuleAction(id: string) {
  return run(() => removeWeeklyRule(id))
}
export async function addExceptionAction(
  date: string, start: string, end: string, kind: 'available' | 'unavailable',
) {
  return run(() => addException(date, start, end, kind))
}
export async function removeExceptionAction(id: string) {
  return run(() => removeException(id))
}
