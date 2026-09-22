import type { ReactNode } from 'react'
import { Poppins } from 'next/font/google'
import './globals.css'

// Self-hosted by next/font at build time: no extra dependency, no network
// request from the browser, no layout shift.
// Poppins is not a variable font on Google Fonts, so the weights used are
// requested explicitly rather than pulling the whole family.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
})

export const metadata = {
  title: 'ShiftSync',
  description: 'Multi-location restaurant staff scheduling',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body>{children}</body>
    </html>
  )
}
