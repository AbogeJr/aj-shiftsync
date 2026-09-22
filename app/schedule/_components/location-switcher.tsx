'use client'

import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Chevron } from '@/components/icons'
import type { ScheduleLocation } from '@/lib/scheduling/schedule'

export function LocationSwitcher({
  current,
  locations,
  onSelect,
}: {
  current: ScheduleLocation
  locations: ScheduleLocation[]
  onSelect: (locationId: string) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold hover:bg-slate-100">
        {current.name}
        <Chevron className="h-4 w-4 text-slate-400" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 min-w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {locations.map((location) => (
            <DropdownMenu.Item
              key={location.id}
              onSelect={() => onSelect(location.id)}
              className={`cursor-pointer rounded-md px-2.5 py-2 text-sm outline-none data-highlighted:bg-slate-100 ${
                location.id === current.id ? 'font-semibold text-brand-600' : ''
              }`}
            >
              <div>{location.name}</div>
              <div className="text-xs text-slate-500">{location.timezone}</div>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
