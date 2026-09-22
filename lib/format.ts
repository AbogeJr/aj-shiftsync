/** Presentation helpers. Pure, no React, no database. */

/** '09:00' -> '9am', '17:30' -> '5:30pm' */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

// Local dates are plain YYYY-MM-DD strings already resolved to the location's
// timezone, so they are read back as UTC to stop the server's own zone shifting
// them by a day.
function asUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`)
}

export function weekdayLabel(iso: string): { weekday: string; day: number } {
  const d = asUtcDate(iso)
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    day: d.getUTCDate(),
  }
}

export function longDateLabel(iso: string): string {
  return asUtcDate(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export function weekRangeLabel(days: string[]): string {
  const fmt = (iso: string) =>
    asUtcDate(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  return `${fmt(days[0])} – ${fmt(days[days.length - 1])}`
}

export function addWeeks(weekStart: string, delta: number): string {
  const d = asUtcDate(weekStart)
  d.setUTCDate(d.getUTCDate() + delta * 7)
  return d.toISOString().slice(0, 10)
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function hours(value: number): string {
  return value.toFixed(2)
}

/** Index matches Postgres `extract(dow)`: 0 = Sunday. Client-safe. */
export const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const
