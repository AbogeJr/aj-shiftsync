import { skillStyle } from '@/components/ui/skill-style'
import { timeLabel } from '@/lib/format'
import type { ScheduleShift } from '@/lib/scheduling/schedule'

export function ShiftBlock({
  shift,
  onEdit,
  onUnassign,
}: {
  shift: ScheduleShift
  onEdit?: () => void
  onUnassign?: () => void
}) {
  return (
    <div
      className={`group/block relative rounded-md border px-2 py-1 text-xs ${skillStyle(
        shift.requiredSkill,
      )} ${shift.published ? '' : 'border-dashed'}`}
      title={shift.published ? 'Published' : 'Draft — not visible to staff'}
    >
      {onUnassign && (
        <button
          onClick={onUnassign}
          aria-label="Remove from this shift"
          title="Remove from this shift"
          className="absolute top-0.5 right-0.5 hidden h-4 w-4 items-center justify-center rounded text-current opacity-60 group-hover/block:flex hover:bg-black/10 hover:opacity-100"
        >
          ×
        </button>
      )}
      <button
        onClick={onEdit}
        disabled={!onEdit}
        className="block w-full text-left disabled:cursor-default"
        title={onEdit ? 'Edit shift' : undefined}
      >
      <div className="font-semibold tabular">
        {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
        {shift.overnight && <span title="Ends the next day"> +1</span>}
      </div>
      <div className="truncate">{shift.requiredSkill}</div>
      </button>
    </div>
  )
}

export function OpenShiftBlock({
  shift,
  open,
  onClick,
}: {
  shift: ScheduleShift
  open: number
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Find coverage"
      className={`w-full rounded-md border border-dashed px-2 py-1 text-left text-xs hover:brightness-95 ${skillStyle(shift.requiredSkill)}`}
    >
      <div className="font-semibold tabular">
        {timeLabel(shift.startLocal)}–{timeLabel(shift.endLocal)}
      </div>
      <div className="truncate">
        {shift.requiredSkill} · {open} open
      </div>
    </button>
  )
}
