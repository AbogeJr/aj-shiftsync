'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/toast'

const UnreadContext = createContext(0)

/** Unread count for the nav badge. */
export function useUnreadCount(): number {
  return useContext(UnreadContext)
}

/**
 * Subscribes to this user's notification stream.
 *
 * The stream carries a hint, not the payload, so every event triggers a refetch
 * of the unread count. That keeps the badge honest even if an event is missed
 * while disconnected - the count is re-read on every reconnect too.
 */
export function NotificationWatcher({ children }: { children: ReactNode }) {
  const router = useRouter()
  const toast = useToast()
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function refresh() {
      try {
        const response = await fetch('/api/notifications/unread', { cache: 'no-store' })
        if (!response.ok) return
        const data = (await response.json()) as { unread: number }
        if (!cancelled) setUnread(data.unread)
      } catch {
        // Offline; the next event or reconnect will retry.
      }
    }

    void refresh()

    const source = new EventSource('/api/notifications/stream')
    source.onopen = () => void refresh()
    source.addEventListener('notification', (event) => {
      const { title } = JSON.parse((event as MessageEvent).data) as { title: string }
      toast.info(title)
      void refresh()
      // Pull in whatever changed on the page behind the toast.
      router.refresh()
    })

    return () => {
      cancelled = true
      source.close()
    }
    // toast is stable for the life of the provider; re-subscribing on every
    // render would drop and reopen the stream constantly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router])

  return <UnreadContext.Provider value={unread}>{children}</UnreadContext.Provider>
}
