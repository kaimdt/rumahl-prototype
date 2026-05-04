import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'

interface CurrentBackgroundContextType {
  currentImageUrl: string | null
  setCurrentImageUrl: (url: string | null) => void
}

const CurrentBackgroundContext = createContext<CurrentBackgroundContextType | undefined>(undefined)

export function CurrentBackgroundProvider({ children }: { children: ReactNode }) {
  const [currentImageUrl, setCurrentImageUrl] = useState<string | null>(null)

  const stableSetUrl = useCallback((url: string | null) => {
    setCurrentImageUrl(url)
  }, [])

  const value = useMemo(() => ({
    currentImageUrl,
    setCurrentImageUrl: stableSetUrl,
  }), [currentImageUrl, stableSetUrl])

  return (
    <CurrentBackgroundContext.Provider value={value}>
      {children}
    </CurrentBackgroundContext.Provider>
  )
}

export function useCurrentBackground() {
  const context = useContext(CurrentBackgroundContext)
  if (!context) {
    throw new Error('useCurrentBackground must be used within CurrentBackgroundProvider')
  }
  return context
}
