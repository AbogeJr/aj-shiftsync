// Inline SVGs so the project takes no icon-library dependency.
type P = { className?: string }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  viewBox: '0 0 24 24',
}

export const Chevron = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="m6 9 6 6 6-6" /></svg>
)
export const Filter = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>
)
export const Gear = ({ className }: P) => (
  <svg {...stroke} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.9 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2A1.7 1.7 0 0 0 7.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 5 7.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1Z" />
  </svg>
)
export const Search = ({ className }: P) => (
  <svg {...stroke} className={className}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
)
export const Upload = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M12 16V4m0 0L7 9m5-5 5 5M4 18v2h16v-2" /></svg>
)
export const Home = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" /></svg>
)
export const Calendar = ({ className }: P) => (
  <svg {...stroke} className={className}>
    <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
)
export const Users = ({ className }: P) => (
  <svg {...stroke} className={className}>
    <circle cx="9" cy="8" r="3.2" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.2A3 3 0 0 0 17 5.3M18.5 20a5.5 5.5 0 0 0-3-4.9" />
  </svg>
)
export const Chart = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
)
export const Logout = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M15 17l5-5-5-5M20 12H9M12 20H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7" /></svg>
)
export const Menu = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
)
export const Close = ({ className }: P) => (
  <svg {...stroke} className={className}><path d="M6 6l12 12M18 6 6 18" /></svg>
)
export const Clock = ({ className }: P) => (
  <svg {...stroke} className={className}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
export const Swap = ({ className }: P) => (
  <svg {...stroke} className={className}>
    <path d="M4 7h13l-3-3M20 17H7l3 3" />
  </svg>
)
export const Bell = ({ className }: P) => (
  <svg {...stroke} className={className}>
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)
