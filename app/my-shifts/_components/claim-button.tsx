'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { claimShiftAction } from '../actions'

export function ClaimButton({ shiftId }: { shiftId: string }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()

  return (
    <div className="text-right">
      <Button
        variant="primary"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await claimShiftAction(shiftId)
            if (toast.report(result, 'Shift picked up.')) router.refresh()
          })
        }
      >
        {pending ? 'Picking up…' : 'Pick up'}
      </Button>
    </div>
  )
}
