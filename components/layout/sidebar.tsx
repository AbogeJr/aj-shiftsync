'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Logout } from '@/components/icons'
import { navItemsFor } from './nav-items'
import { logout } from '@/app/login/actions'

export function SidebarNav({ role, onNavigate }: { role: string; onNavigate?: () => void }) {
  const pathname = usePathname()
  const items = navItemsFor(role)

  return (
    <>
      <ul className="flex flex-1 flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px] ${
                  active
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                {label}
              </Link>
            </li>
          )
        })}
      </ul>

      <form action={logout} className="mt-2">
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:flex-col lg:gap-1 lg:px-1 lg:py-2 lg:text-[11px]"
        >
          <Logout className="h-5 w-5 shrink-0" />
          Log out
        </button>
      </form>
    </>
  )
}
