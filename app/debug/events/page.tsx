'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * TEMPORARY. Delete before shipping.
 *
 * Proves the bus -> SSE chain survives a real deploy, where a proxy in front of
 * the app is what usually breaks streaming. Verify on Railway, not just
 * locally. Fan-out is in-process, so events come from service functions running
 * in this server process - creating an assignment emits one.
 *
 * Requires an admin or manager session for the location; see /login.
 */
export default function DebugEventsPage() {
  const [locationId, setLocationId] = useState('')
  const [connected, setConnected] = useState(false)
  const [lines, setLines] = useState<string[]>([])
  const [refetches, setRefetches] = useState(0)
  const sourceRef = useRef<EventSource | null>(null)

  const log = (line: string) =>
    setLines((prev) => [`${new Date().toISOString()}  ${line}`, ...prev].slice(0, 200))

  useEffect(() => {
    return () => sourceRef.current?.close()
  }, [])

  // Stands in for the real query a page would re-run.
  function refetch() {
    setRefetches((n) => n + 1)
  }

  function connect() {
    sourceRef.current?.close()
    if (!locationId) return

    const source = new EventSource(`/api/events/${encodeURIComponent(locationId)}`)
    sourceRef.current = source

    // The stream is lossy: events published while a client is disconnected are
    // gone, because nothing is buffered server-side. So it is treated as a
    // cache-invalidation hint, not a data channel - refetching on every open,
    // including reconnects, is what makes a missed event harmless.
    source.onopen = () => {
      setConnected(true)
      log('open -> refetch')
      refetch()
    }
    source.addEventListener('ready', (e) => log(`ready ${(e as MessageEvent).data}`))
    source.addEventListener('schedule_change', (e) => {
      log(`schedule_change ${(e as MessageEvent).data} -> refetch`)
      refetch()
    })
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

      <p>
        status: {connected ? 'connected' : 'disconnected'} · refetches:{' '}
        {refetches}
      </p>
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
