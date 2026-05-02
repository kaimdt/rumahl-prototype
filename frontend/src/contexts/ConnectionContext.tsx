import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react'

import { getBackendUrl, getDevBridgeUrl } from '@/lib/config'
const API_BASE = getBackendUrl()

interface ConnectionStatus {
  backend: 'connected' | 'disconnected' | 'error'
  homeAssistant: 'connected' | 'disconnected' | 'error'
  devBridge: 'connected' | 'disconnected' | 'error'
  lastBackendCheck: Date | null
  lastHACheck: Date | null
  lastDevBridgeCheck: Date | null
}

interface ConnectionContextType extends ConnectionStatus {
  checkBackend: () => Promise<void>
  checkHomeAssistant: () => Promise<void>
  checkDevBridge: () => Promise<void>
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined)

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>({
    backend: 'disconnected',
    homeAssistant: 'disconnected',
    devBridge: 'disconnected',
    lastBackendCheck: null,
    lastHACheck: null,
    lastDevBridgeCheck: null,
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

  // Separate Dev Bridge health check
  const checkDevBridge = useCallback(async () => {
    try {
      const devBridgeUrl = getDevBridgeUrl()
      const response = await fetch(`${devBridgeUrl}/dev/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        setStatus(prev => ({
          ...prev,
          devBridge: 'connected',
          lastDevBridgeCheck: new Date(),
        }))
      } else {
        setStatus(prev => ({
          ...prev,
          devBridge: 'error',
          lastDevBridgeCheck: new Date(),
        }))
      }
    } catch {
      setStatus(prev => ({
        ...prev,
        devBridge: 'error',
        lastDevBridgeCheck: new Date(),
      }))
    }
  }, [])

  // Check connections on mount and periodically
  useEffect(() => {
    checkBackend()
    checkDevBridge()
    const interval = setInterval(() => {
      checkBackend()
      checkDevBridge()
    }, 30000) // Check every 30 seconds
    return () => clearInterval(interval)
  }, [checkBackend, checkDevBridge])

  const contextValue = useMemo(() => ({
    ...status,
    checkBackend,
    checkHomeAssistant,
    checkDevBridge,
  }), [status, checkBackend, checkHomeAssistant, checkDevBridge])

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
