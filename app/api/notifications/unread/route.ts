import { unreadCount } from '@/lib/scheduling/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  try {
    return Response.json({ unread: await unreadCount() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ unread: 0 }, { status: 401 })
  }
}
