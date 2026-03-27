import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ECOBE Control Plane',
  description: 'Governed run orchestration, policy control, audit, and billing on top of ECOBE Engine.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
