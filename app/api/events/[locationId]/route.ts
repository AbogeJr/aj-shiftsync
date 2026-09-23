import { subscribeToScheduleChanges } from '@/lib/realtime/bus'
import { requireLocationAccess } from '@/lib/scheduling/access'

// Must be the Node runtime: the bus holds a long-lived pg TCP connection.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  const { locationId } = await params

  // One stream can cover several locations - the combined week subscribes to
  // all of them - so the segment is a comma-separated set rather than one id.
  // One connection instead of N also keeps clear of the browser's per-origin
  // connection cap.
  const wanted = new Set(locationId.split(',').filter(Boolean))
  if (wanted.size === 0) return new Response('Bad request', { status: 400 })

  // A location id is guessable, so every one is authorized before the stream
  // opens. All or nothing: a partial subscription would look live while
  // silently missing changes.
  try {
    await Promise.all([...wanted].map((id) => requireLocationAccess(id)))
  } catch {
    return new Response('Forbidden', { status: 403 })
  }

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // Client vanished between the abort check and the write.
          cleanup()
        }
      }

      const unsubscribe = subscribeToScheduleChanges((event) => {
        // Fan-out happens in-process; each stream filters to its own locations.
        if (!wanted.has(event.locationId)) return
        send(`event: schedule_change\ndata: ${JSON.stringify(event)}\n\n`)
      })

      // Keeps proxies from closing an idle stream, and is how this process
      // notices a client that disappeared without a FIN.
      const heartbeat = setInterval(() => {
        send(`: heartbeat ${Date.now()}\n\n`)
      }, HEARTBEAT_MS)

      function cleanup() {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        request.signal.removeEventListener('abort', cleanup)
        try {
          controller.close()
        } catch {
          // Already closed.
        }
      }

      request.signal.addEventListener('abort', cleanup)
      if (request.signal.aborted) {
        cleanup()
        return
      }

      // Open the stream immediately so the browser fires `onopen` without
      // waiting for the first real event.
      send(`retry: 3000\n\n`)
      send(`event: ready\ndata: ${JSON.stringify({ locationId })}\n\n`)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform matters as much as no-cache: it stops intermediaries from
      // gzipping the stream, which would buffer it into uselessness.
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx-family proxies buffer proxied responses by default; this opts out.
      'X-Accel-Buffering': 'no',
    },
  })
}
