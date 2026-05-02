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
  const devBridgeAvailableRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ── Heartbeat-Timeout: wenn >30s kein Heartbeat → offline ──
  // Erhöht von 15s auf 30s, um kurze Netzwerk-Hicks zu überbrücken.
  // Zusätzlich: bei 'error' sofort neu verbinden statt auf den nächsten
  // Poll zu warten.
  // ── SSE-Verbindung zur Dev Bridge (einmalig, browser-eigenes Reconnect) ──
  // Nutzt den nativen EventSource-Reconnect des Browsers statt manuellem
  // Schließen+Neuöffnen. Der Browser reconnectet automatisch bei Verbindungs-
  // abbruch (HTTP-Ergebnis-Code < 200 oder >= 300). Wir setzen nur den Status
  // und lassen den Browser arbeiten.
  const connectDevBridgeSSE = useCallback(() => {
    if (!mountedRef.current) return
    if (!devBridgeAvailableRef.current) return

    const devBridgeUrl = getDevBridgeUrl()
    if (!devBridgeUrl) return

    // Bestehende SSE-Verbindung sauber schließen (falls vorhanden)
    if (sseRef.current) {
      sseRef.current.close()
      sseRef.current = null
    }

    const es = new EventSource(`${devBridgeUrl}/dev/events`)

    // Verbindung steht
    es.addEventListener('connected', () => {
      if (!mountedRef.current) return
      devBridgeRetryRef.current = 0
      setStatus(prev => ({
        ...prev,
        devBridge: 'connected',
        lastDevBridgeCheck: new Date(),
      }))
    })

    // Heartbeat empfangen (alle 5s von der Dev Bridge)
    es.addEventListener('heartbeat', (e: Event) => {
      if (!mountedRef.current) return
      const msgEvent = e as MessageEvent
      try {
        const data = JSON.parse(msgEvent.data)
        devBridgeRetryRef.current = 0
        setStatus(prev => ({
          ...prev,
          devBridge: 'connected',
          devBridgeBuild: data.build || prev.devBridgeBuild,
          lastDevBridgeHeartbeat: new Date(),
          lastDevBridgeCheck: new Date(),
        }))
      } catch {
        // ignorieren
      }
    })

    // Verbindungsfehler — der Browser reconnectet selbstständig.
    // Wir setzen den Status nur, wenn wir noch nie verbunden waren.
    es.onerror = () => {
      if (!mountedRef.current) return
      // EventSource.readyState === 0 (CONNECTING) bedeutet: Browser
      // versucht automatisch neu zu verbinden — kein Eingriff nötig.
      // readyState === 2 (CLOSED) bedeutet: endgültig getrennt.
      if (es.readyState === EventSource.CLOSED) {
        setStatus(prev => ({
          ...prev,
          devBridge: 'error',
          lastDevBridgeCheck: new Date(),
        }))
      } else {
        // CONNECTING — der Browser reconnectet, Status bleibt
        // 'connected' bis das Heartbeat-Timeout (60s) zuschlägt
        setStatus(prev => ({
          ...prev,
          lastDevBridgeCheck: new Date(),
        }))
      }
    }

    sseRef.current = es
  }, [])

  // ── Heartbeat-Timeout: 60s ohne Heartbeat → offline markieren
  // Der Browser reconnectet automatisch, aber wenn 60s lang gar nichts
  // ankommt, ist die Dev Bridge wirklich weg.
  useEffect(() => {
    if (!mountedRef.current) return
    const interval = setInterval(() => {
      if (!mountedRef.current) return
      setStatus(prev => {
        if (prev.devBridge !== 'connected') return prev
        const now = Date.now()
        const lastBeat = prev.lastDevBridgeHeartbeat?.getTime() || 0
        if (now - lastBeat > 60_000) {
          return { ...prev, devBridge: 'error', lastDevBridgeCheck: new Date() }
        }
        return prev
      })
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

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
    if (!devBridgeAvailableRef.current) return
    // Nur als Fallback, wenn SSE nicht verbunden ist
    if (sseRef.current) return
    try {
      const devBridgeUrl = getDevBridgeUrl()
      if (!devBridgeUrl) return
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
    let cancelled = false

    const detectDevBridge = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/admin/dev-image`, {
          signal: AbortSignal.timeout(5_000),
        })
        const data = response.ok ? await response.json() : null
        devBridgeAvailableRef.current = Boolean(
          data?.is_os_dev && data?.bridge_unit_installed && data?.dev_token_present,
        )
      } catch {
        devBridgeAvailableRef.current = false
      }

      if (!cancelled && devBridgeAvailableRef.current) {
        connectDevBridgeSSE()
      }
    }

    // Beim Start: Backend prüfen; Dev Bridge nur auf echten OS-Dev-Images verbinden.
    checkBackend()
    detectDevBridge()

    // Backend-Polling alle 15s (zusätzlich zum Backoff)
    const backendInterval = setInterval(checkBackend, 15_000)

    return () => {
      cancelled = true
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
