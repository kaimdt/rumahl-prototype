// ── System-event listener ──────────────────────────────────────────
//
// Subscribes to the existing wsConnection message stream and surfaces
// backend-side `system_event` broadcasts (errors / warnings from
// background tasks the user didn't directly trigger) as toasts.
//
// Backend payload shape (see iora-home/src/system_events.rs):
//   { type: "system_event", event: { severity, source, message, count, ... } }

import { wsOnMessage } from '@/lib/wsConnection'
import { reportError, reportWarning, reportInfo } from '@/lib/errorReporter'

interface BackendSystemEvent {
  id?: number
  severity: 'error' | 'warning' | 'info'
  source: string
  message: string
  count?: number
  timestamp?: string
  last_seen?: string
  details?: unknown
}

let started = false
let unsubscribe: (() => void) | null = null

export function startSystemEventListener(): void {
  if (started) return
  started = true

  unsubscribe = wsOnMessage((raw) => {
    if (!raw || typeof raw !== 'object') return
    const msg = raw as { type?: string; event?: BackendSystemEvent }
    if (msg.type !== 'system_event' || !msg.event) return

    const ev = msg.event
    const suffix = ev.count && ev.count > 1 ? ` (x${ev.count})` : ''
    const message = `${ev.message}${suffix}`
    const source = `backend:${ev.source}`

    // Bypass dedup — backend already deduplicates server-side.
    switch (ev.severity) {
      case 'error':
        reportError(source, message, undefined, { bypassDedup: true })
        break
      case 'warning':
        reportWarning(source, message, undefined, { bypassDedup: true })
        break
      case 'info':
        reportInfo(source, message, { bypassDedup: true })
        break
    }
  })
}

export function stopSystemEventListener(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
  started = false
}
