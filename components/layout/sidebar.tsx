'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logout } from '@/components/icons'
import { navItemsFor } from './nav-items'
import { useUnreadCount } from './notification-watcher'
import { logout } from '@/app/login/actions'

export function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname()
  const items = navItemsFor(role)
  const unread = useUnreadCount()

  return (
    <>
      <ul className="flex flex-1 flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href}>
              <Link
                // Every screen is force-dynamic, so a prefetch is a full server
                // render with its own queries. Hovering the rail would re-render
                // the whole app for a hint the router cannot keep for long.
                prefetch={false}
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] lg:whitespace-nowrap ${
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5 shrink-0" />
                  {href === '/notifications' && unread > 0 && (
                    <span
                      aria-label={`${unread} unread`}
                      className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold text-white"
                    >
                      {unread > 9 ? '9+' : unread}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            </li>
          )
        })}
      </ul>

      <form action={logout} className="mt-2">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] lg:whitespace-nowrap"
        >
          <Logout className="h-5 w-5 shrink-0" />
          Log out
        </button>
      </form>
    </>
  )
}
