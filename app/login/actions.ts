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
  const staffId = formData.get('staffId') as string | null
  const role = formData.get('role') as Role | null

  // Either pick a specific person, or use the role shortcut.
  let member: { id: string; role: Role } | undefined
  if (staffId) {
    ;[member] = await db
      .select({ id: staff.id, role: staff.role })
      .from(staff)
      .where(eq(staff.id, staffId))
      .limit(1)
    if (!member) throw new Error('That account no longer exists. Run `npm run seed`.')
  } else {
    const account = DEMO_ACCOUNTS.find((a) => a.role === role)
    if (!account) throw new Error(`Unknown demo role: ${role}`)
    ;[member] = await db
      .select({ id: staff.id, role: staff.role })
      .from(staff)
      .where(eq(staff.email, account.email))
      .limit(1)
    if (!member) {
      throw new Error(`Demo account ${account.email} is missing. Run \`npm run seed\`.`)
    }
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

  redirect(member.role === 'staff' ? '/my-shifts' : '/overview')
}

export async function logout(): Promise<void> {
  ;(await cookies()).delete(SESSION_COOKIE)
  redirect('/login')
}
