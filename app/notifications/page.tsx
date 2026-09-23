import { redirect } from 'next/navigation'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { getSession } from '@/lib/auth'
import { emailSimulationEnabled, myNotifications } from '@/lib/scheduling/notifications'
import Link from 'next/link'
import { EmailToggle, MarkReadOnView } from './_components/controls'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  let data, emailOn
  try {
    ;[data, emailOn] = await Promise.all([myNotifications(), emailSimulationEnabled()])
  } catch (err) {
    handleAuthError(err)
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle={data.unread > 0 ? `${data.unread} unread` : 'All caught up'}
      />

      <MarkReadOnView unread={data.unread} />

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <Card title="Preferences">
          <EmailToggle enabled={emailOn} />
          <p className="mt-1.5 text-xs text-slate-500">
            In-app notifications are always on. Email is simulated — a record is written to
            <code className="mx-1">email_log</code> rather than actually sent.
          </p>
        </Card>

        <Card title="Recent">
          {data.items.length === 0 ? (
            <EmptyState>Nothing yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className={`-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-slate-50 ${
                      item.read ? 'opacity-60' : ''
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        item.read ? 'bg-slate-300' : 'bg-brand-500'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.title}</p>
                      {item.body && <p className="text-xs text-slate-500">{item.body}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge>{item.type}</Badge>
                      <p className="mt-1 text-xs tabular text-slate-400">{item.createdAt}</p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
