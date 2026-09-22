import { Bell, Calendar, Chart, Clock, Home, Search, Swap, Users } from '@/components/icons'

export interface NavItem {
  href: string
  label: string
  icon: typeof Home
}

const MANAGER_NAV: NavItem[] = [
  { href: '/overview', label: 'Overview', icon: Home },
  { href: '/schedule', label: 'Shifts', icon: Calendar },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/on-duty', label: 'On duty', icon: Clock },
  { href: '/requests', label: 'Requests', icon: Swap },
  { href: '/reports', label: 'Reports', icon: Chart },
  { href: '/audit', label: 'Audit', icon: Search },
  { href: '/my-availability', label: 'Availability', icon: Clock },
  { href: '/notifications', label: 'Alerts', icon: Bell },
]

const STAFF_NAV: NavItem[] = [
  { href: '/my-shifts', label: 'My shifts', icon: Calendar },
  { href: '/my-availability', label: 'Availability', icon: Clock },
  { href: '/my-requests', label: 'Requests', icon: Swap },
  { href: '/notifications', label: 'Alerts', icon: Bell },
]

/** Staff see only their own screens; the manager rail would 404 them anyway. */
export function navItemsFor(role: string): NavItem[] {
  return role === 'staff' ? STAFF_NAV : MANAGER_NAV
}
