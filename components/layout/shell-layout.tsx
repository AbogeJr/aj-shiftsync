import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import { AppShell } from './app-shell'

/** Shared layout: resolves the session once so the nav can be role-aware. */
export async function ShellLayout({ children }: { children: ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/login')
  return <AppShell role={session.role}>{children}</AppShell>
}
