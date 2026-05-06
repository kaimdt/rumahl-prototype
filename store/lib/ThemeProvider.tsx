'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'

const ThemeContext = createContext<{
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}>({ theme: 'dark', toggle: () => {}, setTheme: () => {} })

export function useStoreTheme() { return useContext(ThemeContext) }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('iora-store-theme') as Theme | null
    if (saved === 'light' || saved === 'dark') setTheme(saved)
    else if (window.matchMedia('(prefers-color-scheme: light)').matches) setTheme('light')
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('iora-store-theme', theme)
  }, [theme, mounted])

  const toggle = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return <ThemeContext.Provider value={{ theme, toggle, setTheme }}>{children}</ThemeContext.Provider>
}
