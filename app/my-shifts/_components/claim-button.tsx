'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { claimShiftAction } from '../actions'

export function ClaimButton({ shiftId }: { shiftId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
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
            if (result.ok) router.refresh()
            else setError(result.error ?? 'Could not pick up shift')
          })
        }
      >
        {pending ? 'Picking up…' : 'Pick up'}
      </Button>
      {error && <p className="mt-1 max-w-56 text-xs text-rose-700">{error}</p>}
    </div>
  )
}
