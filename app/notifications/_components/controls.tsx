'use client'

import { useTransition, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { useRefreshUnread } from '@/components/layout/notification-watcher'
import { markAllReadAction, markReadAction, setEmailSimulationAction } from '../actions'

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const refreshUnread = useRefreshUnread()
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const result = await markAllReadAction()
          if (toast.report(result, 'All caught up.')) {
            refreshUnread()
            router.refresh()
          }
        })
      }
    >
      {pending ? '\u2026' : 'Mark all read'}
    </Button>
  )
}

/** Reading one is what marks it read; the navigation happens either way. */
export function NotificationLink({
  id,
  href,
  read,
  children,
}: {
  id: string
  href: string
  read: boolean
  children: ReactNode
}) {
  const refreshUnread = useRefreshUnread()

  return (
    <Link
      href={href}
      onClick={() => {
        if (read) return
        void markReadAction(id).then(() => refreshUnread())
      }}
      className={`-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-slate-50 ${
        read ? 'opacity-60' : ''
      }`}
    >
      {children}
    </Link>
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
