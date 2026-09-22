'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps the grid current from the server-sent event stream.
 *
 * The stream is treated as a cache-invalidation hint rather than a data
 * channel: nothing is buffered server-side, so an event published while a
 * client is disconnected is gone for good. Refreshing on every *reconnect*, not
 * just on each event, is what makes that loss harmless - the cost of a missed
 * event becomes one redundant query instead of a stale roster.
 */
export function useLiveSchedule(locationId: string): boolean {
  const router = useRouter()
  const [connected, setConnected] = useState(false)

  // router.refresh() re-renders the server component without remounting this
  // one, so the effect does not re-run and cannot loop. The ref guards the
  // very first open, where a refresh would be pointless work.
  const hasConnectedBefore = useRef(false)

  useEffect(() => {
    const source = new EventSource(`/api/events/${locationId}`)

    source.onopen = () => {
      setConnected(true)
      if (hasConnectedBefore.current) router.refresh()
      hasConnectedBefore.current = true
    }

    source.addEventListener('schedule_change', () => router.refresh())

    // Fires on network drop too; EventSource reconnects on its own.
    source.onerror = () => setConnected(false)

    return () => source.close()
  }, [locationId, router])

  return connected
}
