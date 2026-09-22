'use client'

import { useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { assignAction } from '../actions'
import { useToast } from '@/components/ui/toast'
import type { ScheduleShift, ScheduleStaff } from '@/lib/scheduling/schedule'
import { longDateLabel, timeLabel } from '@/lib/format'

export function AssignDialog({
  open,
  onOpenChange,
  member,
  day,
  shifts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  member: ScheduleStaff | null
  day: string
  shifts: ScheduleShift[]
}) {
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!member) return null

  // Same rules the service enforces, surfaced up front so a manager sees why a
  // shift is unavailable instead of clicking it and being rejected. The server
  // re-checks regardless - this is guidance, not the guard.
  const candidates = shifts
    .filter((s) => s.localDate === day && !s.assignedStaffIds.includes(member.id))
    .map((shift) => {
      const open = shift.headcount - shift.assignedStaffIds.length
      const reasons: string[] = []
      if (open <= 0) reasons.push(`fully staffed (${shift.headcount})`)
      if (shift.requiredSkill && !member.skills.includes(shift.requiredSkill)) {
        reasons.push(`needs ${shift.requiredSkill}`)
      }
      return { shift, open, reasons }
    })

  const eligible = candidates.filter((c) => c.reasons.length === 0)
  const blocked = candidates.filter((c) => c.reasons.length > 0)

  function submit(shiftId: string) {
    setError(null)
    startTransition(async () => {
      const result = await assignAction(shiftId, member!.id)
      if (result.ok) {
        toast.success(`${member!.name} assigned.`)
        onOpenChange(false)
      } else {
        // Kept inline as well: the reason is long and belongs next to the shift
        // it refers to, not only in a toast that disappears.
        setError(result.error ?? 'Could not assign')
        toast.error('Could not assign — see the dialog for why.')
      }
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">
            Assign {member.name}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-slate-500">
            {longDateLabel(day)}
            {member.skills.length > 0 && ` · skills: ${member.skills.join(', ')}`}
          </Dialog.Description>

          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          )}

          <div className="mt-4 space-y-2">
            {candidates.length === 0 && (
              <p className="text-sm text-slate-500">No shifts on this day to assign to.</p>
            )}

            {eligible.map(({ shift, open }) => (
              <button
                key={shift.id}
                disabled={pending}
                onClick={() => submit(shift.id)}
                className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-3 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50 disabled:opacity-50"
              >
                <span>
                  <span className="block text-sm font-semibold tabular">
                    {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {shift.requiredSkill ?? 'any skill'} · {open} open
                  </span>
                </span>
                <span className="text-xs font-medium text-brand-600">
                  {pending ? '…' : 'Assign'}
                </span>
              </button>
            ))}

            {blocked.length > 0 && (
              <>
                <p className="pt-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                  Not available for {member.name.split(' ')[0]}
                </p>
                {blocked.map(({ shift, reasons }) => (
                  <div
                    key={shift.id}
                    className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 opacity-70"
                  >
                    <span className="block text-sm font-semibold text-slate-500 tabular">
                      {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
                    </span>
                    <span className="block text-xs text-slate-500">{reasons.join(' · ')}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          <Dialog.Close className="mt-5 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium hover:bg-slate-50">
            Cancel
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
