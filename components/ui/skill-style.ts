/** Shift-block colour per required skill. One place, so blocks and filter chips agree. */
const SKILL_STYLES: Record<string, string> = {
  bartender: 'bg-amber-100 text-amber-900 border-amber-300',
  'line cook': 'bg-green-100 text-green-900 border-green-300',
  server: 'bg-blue-100 text-blue-900 border-blue-300',
  host: 'bg-rose-100 text-rose-900 border-rose-300',
}

const FALLBACK = 'bg-slate-100 text-slate-800 border-slate-300'

export function skillStyle(skill: string | null): string {
  return (skill && SKILL_STYLES[skill]) || FALLBACK
}
