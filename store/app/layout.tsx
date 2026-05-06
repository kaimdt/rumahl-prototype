import type { Metadata } from 'next'
import { ThemeProvider } from '@/lib/ThemeProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'IORA Store – Themes & Apps',
  description: 'Entdecke Themes und Apps für dein IORA Smart Home Dashboard.',
  icons: { icon: '/favicon.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
