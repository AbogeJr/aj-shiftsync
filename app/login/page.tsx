import { DEMO_ACCOUNTS, getSession } from '@/lib/auth'
import { loginAs, logout } from './actions'

export const dynamic = 'force-dynamic'

export default async function LoginPage() {
  const session = await getSession()

  return (
    <main style={{ fontFamily: 'system-ui', padding: 24, maxWidth: 480 }}>
      <h1 style={{ fontSize: 20 }}>ShiftSync</h1>

      {session ? (
        <>
          <p>
            Signed in as <strong>{session.role}</strong> ({session.userId})
          </p>
          <form action={logout}>
            <button type="submit" style={{ padding: '8px 16px' }}>
              Log out
            </button>
          </form>
        </>
      ) : (
        <>
          <p style={{ color: '#666' }}>
            Demo sign-in. Accounts come from <code>npm run seed</code>.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 260 }}>
            {DEMO_ACCOUNTS.map((account) => (
              <form key={account.role} action={loginAs}>
                <input type="hidden" name="role" value={account.role} />
                <button type="submit" style={{ padding: '8px 16px', width: '100%' }}>
                  Log in as {account.role[0].toUpperCase() + account.role.slice(1)}
                </button>
              </form>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
