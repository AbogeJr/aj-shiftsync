'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { WEEKDAYS } from '@/lib/format'
import {
  addExceptionAction, addRuleAction, removeExceptionAction, removeRuleAction,
} from '../actions'

const FIELD = 'rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm'

export function AddRule() {
  const router = useRouter()
  const toast = useToast()
  const [weekday, setWeekday] = useState(1)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [pending, run] = useTransition()

  return (
    <div className="flex flex-wrap items-end gap-2">
      <select aria-label="Day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={FIELD}>
        {WEEKDAYS.map((day, i) => (
          <option key={day} value={i}>{day}</option>
        ))}
      </select>
      <input aria-label="From" type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`${FIELD} tabular`} />
      <span className="pb-1.5 text-slate-400">–</span>
      <input aria-label="To" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`${FIELD} tabular`} />
      <Button
        variant="primary"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const result = await addRuleAction(weekday, start, end)
            if (toast.report(result, `Available ${WEEKDAYS[weekday]} ${start}–${end}.`)) router.refresh()
          })
        }
      >
        {pending ? '…' : 'Add'}
      </Button>
    </div>
  )
}

export function AddException() {
  const router = useRouter()
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [kind, setKind] = useState<'available' | 'unavailable'>('unavailable')
  const [pending, run] = useTransition()

  return (
    <div className="flex flex-wrap items-end gap-2">
      <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={FIELD}>
        <option value="unavailable">Unavailable</option>
        <option value="available">Extra availability</option>
      </select>
      <input aria-label="Date" type="date" min={today} value={date} onChange={(e) => setDate(e.target.value)} className={`${FIELD} tabular`} />
      <input aria-label="From" type="time" value={start} onChange={(e) => setStart(e.target.value)} className={`${FIELD} tabular`} />
      <span className="pb-1.5 text-slate-400">–</span>
      <input aria-label="To" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={`${FIELD} tabular`} />
      <Button
        variant="primary"
        size="sm"
        disabled={pending}
        onClick={() =>
          run(async () => {
            const result = await addExceptionAction(date, start, end, kind)
            if (toast.report(result, `Saved ${date}.`)) router.refresh()
          })
        }
      >
        {pending ? '…' : 'Add'}
      </Button>
    </div>
  )
}

export function RemoveButton({ id, kind }: { id: string; kind: 'rule' | 'exception' }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, run] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const result = kind === 'rule' ? await removeRuleAction(id) : await removeExceptionAction(id)
          if (toast.report(result, 'Removed.')) router.refresh()
        })
      }
    >
      Remove
    </Button>
  )
}
