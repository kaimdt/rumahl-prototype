import { createContext, useContext, useEffect, useState } from 'react'
import { useKV } from '@github/spark/hooks'
import type { ThemeMode } from '@/lib/types'

interface ThemeContextType {
  theme: ThemeMode
  sleepMode: boolean
  setSleepMode: (enabled: boolean) => void
  autoTheme: boolean
  setAutoTheme: (enabled: boolean) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getThemeFromTime(): ThemeMode {
  const hour = new Date().getHours()
  
  if (hour >= 6 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [sleepMode, setSleepMode] = useKV<boolean>('ha-sleep-mode', false)
  const [autoTheme, setAutoTheme] = useKV<boolean>('ha-auto-theme', true)
  const [theme, setTheme] = useState<ThemeMode>(() => (sleepMode ?? false) ? 'sleep' : getThemeFromTime())

  useEffect(() => {
    if (sleepMode ?? false) {
      setTheme('sleep')
      return
    }

    if (!(autoTheme ?? true)) return

    const updateTheme = () => {
      setTheme(getThemeFromTime())
    }

    updateTheme()
    const interval = setInterval(updateTheme, 60000)

    return () => clearInterval(interval)
  }, [sleepMode, autoTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, sleepMode: sleepMode ?? false, setSleepMode, autoTheme: autoTheme ?? true, setAutoTheme }}>
      <div className="theme-transition min-h-screen bg-background text-foreground">
        {children}
      </div>
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}
