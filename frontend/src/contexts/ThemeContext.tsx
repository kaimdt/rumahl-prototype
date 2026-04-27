import { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react'
import { useLocalStorage } from '@/lib/storage'
import type { ThemeMode } from '@/lib/types'

interface ThemeContextType {
  theme: ThemeMode
  sleepMode: boolean
  setSleepMode: (enabled: boolean) => void
  autoTheme: boolean
  setAutoTheme: (enabled: boolean) => void
  selectedTheme: ThemeMode | 'auto'
  setSelectedTheme: (theme: ThemeMode | 'auto') => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

function getThemeFromTime(): ThemeMode {
  const hour = new Date().getHours()
  
  if (hour >= 6 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'evening'
  return 'night'
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [sleepMode, setSleepMode] = useLocalStorage<boolean>('ha-sleep-mode', false)
  const [autoTheme, setAutoTheme] = useLocalStorage<boolean>('ha-auto-theme', true)
  const [selectedTheme, setSelectedTheme] = useLocalStorage<ThemeMode | 'auto'>('ha-selected-theme', 'auto')
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (sleepMode) return 'sleep'
    if (selectedTheme !== 'auto') return selectedTheme
    return getThemeFromTime()
  })

  useEffect(() => {
    if (sleepMode) {
      setTheme('sleep')
      return
    }

    // If user has a specific theme selected, use that
    if (selectedTheme !== 'auto') {
      setTheme(selectedTheme)
      return
    }

    if (!autoTheme) return

    const updateTheme = () => {
      setTheme(getThemeFromTime())
    }

    updateTheme()
    const interval = setInterval(updateTheme, 60000)

    return () => clearInterval(interval)
  }, [sleepMode, autoTheme, selectedTheme])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const contextValue = useMemo(() => ({
    theme, sleepMode, setSleepMode, autoTheme, setAutoTheme, selectedTheme, setSelectedTheme,
  }), [theme, sleepMode, setSleepMode, autoTheme, setAutoTheme, selectedTheme, setSelectedTheme])

  return (
    <ThemeContext.Provider value={contextValue}>
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
