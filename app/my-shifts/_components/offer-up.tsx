'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/feedback'
import { useToast } from '@/components/ui/toast'
import { dropShiftAction } from '../../requests/actions'
import { cancelRequestAction } from '../../requests/actions'

/**
 * The assignment stays yours until a manager approves, so the shift is still
 * listed. Showing the live request here is what makes that legible instead of
 * looking like the button did nothing.
 */
export function OfferUp({
  assignmentId,
  pendingRequest,
}: {
  assignmentId: string
  pendingRequest: { id: string; kind: 'swap' | 'drop'; status: string } | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  if (pendingRequest) {
    const label =
      pendingRequest.status === 'peer_accepted'
        ? 'Claimed — awaiting manager'
        : pendingRequest.kind === 'drop'
          ? 'Offered up'
          : 'Swap requested'
    return (
      <div className="flex items-center gap-2">
        <Badge className="bg-amber-100 text-amber-900">{label}</Badge>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await cancelRequestAction(pendingRequest.id)
              if (toast.report(result, 'Request withdrawn. The shift stays yours.')) router.refresh()
            })
          }
        >
          Withdraw
        </Button>
      </div>
    )
  }

  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const result = await dropShiftAction(assignmentId, null)
          if (toast.report(result, 'Offered up. It stays yours until a manager approves.')) {
            router.refresh()
          }
        })
      }
    >
      {pending ? '…' : 'Offer up'}
    </Button>
  )
}
