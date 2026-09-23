import { redirect } from 'next/navigation'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { getSession } from '@/lib/auth'
import { emailSimulationEnabled, myNotifications } from '@/lib/scheduling/notifications'
import { EmailToggle, MarkAllRead, NotificationLink } from './_components/controls'

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
        action={<MarkAllRead disabled={data.unread === 0} />}
      />

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
                  <NotificationLink id={item.id} href={item.href} read={item.read}>
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
                  </NotificationLink>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
