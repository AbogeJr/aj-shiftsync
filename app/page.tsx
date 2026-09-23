import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession, homePathFor } from '@/lib/auth'
import { Calendar, Clock, Shield, Users } from '@/components/icons'

export const dynamic = 'force-dynamic'

/**
 * The public face of the app. Signed-in visitors never see it - they go
 * straight to their own home - so it exists purely for a first arrival.
 */
export default async function Root() {
  const session = await getSession()
  if (session) redirect(homePathFor(session.role))

  return (
    <main className="min-h-full bg-white">
      <header className="mx-auto flex max-w-5xl items-center gap-2 px-6 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          S
        </span>
        <span className="text-base font-semibold">ShiftSync</span>
        <Link
          href="/login"
          className="ml-auto rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
        >
          Open the demo
        </Link>
      </header>

      <section className="mx-auto max-w-5xl px-6 pt-10 pb-14 sm:pt-16">
        <p className="text-xs font-semibold tracking-wide text-brand-600 uppercase">
          Coastal Eats · 4 locations · 2 timezones
        </p>
        <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Scheduling for restaurant groups that run in more than one place.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-slate-600 sm:text-lg">
          One roster across every location, in every timezone. Illegal schedules are refused by the
          database rather than caught in review, and when someone calls out, the people who can
          actually cover are already ranked.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Sign in as any role
          </Link>
          <span className="text-sm text-slate-500">
            Admin, manager or staff — one click, no password.
          </span>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-slate-50">
        <div className="mx-auto grid max-w-5xl gap-px overflow-hidden px-6 py-12 sm:grid-cols-2">
          {[
            {
              icon: Shield,
              title: 'Rules that cannot be worked around',
              body: 'No double-booking and a 10-hour rest gap are one Postgres exclusion constraint, so the schedule stays legal no matter what writes to it. Skills, certification, availability and hour limits are checked with the reason stated in plain language.',
            },
            {
              icon: Users,
              title: 'Coverage in one click',
              body: 'Someone calls out at 6pm for a 7pm shift. Find coverage ranks everyone eligible right now by who is furthest under their desired hours — and lists who is not eligible, with why.',
            },
            {
              icon: Clock,
              title: 'Timezones and DST handled properly',
              body: 'Every instant is stored as timestamptz. Availability is wall-clock time plus the staff member’s own timezone, resolved at query time, so 9am stays 9am on both sides of a transition.',
            },
            {
              icon: Calendar,
              title: 'Fairness you can prove',
              body: '"I never get Saturday nights" is answerable. Premium shifts are derived from the shift times in the location’s own timezone, never stored, so the number cannot drift while it is being disputed.',
            },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-slate-50 py-4 sm:px-6">
              <Icon className="h-5 w-5 text-brand-600" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-14">
        <h2 className="text-xs font-semibold tracking-wide text-slate-400 uppercase">
          What it replaces
        </h2>
        <ul className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {[
            ['Staff call out with no coverage', 'Ranked, pre-checked suggestions and staff self-pickup'],
            ['Overtime costs spiral unseen', 'Warnings at 35 and 8 hours, a hard block at 12, projected wages per week'],
            ['Shift distribution feels unfair', 'Hours and premium shifts per person against their stated preference'],
            ['Managers hoard good employees', 'Hours totalled across every location, not just the one you manage'],
            ['No central view of who works where', 'One roster, plus an on-duty board that updates live'],
          ].map(([problem, answer]) => (
            <li key={problem} className="border-t border-slate-200 pt-3">
              <p className="text-sm font-medium text-slate-400 line-through">{problem}</p>
              <p className="mt-0.5 text-sm text-slate-700">{answer}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-6 py-6 text-sm text-slate-500">
          <span>ShiftSync — a scheduling demo, seeded with realistic data.</span>
          <Link href="/login" className="ml-auto font-medium text-brand-600 hover:text-brand-700">
            Open the demo →
          </Link>
        </div>
      </footer>
    </main>
  )
}
