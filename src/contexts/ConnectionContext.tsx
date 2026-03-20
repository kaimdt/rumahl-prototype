import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { haService } from '@/lib/homeAssistant'

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

  const checkHomeAssistant = async () => {
    try {
      await haService.getStates()
      setStatus(prev => ({
        ...prev,
        homeAssistant: 'connected',
        lastHACheck: new Date(),
      }))
    } catch (error) {
      setStatus(prev => ({
        ...prev,
        homeAssistant: 'error',
        lastHACheck: new Date(),
      }))
    }
  }

  const checkBackend = async () => {
    // For now, backend check is the same as HA check
    // This can be extended when using the Rust backend
    await checkHomeAssistant()
    setStatus(prev => ({
      ...prev,
      backend: prev.homeAssistant === 'connected' ? 'connected' : 'error',
      lastBackendCheck: new Date(),
    }))
  }

  // Check connection on mount and periodically
  useEffect(() => {
    checkBackend()
    const interval = setInterval(checkBackend, 10000) // Check every 10 seconds
    return () => clearInterval(interval)
  }, [])

  return (
    <ConnectionContext.Provider
      value={{
        ...status,
        checkBackend,
        checkHomeAssistant,
      }}
    >
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
