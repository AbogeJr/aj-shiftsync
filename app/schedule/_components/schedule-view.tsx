'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type {
  ScheduleLocation,
  ScheduleShift,
  ScheduleStaff,
  WeekSchedule,
} from '@/lib/scheduling/schedule'
import {
  availableSkills,
  filterShifts,
  filterStaff,
  NO_FILTERS,
  type ScheduleFilters,
} from '@/lib/scheduling/week-view'
import { publishWeekAction, unassignAction } from '../actions'
import { useToast } from '@/components/ui/toast'
import { AssignDialog } from './assign-dialog'
import { CoverageDialog } from './coverage-dialog'
import { ShiftEditor, type EditorTarget } from './shift-editor'
import { LocationSwitcher } from './location-switcher'
import { ScheduleGrid } from './schedule-grid'
import { ScheduleList } from './schedule-list'
import { ScheduleToolbar } from './schedule-toolbar'
import { useLiveSchedule } from './use-live-schedule'

/**
 * Owns the view state and wires the pieces together. All grid arithmetic lives
 * in lib/scheduling/week-view.ts, and all formatting in lib/format.ts.
 */
export function ScheduleView({
  schedule,
  locations,
  role,
  canEdit,
  today,
  weekStart,
}: {
  schedule: WeekSchedule
  locations: ScheduleLocation[]
  role: string
  canEdit: boolean
  today: string
  weekStart: string
}) {
  const router = useRouter()
  const { location, days, staff, shifts } = schedule

  const [filters, setFilters] = useState<ScheduleFilters>(NO_FILTERS)
  const [assignTarget, setAssignTarget] = useState<{ member: ScheduleStaff; day: string } | null>(
    null,
  )
  const [coverageShift, setCoverageShift] = useState<ScheduleShift | null>(null)
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null)
  const [publishing, startPublish] = useTransition()
  const [view, setView] = useState<'calendar' | 'list'>('calendar')
  const live = useLiveSchedule(location.id)
  const toast = useToast()

  const visibleShifts = filterShifts(shifts, filters)
  const visibleStaff = filterStaff(staff, filters.search)
  const unpublished = shifts.filter((shift) => !shift.published).length

  function navigate(next: Partial<{ location: string; week: string }>) {
    const params = new URLSearchParams({ location: location.id, week: weekStart, ...next })
    router.push(`/schedule?${params.toString()}`)
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white py-2.5 pr-4 pl-14 lg:pl-4">
          <LocationSwitcher
            current={location}
            locations={locations}
            onSelect={(id) => navigate({ location: id })}
          />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {location.timezone}
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1.5" title={live ? 'Receiving live updates' : 'Reconnecting…'}>
              <span
                className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-green-500' : 'bg-slate-300'}`}
                aria-hidden
              />
              {live ? 'Live' : 'Offline'}
            </span>
            <span>
              signed in as <span className="font-medium text-slate-700">{role}</span>
            </span>
          </div>
        </header>

        <ScheduleToolbar
          days={days}
          weekStart={weekStart}
          today={today}
          skills={availableSkills(shifts)}
          filters={filters}
          unpublished={unpublished}
          publishing={publishing}
          canEdit={canEdit}
          view={view}
          onViewChange={setView}
          onFiltersChange={setFilters}
          onNavigate={(week) => navigate({ week })}
          onPublish={() =>
            startPublish(async () => {
              const result = await publishWeekAction(location.id, weekStart)
              if (toast.report(result, `Published ${unpublished} shift${unpublished === 1 ? '' : 's'}.`)) {
                router.refresh()
              }
            })
          }
        />

        {view === 'calendar' ? (
          <ScheduleGrid
            days={days}
            today={today}
            staff={visibleStaff}
            shifts={visibleShifts}
            search={filters.search}
            canEdit={canEdit}
            onSearchChange={(search) => setFilters({ ...filters, search })}
            onAddShift={(member, day) => setAssignTarget({ member, day })}
            onFindCoverage={setCoverageShift}
            onEditShift={(shift) => setEditorTarget({ mode: 'edit', day: shift.localDate, shift })}
            onUnassign={(assignmentId) =>
              startPublish(async () => {
                const result = await unassignAction(assignmentId)
                if (toast.report(result, 'Removed from shift.')) router.refresh()
              })
            }
            onCreateOpenShift={(day) => setEditorTarget({ mode: 'create', day })}
          />
        ) : (
          <ScheduleList
            days={days}
            today={today}
            staff={visibleStaff}
            shifts={visibleShifts}
            canEdit={canEdit}
            onEditShift={(shift) => setEditorTarget({ mode: 'edit', day: shift.localDate, shift })}
            onFindCoverage={setCoverageShift}
          />
        )}
      </div>

      <ShiftEditor
        target={editorTarget}
        locationId={location.id}
        days={days}
        skills={availableSkills(shifts)}
        onOpenChange={(next) => !next && setEditorTarget(null)}
      />

      <CoverageDialog shift={coverageShift} onOpenChange={(next) => !next && setCoverageShift(null)} />

      <AssignDialog
        open={assignTarget !== null}
        onOpenChange={(next) => !next && setAssignTarget(null)}
        member={assignTarget?.member ?? null}
        day={assignTarget?.day ?? ''}
        shifts={shifts}
      />
    </>
  )
}
