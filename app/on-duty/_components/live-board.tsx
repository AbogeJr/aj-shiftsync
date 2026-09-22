'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Keeps the board current.
 *
 * The SSE stream is per location, so the board opens one connection per
 * location a manager can see. That is fine at this scale; a single
 * all-locations stream would be the change if the estate grew.
 */
export function LiveBoard({ locationIds }: { locationIds: string[] }) {
  const router = useRouter()
  const [live, setLive] = useState(false)
  const connected = useRef(0)

  useEffect(() => {
    const sources = locationIds.map((id) => {
      const source = new EventSource(`/api/events/${id}`)
      source.onopen = () => {
        connected.current += 1
        setLive(true)
      }
      source.addEventListener('schedule_change', () => router.refresh())
      source.onerror = () => {
        connected.current = Math.max(0, connected.current - 1)
        if (connected.current === 0) setLive(false)
      }
      return source
    })

    // Clock time moves on its own, so refresh periodically even with no events.
    const tick = setInterval(() => router.refresh(), 60_000)

    return () => {
      clearInterval(tick)
      for (const source of sources) source.close()
    }
  }, [locationIds, router])

  return (
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green-500' : 'bg-slate-300'}`}
      />
      {live ? 'Live' : 'Offline'}
    </span>
  )
}
