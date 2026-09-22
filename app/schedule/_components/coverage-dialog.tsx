'use client'

import { useEffect, useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { timeLabel } from '@/lib/format'
import type { CoverageSuggestions } from '@/lib/scheduling/suggestions'
import type { ScheduleShift } from '@/lib/scheduling/schedule'
import { assignAction, suggestCoverageAction } from '../actions'
import { useToast } from '@/components/ui/toast'

export function CoverageDialog({
  shift,
  onOpenChange,
}: {
  shift: ScheduleShift | null
  onOpenChange: (open: boolean) => void
}) {
  const [data, setData] = useState<CoverageSuggestions | null>(null)
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!shift) {
      setData(null)
      setError(null)
      return
    }
    let cancelled = false
    suggestCoverageAction(shift.id).then((result) => {
      if (cancelled) return
      if (result.ok) setData(result.data)
      else setError(result.error)
    })
    return () => {
      cancelled = true
    }
  }, [shift])

  if (!shift) return null

  const open = shift.headcount - shift.assignedStaffIds.length

  function assign(staffId: string) {
    setError(null)
    startTransition(async () => {
      const result = await assignAction(shift!.id, staffId)
      if (result.ok) {
        toast.success('Coverage assigned.')
        onOpenChange(false)
      } else {
        setError(result.error ?? 'Could not assign')
        toast.error('Could not assign — see the dialog for why.')
      }
    })
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Find coverage</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-500 tabular">
            {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)} ·{' '}
            {shift.requiredSkill ?? 'any skill'} · {open} of {shift.headcount} unfilled
          </Dialog.Description>

          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          )}

          <div className="mt-4 min-h-24 flex-1 space-y-2 overflow-y-auto">
            {!data && !error && <p className="text-sm text-slate-500">Checking who can work…</p>}

            {data?.eligible.length === 0 && (
              <p className="text-sm text-slate-500">
                Nobody is eligible. Every other staff member is blocked for a reason below.
              </p>
            )}

            {data?.eligible.map((candidate) => {
              const shortfall = candidate.desiredWeeklyHours - candidate.assignedHoursThisWeek
              return (
                <button
                  key={candidate.staffId}
                  disabled={pending}
                  onClick={() => assign(candidate.staffId)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
                >
                  <span>
                    <span className="block text-sm font-semibold">{candidate.name}</span>
                    <span className="block text-xs text-slate-500 tabular">
                      {candidate.skills.join(', ') || 'no skills on file'} ·{' '}
                      {candidate.assignedHoursThisWeek.toFixed(2)} of{' '}
                      {candidate.desiredWeeklyHours} hrs
                      {shortfall > 0 && (
                        <span className="text-green-700"> · {shortfall.toFixed(0)}h under</span>
                      )}
                    </span>
                  </span>
                  <span className="text-xs font-medium text-brand-600">
                    {pending ? '…' : 'Assign'}
                  </span>
                </button>
              )
            })}

            {data && data.blocked.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  {data.blocked.length} not eligible
                </summary>
                <div className="mt-2 space-y-1.5">
                  {data.blocked.map((person) => (
                    <div key={person.staffId} className="rounded-lg bg-slate-50 px-3 py-2">
                      <span className="block text-xs font-semibold text-slate-600">
                        {person.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {person.reasons.join(' ')}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          <Dialog.Close className="mt-4 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">
            Close
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
