import { Card, EmptyState, PageHeader } from '@/components/ui/feedback'
import { handleAuthError, requireManagerPage } from '@/components/layout/protected-page'
import { requestsAwaitingApproval } from '@/lib/scheduling/swaps'
import { RequestRow } from './_components/request-row'
import { RequestActions } from './_components/request-actions'

export const dynamic = 'force-dynamic'

export default async function RequestsPage() {
  await requireManagerPage()

  let pending
  try {
    pending = await requestsAwaitingApproval()
  } catch (err) {
    handleAuthError(err)
  }

  return (
    <>
      <PageHeader
        title="Requests"
        subtitle="Swaps and drops both parties have agreed. Nothing moves on the schedule until you approve."
      />
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Card title={`${pending.length} awaiting approval`}>
          {pending.length === 0 ? (
            <EmptyState>Nothing to approve.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {pending.map((request) => (
                <RequestRow key={request.id} request={request}>
                  <RequestActions requestId={request.id} actions={['approve', 'reject']} />
                </RequestRow>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
