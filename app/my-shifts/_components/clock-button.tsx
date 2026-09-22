'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { clockInAction, clockOutAction } from '../../on-duty/actions'

/**
 * Clocking is only offered around the shift itself - a button to clock into
 * next Tuesday is noise, and the board only reads attendance for shifts that
 * have started.
 */
export function ClockButton({
  assignmentId,
  clockedIn,
  clockedOut,
  startsSoonOrStarted,
}: {
  assignmentId: string
  clockedIn: boolean
  clockedOut: boolean
  startsSoonOrStarted: boolean
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  if (clockedOut) return <Badge className="bg-slate-100 text-slate-500">clocked out</Badge>
  if (!startsSoonOrStarted && !clockedIn) return null

  return (
    <Button
      size="sm"
      variant={clockedIn ? 'secondary' : 'primary'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = clockedIn
            ? await clockOutAction(assignmentId)
            : await clockInAction(assignmentId)
          if (toast.report(result, clockedIn ? 'Clocked out.' : 'Clocked in.')) router.refresh()
        })
      }
    >
      {pending ? '…' : clockedIn ? 'Clock out' : 'Clock in'}
    </Button>
  )
}
