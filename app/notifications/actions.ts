'use server'

import { revalidatePath } from 'next/cache'
import { markAllRead, markRead, setEmailSimulation } from '@/lib/scheduling/notifications'

export interface ActionResult { ok: boolean; error?: string }

export async function markAllReadAction(): Promise<ActionResult> {
  try {
    await markAllRead()
    revalidatePath('/notifications')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' }
  }
}

export async function markReadAction(id: string): Promise<ActionResult> {
  try {
    await markRead(id)
    revalidatePath('/notifications')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' }
  }
}

export async function setEmailSimulationAction(enabled: boolean): Promise<ActionResult> {
  try {
    await setEmailSimulation(enabled)
    revalidatePath('/notifications')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not update' }
  }
}
