import { Badge } from '@/components/ui/feedback'
import { longDateLabel, timeLabel } from '@/lib/format'
import type { RequestSummary } from '@/lib/scheduling/swaps'
import type { ReactNode } from 'react'

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-600',
  peer_accepted: 'bg-amber-100 text-amber-900',
  approved: 'bg-green-100 text-green-800',
}

export function RequestRow({ request, children }: { request: RequestSummary; children?: ReactNode }) {
  const s = request.shift
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-56 flex-1">
        <p className="text-sm font-medium">
          {longDateLabel(s.localDate)}{' '}
          <span className="tabular font-normal text-slate-600">
            {timeLabel(s.startLocal)}–{timeLabel(s.endLocal)}
          </span>
        </p>
        <p className="text-xs text-slate-500">
          {s.location}
          {s.skill && ` · ${s.skill}`} · {request.kind === 'drop' ? 'offered up by' : 'swap from'}{' '}
          {request.requestedByName}
          {request.targetShift && (
            <> ↔ {request.requestedToName}&apos;s {longDateLabel(request.targetShift.localDate)}</>
          )}
        </p>
        {request.reason && <p className="mt-0.5 text-xs text-slate-500 italic">“{request.reason}”</p>}
      </div>
      <Badge className={STATUS_STYLE[request.status] ?? 'bg-slate-100 text-slate-600'}>
        {request.status === 'peer_accepted' ? 'needs approval' : request.status}
      </Badge>
      {children}
    </li>
  )
}
