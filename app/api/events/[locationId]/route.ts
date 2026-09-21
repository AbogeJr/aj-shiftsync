import { subscribeToScheduleChanges } from '@/lib/realtime/bus'

// Must be the Node runtime: the bus holds a long-lived pg TCP connection.
export const runtime = 'nodejs'
// Never prerender or cache a stream.
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000

export async function GET(
  request: Request,
  { params }: { params: Promise<{ locationId: string }> },
): Promise<Response> {
  const { locationId } = await params

  // TODO(auth): once Auth.js is wired up, reject callers who do not manage this
  // location. A location id is guessable, and this stream leaks activity.

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
        // Fan-out happens in-process; each stream filters to its own location.
        if (event.locationId !== locationId) return
        send(`event: schedule_change\ndata: ${JSON.stringify(event)}\n\n`)
      })

      // A comment line every 15s. Two jobs: it keeps proxies and load balancers
      // from closing a stream they consider idle, and it is how this process
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

      // Tell EventSource how long to wait before reconnecting, and open the
      // stream immediately so the browser fires `onopen` without waiting for
      // the first real event.
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
