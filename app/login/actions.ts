'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { staff } from '@/lib/db/schema'
import { DEMO_ACCOUNTS, SESSION_COOKIE, signSession, type Role } from '@/lib/auth'

/**
 * Sign in as one of the seeded demo accounts. No password: the whole point is
 * one click. See lib/auth.ts for why this is not production auth.
 */
export async function loginAs(formData: FormData): Promise<void> {
  const role = formData.get('role') as Role | null
  const account = DEMO_ACCOUNTS.find((a) => a.role === role)
  if (!account) throw new Error(`Unknown demo role: ${role}`)

  const [member] = await db
    .select({ id: staff.id, role: staff.role })
    .from(staff)
    .where(eq(staff.email, account.email))
    .limit(1)

  if (!member) {
    throw new Error(`Demo account ${account.email} is missing. Run \`npm run seed\`.`)
  }

  // Role comes from the database row, never from the form, so a crafted POST
  // cannot mint a session with a role the account does not have.
  ;(await cookies()).set(SESSION_COOKIE, signSession({ userId: member.id, role: member.role }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 8,
  })

  redirect(member.role === 'staff' ? '/my-shifts' : '/schedule')
}

export async function logout(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
