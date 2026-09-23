import Link from 'next/link'
import { getSession, homePathFor, listSignInOptions, type Role } from '@/lib/auth'
import { skillStyle } from '@/components/ui/skill-style'
import { loginAs, logout } from './actions'

export const dynamic = 'force-dynamic'

const ROLES: { role: Role; label: string; blurb: string }[] = [
  { role: 'admin', label: 'Admin', blurb: 'Sees every location' },
  { role: 'manager', label: 'Manager', blurb: 'Runs their own locations, and works shifts' },
  { role: 'staff', label: 'Staff', blurb: 'Their own shifts, swaps and availability' },
]

const ERRORS: Record<string, string> = {
  'session-expired': 'That session pointed at an account that no longer exists. Pick someone below.',
  'managers-only': 'That screen is for managers and admins. Try another account.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await getSession()
  const { error } = await searchParams
  const people = session ? [] : await listSignInOptions()

  return (
    <main className="relative isolate min-h-dvh bg-white">
      <div aria-hidden className="dot-grid absolute inset-0 -z-10" />

      <header className="flex items-center gap-2 px-6 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-500 text-xs font-bold text-white">
          S
        </span>
        <Link href="/" className="text-sm font-semibold">
          ShiftSync
        </Link>
      </header>

      <div className="mx-auto w-full max-w-4xl px-6 pb-16">
        {session ? (
          <div className="mx-auto max-w-sm pt-16">
            <h1 className="text-2xl font-bold tracking-tight">You are already signed in.</h1>
            <p className="mt-2 text-sm text-slate-600">
              Currently <strong className="text-slate-900">{session.role}</strong>.
            </p>
            <div className="mt-6 space-y-2">
              <Link
                href={homePathFor(session.role)}
                className="block rounded-lg bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-600"
              >
                Continue
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
                >
                  Sign out and pick someone else
                </button>
              </form>
            </div>
          </div>
        ) : (
          <>
            <div className="pt-8 pb-8">
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Who are you today?</h1>
              <p className="mt-2 max-w-xl text-slate-600">
                No passwords. Pick anyone and the app loads exactly what they are allowed to see.
              </p>
            </div>

            {error && ERRORS[error] && (
              <p className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {ERRORS[error]}
              </p>
            )}

            {people.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                No accounts found. Run <code>npm run seed</code>.
              </p>
            ) : (
              <div className="space-y-7">
                {ROLES.map(({ role, label, blurb }) => {
                  const group = people.filter((p) => p.role === role)
                  if (group.length === 0) return null
                  return (
                    <section key={role}>
                      <div className="mb-2.5 flex items-baseline gap-2">
                        <h2 className="text-sm font-semibold">{label}</h2>
                        <p className="text-xs text-slate-500">{blurb}</p>
                      </div>

                      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                        {group.map((person) => (
                          <form key={person.id} action={loginAs}>
                            <input type="hidden" name="staffId" value={person.id} />
                            <button
                              type="submit"
                              className="group h-full w-full rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand-500 hover:shadow-md"
                            >
                              <span className="flex items-center gap-2.5">
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700 group-hover:bg-brand-100 group-hover:text-brand-700">
                                  {person.name[0]}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold">
                                    {person.name}
                                  </span>
                                  <span className="block truncate text-xs text-slate-500">
                                    {person.locations.length > 0
                                      ? person.locations.join(', ')
                                      : 'no locations'}
                                  </span>
                                </span>
                              </span>

                              {person.skills.length > 0 && (
                                <span className="mt-2.5 flex flex-wrap gap-1">
                                  {person.skills.map((skill) => (
                                    <span
                                      key={skill}
                                      className={`rounded border px-1.5 text-xs ${skillStyle(skill)}`}
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </button>
                          </form>
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
