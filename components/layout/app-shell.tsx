'use client'

import { useState, type ReactNode } from 'react'
import { Close, Menu } from '@/components/icons'
import { SidebarNav } from './sidebar'
import { ToastProvider } from '@/components/ui/toast'
import { NotificationWatcher } from './notification-watcher'

/**
 * Application chrome shared by every screen.
 *
 * The navigation is a fixed icon rail from `lg` up and a slide-over drawer
 * below it, so the same markup serves phone and desktop without duplicating
 * the nav definition.
 */
export function AppShell({ role, children }: { role: string; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <ToastProvider>
    <NotificationWatcher>
    <div className="flex h-dvh bg-slate-50">
      {/* desktop rail */}
      <nav className="hidden w-24 shrink-0 flex-col gap-1 bg-slate-900 p-2 lg:flex">
        <div className="mb-2 flex h-9 items-center justify-center">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
            S
          </span>
        </div>
        <SidebarNav role={role} />
      </nav>

      {/* mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/40"
          />
          <nav className="relative flex h-full w-64 flex-col gap-1 bg-slate-900 p-3">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
                S
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <Close className="h-5 w-5" />
              </button>
            </div>
            <SidebarNav role={role} onNavigate={() => setDrawerOpen(false)} />
          </nav>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          className="absolute top-2.5 left-2 z-30 rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        {children}
      </div>
    </div>
    </NotificationWatcher>
    </ToastProvider>
  )
}
