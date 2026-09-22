'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  acceptRequestAction,
  approveRequestAction,
  cancelRequestAction,
  rejectRequestAction,
} from '../actions'

/**
 * Server Components may pass server actions across the boundary, but not
 * closures that wrap them. So the caller names which buttons it wants with
 * plain strings and this component - which is a Client Component - imports the
 * actions itself.
 */
export type RequestAction = 'accept' | 'decline' | 'withdraw' | 'claim' | 'approve' | 'reject'

const BUTTONS: Record<
  RequestAction,
  {
    label: string
    variant: 'primary' | 'danger'
    done: string
    run: (id: string) => Promise<{ ok: boolean; error?: string }>
  }
> = {
  accept: { label: 'Accept', variant: 'primary', done: 'Accepted. A manager approves next.', run: acceptRequestAction },
  claim: { label: 'Claim', variant: 'primary', done: 'Claimed. A manager approves next.', run: acceptRequestAction },
  approve: { label: 'Approve', variant: 'primary', done: 'Approved — the schedule is updated.', run: approveRequestAction },
  decline: { label: 'Decline', variant: 'danger', done: 'Declined.', run: cancelRequestAction },
  withdraw: { label: 'Withdraw', variant: 'danger', done: 'Request withdrawn.', run: cancelRequestAction },
  reject: { label: 'Reject', variant: 'danger', done: 'Rejected.', run: rejectRequestAction },
}

export function RequestActions({
  requestId,
  actions,
}: {
  requestId: string
  actions: RequestAction[]
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  if (actions.length === 0) return null

  return (
    <div className="text-right">
      <div className="flex flex-wrap justify-end gap-2">
        {actions.map((kind) => {
          const button = BUTTONS[kind]
          return (
            <Button
              key={kind}
              size="sm"
              variant={button.variant}
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await button.run(requestId)
                  if (toast.report(result, button.done)) router.refresh()
                })
              }
            >
              {pending ? '…' : button.label}
            </Button>
          )
        })}
      </div>
    </div>
  )
}
