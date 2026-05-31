// ── Singleton WebSocket connection to backend ─────────────────────
// This module is imported by both useEntityStore (for state updates)
// and homeAssistant.ts (for fire-and-forget commands). It connects
// IMMEDIATELY at module load time so commands can flow as soon as
// the user interacts — no waiting for React to mount.

import { getBackendUrl } from '@/lib/config'
const apiBase = () => getBackendUrl() || ''

let wsInstance: WebSocket | null = null
let reconnectTimeout: number | undefined
let reconnectDelay = 1000
const openListeners = new Set<() => void>()
const messageListeners = new Set<(data: unknown) => void>()
const closeListeners = new Set<() => void>()

// ── Token retrieval (matches AuthContext storage order) ─────────────
function readAuthToken(): string | null {
  // 1. Cookie iora_token (primary, HttpOnly-friendly path)
  const cookieMatch = document.cookie.match(/(?:^|;\s*)iora_token=([^;]+)/)
  if (cookieMatch) {
    try { return decodeURIComponent(cookieMatch[1]) } catch { return cookieMatch[1] }
  }
  // 2. localStorage / sessionStorage (legacy + Remember-me)
  const raw = localStorage.getItem('ha-auth-token') || sessionStorage.getItem('ha-auth-token')
  if (!raw) return null
  // The stored value can be either the raw JWT or a JSON-wrapped object.
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.token === 'string') return parsed.token
    } catch { /* fall through */ }
  }
  return raw
}

// ── Heartbeat (client side) ─────────────────────────────────────────
let heartbeatTimer: number | undefined
function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = window.setInterval(() => {
    if (wsInstance?.readyState === WebSocket.OPEN) {
      try { wsInstance.send(JSON.stringify({ type: 'ping' })) } catch { /* ignore */ }
    }
  }, 25000)
}
function stopHeartbeat() {
  if (heartbeatTimer !== undefined) {
    window.clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }
}

function connectWebSocket() {
  // Close any orphaned connection from a previous HMR cycle
  if (wsInstance) {
    try { wsInstance.onclose = null; wsInstance.close() } catch {}
    wsInstance = null
  }
  if (reconnectTimeout !== undefined) {
    window.clearTimeout(reconnectTimeout)
    reconnectTimeout = undefined
  }

  // Derive WebSocket URL from VITE_BACKEND_URL if set,
  // otherwise fall back to current host (works when served by backend).
  // In dev mode (Vite dev server on :5173), connect to backend directly.
  let wsUrl: string
  const base = apiBase()
  if (base) {
    try {
      const url = new URL(base)
      const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${protocol}//${url.host}/ws`
    } catch {
      wsUrl = `ws://${window.location.hostname}:3001/ws`
    }
  } else if (import.meta.env.DEV) {
    // Vite dev server — connect to backend on port 3001
    wsUrl = `ws://${window.location.hostname}:3001/ws`
  } else {
    // Production / IORA OS / VM — connect to same origin
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsUrl = `${protocol}//${window.location.host}/ws`
  }

  try {
    const ws = new WebSocket(wsUrl)
    wsInstance = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      reconnectDelay = 1000

      // Immediately authenticate so the server allows CallService.
      const token = readAuthToken()
      if (token) {
        try { ws.send(JSON.stringify({ type: 'auth', token })) } catch { /* ignore */ }
      } else {
        console.warn('[WS] No auth token available — server will reject CallService until login')
      }

      startHeartbeat()
      for (const fn of openListeners) fn()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        // Intercept auth lifecycle messages — don't leak them to UI listeners
        if (data && typeof data === 'object') {
          if (data.type === 'auth_ok') {
            console.log('[WS] Authenticated')
            return
          }
          if (data.type === 'auth_failed') {
            console.warn('[WS] Auth failed:', data.message)
            return
          }
        }
        for (const fn of messageListeners) fn(data)
      } catch (error) {
        console.error('[WS] Failed to parse message:', error)
      }
    }

    ws.onerror = () => {
      // onclose will fire after this
    }

    ws.onclose = () => {
      console.log('[WS] Disconnected')
      stopHeartbeat()
      wsInstance = null
      for (const fn of closeListeners) fn()

      const delay = reconnectDelay
      console.log(`[WS] Reconnecting in ${delay}ms`)
      reconnectTimeout = window.setTimeout(() => {
        reconnectDelay = Math.min(delay * 2, 30000)
        connectWebSocket()
      }, delay)
    }
  } catch (error) {
    console.error('[WS] Failed to create WebSocket:', error)
  }
}

// ── Public API ──────────────────────────────────────────────────────

/** Send a raw JSON message over the WebSocket. Returns true if sent. */
export function wsSend(msg: Record<string, unknown>): boolean {
  if (wsInstance?.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify(msg))
    return true
  }
  console.warn('[WS] send failed, readyState:', wsInstance?.readyState ?? 'null')
  return false
}

/** Re-authenticate over the open socket — call after login/token refresh. */
export function wsReauthenticate(): boolean {
  const token = readAuthToken()
  if (!token) return false
  return wsSend({ type: 'auth', token })
}

/** Force a reconnect — useful after logout or token change. */
export function wsReconnect(): void {
  if (wsInstance) {
    try { wsInstance.close() } catch { /* ignore */ }
  }
}

/** Check if WS is currently connected */
export function wsIsConnected(): boolean {
  return wsInstance?.readyState === WebSocket.OPEN
}

/** Subscribe to WS lifecycle events */
export function wsOnOpen(fn: () => void) { openListeners.add(fn); return () => { openListeners.delete(fn) } }
export function wsOnMessage(fn: (data: unknown) => void) { messageListeners.add(fn); return () => { messageListeners.delete(fn) } }
export function wsOnClose(fn: () => void) { closeListeners.add(fn); return () => { closeListeners.delete(fn) } }

// ── Connect IMMEDIATELY at module load ──────────────────────────────
connectWebSocket()
