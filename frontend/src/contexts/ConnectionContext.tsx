import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react'

import { getBackendUrl, getDevBridgeUrl } from '@/lib/config'
const API_BASE = getBackendUrl()

interface ConnectionStatus {
  backend: 'connected' | 'disconnected' | 'error'
  homeAssistant: 'connected' | 'disconnected' | 'error'
  devBridge: 'connected' | 'disconnected' | 'error'
  lastBackendCheck: Date | null
  lastHACheck: Date | null
  lastDevBridgeCheck: Date | null
  /** Letzter Heartbeat vom Dev Bridge SSE – null wenn nicht verbunden */
  lastDevBridgeHeartbeat: Date | null
  /** Build-ID der Dev Bridge (aus SSE-Heartbeat) */
  devBridgeBuild: string | null
}

interface ConnectionContextType extends ConnectionStatus {
  checkBackend: () => Promise<void>
  checkHomeAssistant: () => Promise<void>
  checkDevBridge: () => Promise<void>
  /** Callback für Dev-Bridge-SSE-Events (heartbeat, service_status, etc.) */
  onDevBridgeEvent?: (event: string, data: unknown) => void
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined)

/**
 * Verbindungs-Manager mit:
 * - Exponentiellem Backoff (1s → 2s → 4s → … max 30s)
 * - SSE-Stream zur Dev Bridge (/dev/events) für Echtzeit-Heartbeats
 * - Heartbeat-Erkennung: Wenn >15s kein Heartbeat → devBridge = 'error'
 * - Parallel-Polling als Fallback
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>({
    backend: 'disconnected',
    homeAssistant: 'disconnected',
    devBridge: 'disconnected',
    lastBackendCheck: null,
    lastHACheck: null,
    lastDevBridgeCheck: null,
    lastDevBridgeHeartbeat: null,
    devBridgeBuild: null,
  })

  // ── Refs für Backoff & SSE ──────────────────────────────────
  const backendRetryRef = useRef(0)
  const devBridgeRetryRef = useRef(0)
  const sseRef = useRef<EventSource | null>(null)
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Heartbeat-Timeout: wenn >15s kein Heartbeat → offline ──
  const scheduleHeartbeatTimeout = useCallback(() => {
    if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current)
    heartbeatTimerRef.current = setTimeout(() => {
      if (!mountedRef.current) return
      setStatus(prev => {
        // Nur als 'error' markieren, wenn wir vorher 'connected' waren
        if (prev.devBridge === 'connected') {
          return { ...prev, devBridge: 'error', lastDevBridgeCheck: new Date() }
        }
        return prev
      })
    }, 15_000) // 15s ohne Heartbeat → offline
  }, [])

  // ── SSE-Verbindung zur Dev Bridge aufbauen ──────────────────
  const connectDevBridgeSSE = useCallback(() => {
    if (!mountedRef.current) return

    // Bestehende SSE-Verbindung schließen
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    const devBridgeUrl = getDevBridgeUrl()
    const es = new EventSource(`${devBridgeUrl}/dev/events`)

    es.addEventListener('connected', () => {
      if (!mountedRef.current) return
      devBridgeRetryRef.current = 0 // Backoff zurücksetzen
      setStatus(prev => ({
        ...prev,
        devBridge: 'connected',
        lastDevBridgeCheck: new Date(),
      }))
    })

    es.addEventListener('heartbeat', (e: Event) => {
      if (!mountedRef.current) return
      const msgEvent = e as MessageEvent
      try {
        const data = JSON.parse(msgEvent.data)
        devBridgeRetryRef.current = 0 // Backoff zurücksetzen
        setStatus(prev => ({
          ...prev,
          devBridge: 'connected',
          devBridgeBuild: data.build || prev.devBridgeBuild,
          lastDevBridgeHeartbeat: new Date(),
          lastDevBridgeCheck: new Date(),
        }))
        scheduleHeartbeatTimeout()
      } catch {
        // ignorieren
      }
    })

    es.addEventListener('service_status', (e: Event) => {
      if (!mountedRef.current) return
      // Kann für Live-Updates im DevBridgeTab genutzt werden
    })

    es.onerror = () => {
      if (!mountedRef.current) return
      es.close()
      sseRef.current = null

      setStatus(prev => ({
        ...prev,
        devBridge: 'error',
        lastDevBridgeCheck: new Date(),
      }))

      // Exponentielles Backoff für SSE-Wiederverbindung
      const retry = devBridgeRetryRef.current
      const delay = Math.min(1000 * Math.pow(2, retry), 30_000) // 1s, 2s, 4s, 8s, 16s, 30s max
      devBridgeRetryRef.current = Math.min(retry + 1, 10)
      setTimeout(() => connectDevBridgeSSE(), delay)
    }

    sseRef.current = es
  }, [scheduleHeartbeatTimeout])

  // ── Backend-Check (mit exponentiellem Backoff) ──────────────
  const checkBackend = useCallback(async () => {
    if (!mountedRef.current) return
    try {
      const response = await fetch(`${API_BASE}/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        const data = await response.json()
        backendRetryRef.current = 0 // Backoff zurücksetzen
        setStatus(prev => ({
          ...prev,
          backend: 'connected',
          homeAssistant: data.ha_connected ? 'connected' : 'error',
          lastBackendCheck: new Date(),
          lastHACheck: new Date(),
        }))
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch {
      if (!mountedRef.current) return
      setStatus(prev => ({
        ...prev,
        backend: 'error',
        lastBackendCheck: new Date(),
      }))
      // Exponentielles Backoff für den nächsten Poll
      const retry = backendRetryRef.current
      const delay = Math.min(1000 * Math.pow(2, retry), 30_000)
      backendRetryRef.current = Math.min(retry + 1, 10)
      setTimeout(() => checkBackend(), delay)
      return // Nicht den normalen Intervall starten
    }
  }, [])

  // checkHomeAssistant delegiert an checkBackend
  const checkHomeAssistant = checkBackend

  // Fallback-Dev-Bridge-Check (nur wenn SSE nicht funktioniert)
  const checkDevBridge = useCallback(async () => {
    if (!mountedRef.current) return
    // Nur als Fallback, wenn SSE nicht verbunden ist
    if (sseRef.current) return
    try {
      const devBridgeUrl = getDevBridgeUrl()
      const response = await fetch(`${devBridgeUrl}/dev/health`, {
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        devBridgeRetryRef.current = 0
        setStatus(prev => ({
          ...prev,
          devBridge: 'connected',
          lastDevBridgeCheck: new Date(),
        }))
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch {
      if (!mountedRef.current) return
      setStatus(prev => ({
        ...prev,
        devBridge: 'error',
        lastDevBridgeCheck: new Date(),
      }))
    }
  }, [])

  // ── Initialisierung ────────────────────────────────────────
  useEffect(() => {
    // Beim Start: Backend prüfen und SSE zur Dev Bridge aufbauen
    checkBackend()
    connectDevBridgeSSE()

    // Backend-Polling alle 15s (zusätzlich zum Backoff)
    const backendInterval = setInterval(checkBackend, 15_000)

    return () => {
      clearInterval(backendInterval)
      if (sseRef.current) {
        sseRef.current.close()
        sseRef.current = null
      }
      if (heartbeatTimerRef.current) {
        clearTimeout(heartbeatTimerRef.current)
        heartbeatTimerRef.current = null
      }
    }
  }, [checkBackend, connectDevBridgeSSE])

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
