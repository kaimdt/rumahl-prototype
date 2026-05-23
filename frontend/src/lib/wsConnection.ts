// ── Singleton WebSocket connection to backend ─────────────────────
// This module is imported by both useEntityStore (for state updates)
// and homeAssistant.ts (for fire-and-forget commands). It connects
// IMMEDIATELY at module load time so commands can flow as soon as
// the user interacts — no waiting for React to mount.

import { getBackendUrl } from '@/lib/config'
const API_BASE = getBackendUrl()

let wsInstance: WebSocket | null = null
let reconnectTimeout: number | undefined
let reconnectDelay = 1000
const openListeners = new Set<() => void>()
const messageListeners = new Set<(data: unknown) => void>()
const closeListeners = new Set<() => void>()

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
  if (API_BASE) {
    try {
      const url = new URL(API_BASE)
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
      for (const fn of openListeners) fn()
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
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
