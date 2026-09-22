import { exportAuditCsv } from '@/lib/scheduling/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** CSV download. Admin-only; the service enforces that, not this handler. */
export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams
  try {
    const csv = await exportAuditCsv({
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      locationId: params.get('location') ?? undefined,
    })
    const stamp = new Date().toISOString().slice(0, 10)
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="shiftsync-audit-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return new Response('Not permitted', { status: 403 })
  }
}
