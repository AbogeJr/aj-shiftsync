import Link from 'next/link'
import { getSession, listSignInOptions, type Role } from '@/lib/auth'
import { loginAs, logout } from './actions'

export const dynamic = 'force-dynamic'

const ROLE_BLURB: Record<Role, string> = {
  admin: 'Every location',
  manager: 'Their own locations',
  staff: 'Own shifts only',
}

const ROLE_STYLE: Record<Role, string> = {
  admin: 'bg-brand-100 text-brand-700',
  manager: 'bg-blue-100 text-blue-800',
  staff: 'bg-slate-100 text-slate-600',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await getSession()
  const { error } = await searchParams
  const people = session ? [] : await listSignInOptions()

  const grouped = (['admin', 'manager', 'staff'] as Role[]).map((role) => ({
    role,
    people: people.filter((p) => p.role === role),
  }))

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-base font-bold text-white">
            S
          </div>
          <div>
            <h1 className="text-lg leading-tight font-semibold">ShiftSync</h1>
            <p className="text-xs text-slate-500">Multi-location scheduling</p>
          </div>
        </div>

        {error === 'session-expired' && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That session pointed at an account that no longer exists. Sign in again.
          </p>
        )}
        {error === 'managers-only' && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            That screen is for managers and admins. Sign in with another account.
          </p>
        )}

        {session ? (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Signed in as <strong className="text-slate-900">{session.role}</strong>
            </p>
            <div className="space-y-2">
              <Link
                href={session.role === 'staff' ? '/my-shifts' : '/overview'}
                className="block rounded-lg bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-600"
              >
                Continue
              </Link>
              <form action={logout}>
                <button
                  type="submit"
                  className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
                >
                  Log out
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Demo sign-in — no passwords. Pick anyone to see the app as they see it.
            </p>

            {people.length === 0 ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                No accounts found. Run <code>npm run seed</code>.
              </p>
            ) : (
              <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
                {grouped.map(
                  ({ role, people: group }) =>
                    group.length > 0 && (
                      <section key={role}>
                        <h2 className="mb-1.5 text-xs font-semibold tracking-wide text-slate-400 uppercase">
                          {role} · {ROLE_BLURB[role]}
                        </h2>
                        <div className="space-y-1.5">
                          {group.map((person) => (
                            <form key={person.id} action={loginAs}>
                              <input type="hidden" name="staffId" value={person.id} />
                              <button
                                type="submit"
                                className="flex w-full items-center gap-3 rounded-lg border border-slate-300 px-3 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50"
                              >
                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                                  {person.name[0]}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-semibold">
                                    {person.name}
                                  </span>
                                  <span className="block truncate text-xs text-slate-500">
                                    {person.skills.join(', ') || 'no skills'}
                                    {person.locations.length > 0 && ` · ${person.locations.join(', ')}`}
                                  </span>
                                </span>
                                <span
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${ROLE_STYLE[person.role]}`}
                                >
                                  {person.role}
                                </span>
                              </button>
                            </form>
                          ))}
                        </div>
                      </section>
                    ),
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
