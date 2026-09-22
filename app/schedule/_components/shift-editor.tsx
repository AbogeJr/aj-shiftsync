'use client'

import { useEffect, useState, useTransition } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { weekdayLabel } from '@/lib/format'
import type { ScheduleShift } from '@/lib/scheduling/schedule'
import { createShiftsAction, deleteShiftAction, updateShiftAction } from '../actions'
import { useToast } from '@/components/ui/toast'

export interface EditorTarget {
  mode: 'create' | 'edit'
  /** Day the editor opened on, pre-selected in "Apply to". */
  day: string
  shift?: ScheduleShift
}

export function ShiftEditor({
  target,
  locationId,
  days,
  skills,
  onOpenChange,
}: {
  target: EditorTarget | null
  locationId: string
  days: string[]
  skills: string[]
  onOpenChange: (open: boolean) => void
}) {
  const editing = target?.mode === 'edit' ? target.shift : undefined

  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [skill, setSkill] = useState<string>('')
  const [headcount, setHeadcount] = useState(1)
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!target) return
    setError(null)
    setStart(editing?.startLocal ?? '09:00')
    setEnd(editing?.endLocal ?? '17:00')
    setSkill(editing?.requiredSkill ?? '')
    setHeadcount(editing?.headcount ?? 1)
    setSelectedDays([target.day])
  }, [target, editing])

  if (!target) return null

  const draft = {
    startLocal: start,
    endLocal: end,
    requiredSkill: skill === '' ? null : skill,
    headcount,
  }
  const overnight = end <= start

  function save() {
    setError(null)
    startTransition(async () => {
      const result = editing
        ? await updateShiftAction(editing.id, editing.version, draft)
        : await createShiftsAction(locationId, selectedDays, draft)
      if (result.ok) {
        toast.success(
          editing ? 'Shift updated.' : `${selectedDays.length} shift${selectedDays.length === 1 ? '' : 's'} added.`,
        )
        onOpenChange(false)
      } else {
        setError(result.error ?? 'Could not save')
      }
    })
  }

  function remove() {
    if (!editing) return
    setError(null)
    startTransition(async () => {
      const result = await deleteShiftAction(editing.id, editing.version)
      if (result.ok) {
        toast.success('Shift deleted.')
        onOpenChange(false)
      } else {
        setError(result.error ?? 'Could not delete')
      }
    })
  }

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
          <Dialog.Title className="border-b border-slate-200 pb-3 text-base font-semibold">
            {editing ? 'Edit shift' : 'Add shift'}
          </Dialog.Title>

          {error && (
            <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
          )}

          <div className="mt-4 flex items-center gap-2">
            <input
              type="time"
              aria-label="Start time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular"
            />
            <span className="text-slate-400">–</span>
            <input
              type="time"
              aria-label="End time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular"
            />
          </div>
          {overnight && (
            <p className="mt-1.5 text-xs text-slate-500">
              Ends the next day — treated as one overnight shift.
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <select
              aria-label="Required skill"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Any skill</option>
              {skills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <span className="text-slate-500">People</span>
              <input
                type="number"
                min={1}
                aria-label="Headcount"
                value={headcount}
                onChange={(e) => setHeadcount(Math.max(1, Number(e.target.value)))}
                className="w-12 text-sm outline-none tabular"
              />
            </label>
          </div>

          {!editing && (
            <>
              <p className="mt-4 mb-2 text-sm font-medium">Apply to:</p>
              <div className="flex flex-wrap gap-1.5">
                {days.map((day) => {
                  const { weekday } = weekdayLabel(day)
                  const active = selectedDays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() =>
                        setSelectedDays((prev) =>
                          active ? prev.filter((d) => d !== day) : [...prev, day],
                        )
                      }
                      className={`h-10 w-12 rounded-full border text-xs font-medium ${
                        active
                          ? 'border-brand-500 bg-brand-500 text-white'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {weekday}
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="mt-6 flex items-center gap-2">
            {editing && (
              <button
                onClick={remove}
                disabled={pending}
                className="rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Delete
              </button>
            )}
            <Dialog.Close className="ml-auto rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
              Cancel
            </Dialog.Close>
            <button
              onClick={save}
              disabled={pending || (!editing && selectedDays.length === 0)}
              className="rounded-lg bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {pending ? 'Saving…' : editing ? 'Save' : `Add${selectedDays.length > 1 ? ` (${selectedDays.length})` : ''}`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
