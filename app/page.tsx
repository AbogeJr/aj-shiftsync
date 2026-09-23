import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession, homePathFor } from '@/lib/auth'
import { Chart, Shield, Users } from '@/components/icons'

export const dynamic = 'force-dynamic'

const POINTS = [
  {
    icon: Shield,
    title: 'Rules with teeth',
    body: 'No double booking and ten hours rest are one constraint inside Postgres, not a warning you can click past.',
  },
  {
    icon: Users,
    title: 'Cover it fast',
    body: 'Someone calls out at six for a seven o’clock shift. See who can actually work it, ranked, and why the rest cannot.',
  },
  {
    icon: Chart,
    title: 'Settle the argument',
    body: 'When a server says they never get Saturday nights, look it up instead of guessing.',
  },
]

export default async function Root() {
  const session = await getSession()
  if (session) redirect(homePathFor(session.role))

  return (
    <main className="relative isolate flex h-dvh flex-col overflow-hidden bg-white">
      <div aria-hidden className="dot-grid absolute inset-0 -z-10" />

      <header className="flex shrink-0 items-center gap-2 px-6 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
          S
        </span>
        <span className="text-sm font-semibold">ShiftSync</span>
        <Link
          href="/login"
          className="ml-auto rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Open the demo
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 overflow-y-auto px-6 py-4">
        <div className="mx-auto w-full max-w-4xl">
          <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
            Coastal Eats. Four locations, two time zones.
          </p>
          <h1 className="mt-3 max-w-2xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
            The roster that says no.
          </h1>
          <p className="mt-4 max-w-xl text-base text-slate-600 sm:text-lg">
            Build the week however you like. Double bookings, short turnarounds and shifts nobody is
            certified for get thrown out before your team ever sees them.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href="/login"
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Sign in as any role
            </Link>
            <span className="text-sm text-slate-500">
              Admin, manager or staff. One click, no password.
            </span>
          </div>
        </div>

        <div className="mx-auto grid w-full max-w-4xl gap-6 sm:grid-cols-3">
          {POINTS.map(({ icon: Icon, title, body }) => (
            <div key={title}>
              <Icon className="h-5 w-5 text-brand-600" />
              <h2 className="mt-2 text-sm font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 px-6 py-3 text-xs text-slate-500">
        A scheduling demo, seeded with a full week across four restaurants.
      </footer>
    </main>
  )
}
