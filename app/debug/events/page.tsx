'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * TEMPORARY. Delete before shipping.
 *
 * Exists to prove the bus -> SSE chain survives a real deploy, where a proxy
 * sitting in front of the app is what usually breaks streaming. Verify on
 * Railway, not just locally.
 *
 * Fan-out is in-process, so events come from service functions in
 * lib/scheduling/* running inside THIS server process - creating an assignment
 * emits one. There is no longer any way to inject an event from psql; the
 * previous pg_notify trick only worked while the bus listened on a Postgres
 * channel.
 */
export default function DebugEventsPage() {
  const [locationId, setLocationId] = useState('')
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const sourceRef = useRef<EventSource | null>(null)

  const log = (line: string) =>
    setLines((prev) => [`${new Date().toISOString()}  ${line}`, ...prev].slice(0, 200))

  useEffect(() => {
    return () => sourceRef.current?.close()
  }, [])

  function connect() {
    sourceRef.current?.close()
    if (!locationId) return

    const source = new EventSource(`/api/events/${encodeURIComponent(locationId)}`)
    sourceRef.current = source

    source.onopen = () => {
      setConnected(true)
      log('open')
    }
    source.addEventListener('ready', (e) => log(`ready ${(e as MessageEvent).data}`))
    source.addEventListener('schedule_change', (e) =>
      log(`schedule_change ${(e as MessageEvent).data}`),
    )
    // Fires on network drop too; EventSource retries on its own.
    source.onerror = () => {
      setConnected(false)
      log('error / reconnecting')
    }
  }

  function disconnect() {
    sourceRef.current?.close()
    sourceRef.current = null
    setConnected(false)
    log('closed')
  }

  return (
    <main style={{ fontFamily: 'ui-monospace, monospace', padding: 24, maxWidth: 900 }}>
      <h1 style={{ fontSize: 18 }}>SSE debug (temporary)</h1>

      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <input
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          placeholder="location id (uuid)"
          style={{ flex: 1, padding: 8, fontFamily: 'inherit' }}
        />
        <button onClick={connect} style={{ padding: '8px 16px' }}>
          Connect
        </button>
        <button onClick={disconnect} style={{ padding: '8px 16px' }}>
          Close
        </button>
      </div>

      <p>status: {connected ? 'connected' : 'disconnected'}</p>
      <p style={{ color: '#666' }}>
        Heartbeats are SSE comments, so they are invisible to EventSource by
        design. Watch the Network tab if you want to see them arrive.
      </p>

      <pre style={{ background: '#111', color: '#0f0', padding: 12, minHeight: 240, overflow: 'auto' }}>
        {lines.join('\n') || '(nothing yet)'}
      </pre>
    </main>
  )
}
