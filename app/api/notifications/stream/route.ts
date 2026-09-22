import { getSession } from '@/lib/auth'
import { subscribeToNotifications } from '@/lib/realtime/bus'

// Node runtime: the bus is in-process and this holds a long-lived response.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 15_000

/** Notifications for the signed-in user only. */
export async function GET(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) return new Response('Unauthorized', { status: 401 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      const unsubscribe = subscribeToNotifications((event) => {
        // Fan-out is in-process; each stream filters to its own user.
        if (event.staffId !== session.userId) return
        send(`event: notification\ndata: ${JSON.stringify(event)}\n\n`)
      })

      const heartbeat = setInterval(() => send(`: heartbeat ${Date.now()}\n\n`), HEARTBEAT_MS)

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

      send(`retry: 3000\n\n`)
      send(`event: ready\ndata: {}\n\n`)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
