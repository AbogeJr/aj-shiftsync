import Link from 'next/link'
import { DEMO_ACCOUNTS, getSession } from '@/lib/auth'
import { loginAs, logout } from './actions'

export const dynamic = 'force-dynamic'

const ROLE_BLURB: Record<string, string> = {
  admin: 'Every location',
  manager: 'Mission Bay & Santa Monica',
  staff: 'Own shifts only',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await getSession()
  const { error } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
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
            The schedule is for managers and admins. Sign in with another role.
          </p>
        )}

        {session ? (
          <>
            <p className="mb-4 text-sm text-slate-600">
              Signed in as <strong className="text-slate-900">{session.role}</strong>
            </p>
            <div className="space-y-2">
              <Link
                href={session.role === 'staff' ? '/my-shifts' : '/schedule'}
                className="block rounded-lg bg-brand-500 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-brand-600"
              >
                {session.role === 'staff' ? 'Go to my shifts' : 'Go to schedule'}
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
              Demo sign-in — no passwords. Accounts come from <code>npm run seed</code>.
            </p>
            <div className="space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <form key={account.role} action={loginAs}>
                  <input type="hidden" name="role" value={account.role} />
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between rounded-lg border border-slate-300 px-4 py-2.5 text-left hover:border-brand-500 hover:bg-brand-50"
                  >
                    <span className="text-sm font-semibold capitalize">{account.role}</span>
                    <span className="text-xs text-slate-500">{ROLE_BLURB[account.role]}</span>
                  </button>
                </form>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}
