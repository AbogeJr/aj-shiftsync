import { redirect } from 'next/navigation'
import { Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError } from '@/components/layout/protected-page'
import { getSession } from '@/lib/auth'
import { claimableDrops, myRequests } from '@/lib/scheduling/swaps'
import { RequestRow } from '../requests/_components/request-row'
import { RequestActions, type RequestAction } from '../requests/_components/request-actions'

export const dynamic = 'force-dynamic'

export default async function MyRequestsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  let mine, claimable
  try {
    ;[mine, claimable] = await Promise.all([myRequests(), claimableDrops()])
  } catch (err) {
    handleAuthError(err)
  }

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle="Your swaps and drops, and shifts colleagues have offered up"
      />
      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <Card title="Yours">
          {mine.length === 0 ? (
            <EmptyState>
              No open requests. Offer a shift up or propose a swap from My shifts.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {mine.map((request) => (
                <RequestRow key={request.id} request={request}>
                  <RequestActions
                    requestId={request.id}
                    actions={
                      request.awaitingMe
                        ? (['accept', 'decline'] as RequestAction[])
                        : request.mine
                          ? (['withdraw'] as RequestAction[])
                          : []
                    }
                  />
                </RequestRow>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Up for grabs">
          <p className="mb-3 text-xs text-slate-500">
            Shifts colleagues have offered up that you are qualified to take. A manager still
            approves before anything changes.
          </p>
          {claimable.length === 0 ? (
            <EmptyState>Nothing available right now.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {claimable.map((request) => (
                <RequestRow key={request.id} request={request}>
                  <RequestActions requestId={request.id} actions={['claim']} />
                </RequestRow>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
