import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

interface ConnectionStatus {
  backend: 'connected' | 'disconnected' | 'error'
  homeAssistant: 'connected' | 'disconnected' | 'error'
  lastBackendCheck: Date | null
  lastHACheck: Date | null
}

interface ConnectionContextType extends ConnectionStatus {
  checkBackend: () => Promise<void>
  checkHomeAssistant: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>({
    backend: 'disconnected',
    homeAssistant: 'disconnected',
    lastBackendCheck: null,
    lastHACheck: null,
  })

  const checkBackend = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/health`)
      if (response.ok) {
        const data = await response.json()
        setStatus(prev => ({
          ...prev,
          backend: 'connected',
          homeAssistant: data.ha_connected ? 'connected' : 'error',
          lastBackendCheck: new Date(),
          lastHACheck: new Date(),
        }))
      } else {
        setStatus(prev => ({
          ...prev,
          backend: 'error',
          lastBackendCheck: new Date(),
        }))
      }
    } catch {
      setStatus(prev => ({
        ...prev,
        backend: 'error',
        lastBackendCheck: new Date(),
      }))
    }
  }, [])

  // checkHomeAssistant now delegates to checkBackend (health endpoint reports HA status)
  const checkHomeAssistant = checkBackend

  // Check connection on mount and periodically
  useEffect(() => {
    checkBackend()
    const interval = setInterval(checkBackend, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [checkBackend])

  const contextValue = useMemo(() => ({
    ...status,
    checkBackend,
    checkHomeAssistant,
  }), [status, checkBackend, checkHomeAssistant])

  return (
    <ConnectionContext.Provider value={contextValue}>
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection() {
  const context = useContext(ConnectionContext)
  if (!context) {
    throw new Error('useConnection must be used within ConnectionProvider')
  }
  return context
}
