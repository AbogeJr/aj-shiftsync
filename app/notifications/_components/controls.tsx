'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useRefreshUnread } from '@/components/layout/notification-watcher'
import { markAllReadAction, setEmailSimulationAction } from '../actions'

/**
 * Opening the page is the read receipt. The list is deliberately not refreshed
 * afterwards, so what was new stays highlighted until you navigate away.
 */
export function MarkReadOnView({ unread }: { unread: number }) {
  const refreshUnread = useRefreshUnread()
  const done = useRef(false)

  useEffect(() => {
    if (unread === 0 || done.current) return
    done.current = true
    void markAllReadAction().then(() => refreshUnread())
  }, [unread, refreshUnread])

  return null
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
