import type { ReactNode } from 'react'

export function Alert({ tone = 'error', children }: { tone?: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const tones = {
    error: 'bg-rose-50 text-rose-800',
    warning: 'bg-amber-50 text-amber-900',
    info: 'bg-slate-100 text-slate-700',
  }
  return <p className={`rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>
}

export function Badge({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${className || 'bg-slate-100 text-slate-600'}`}>
      {children}
    </span>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    // pl-14 leaves room for the mobile menu button, which is only shown below lg.
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white py-3 pr-4 pl-14 lg:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
    </header>
  )
}
