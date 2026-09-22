import { Calendar, Chart, Home, Users } from '@/components/icons'

export interface NavItem {
  href: string
  label: string
  icon: typeof Home
}

const MANAGER_NAV: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: Home },
  { href: '/schedule', label: 'Shifts', icon: Calendar },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/reports', label: 'Reports', icon: Chart },
]

const STAFF_NAV: NavItem[] = [{ href: '/my-shifts', label: 'My shifts', icon: Calendar }]

/** Staff see only their own screens; the manager rail would 404 them anyway. */
export function navItemsFor(role: string): NavItem[] {
  return role === 'staff' ? STAFF_NAV : MANAGER_NAV
}
