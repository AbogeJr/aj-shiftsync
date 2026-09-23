'use client'

import { useState } from 'react'
import type { AuditEntry } from '@/lib/scheduling/audit'
import { shiftHistoryAction } from '../actions'

/** Turns `shift.updated` into `Shift updated`, so the log reads as English. */
function label(action: string): string {
  const words = action.replace(/[._]/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * Brief §9: "managers can view the history of any shift."
 *
 * Collapsed and loaded on first open rather than fetched with the editor - most
 * times a shift is edited nobody wants the log, and it is a second round trip.
 */
export function ShiftHistory({ shiftId }: { shiftId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load(open: boolean) {
    if (!open || entries || loading) return
    setLoading(true)
    const result = await shiftHistoryAction(shiftId)
    setLoading(false)
    if (result.ok) setEntries(result.data)
    else setError(result.error)
  }

  return (
    <details
      className="mt-5 border-t border-slate-200 pt-3"
      onToggle={(e) => load((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-xs font-semibold tracking-wide text-slate-400 uppercase">
        History
      </summary>

      <div className="mt-2 max-h-48 overflow-y-auto">
        {loading && <p className="text-xs text-slate-500">Loading…</p>}
        {error && <p className="text-xs text-rose-700">{error}</p>}
        {entries?.length === 0 && (
          <p className="text-xs text-slate-500">Nothing recorded for this shift yet.</p>
        )}

        <ol className="space-y-2">
          {entries?.map((entry) => (
            <li key={entry.id} className="border-l-2 border-slate-200 pl-2.5">
              <p className="text-xs font-medium">
                {label(entry.action)}{' '}
                <span className="font-normal text-slate-500">by {entry.actor}</span>
              </p>
              <p className="text-xs tabular text-slate-400">{entry.at}</p>
              {(entry.after ?? entry.before) && (
                <code className="mt-0.5 block truncate text-xs text-slate-500">
                  {entry.after ?? entry.before}
                </code>
              )}
            </li>
          ))}
        </ol>
      </div>
    </details>
  )
}
