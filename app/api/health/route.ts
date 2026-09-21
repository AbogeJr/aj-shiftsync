import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'

// Railway's healthcheck hits this. It must never be cached or prerendered.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`SELECT 1`)
    return Response.json({ status: 'ok' }, { status: 200 })
  } catch (err) {
    console.error('[health] database check failed', err)
    // 503, not 500: the service is up but its dependency is not, which is what
    // a load balancer needs to distinguish.
    return Response.json(
      { status: 'unavailable', error: 'database unreachable' },
      { status: 503 },
    )
  }
}
