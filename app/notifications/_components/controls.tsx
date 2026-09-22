'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { markAllReadAction, setEmailSimulationAction } from '../actions'

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const result = await markAllReadAction()
          if (toast.report(result, 'All caught up.')) router.refresh()
        })
      }
    >
      {pending ? '…' : 'Mark all read'}
    </Button>
  )
}

export function EmailToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, start] = useTransition()
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={enabled}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            const next = e.target.checked
            const result = await setEmailSimulationAction(next)
            if (toast.report(result, next ? 'Email simulation on.' : 'In-app only.')) {
              router.refresh()
            }
          })
        }
      />
      Also simulate email
    </label>
  )
}
