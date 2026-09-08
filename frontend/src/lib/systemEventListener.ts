// ── System-event listener ──────────────────────────────────────────
//
// Subscribes to the existing wsConnection message stream and surfaces
// backend-side `system_event` broadcasts (errors / warnings from
// background tasks the user didn't directly trigger) as toasts.
//
// Backend payload shape (see rumahl-home/src/system_events.rs):
//   { type: "system_event", event: {
//       fingerprint, severity, source, message, origin,
//       occurred_at, group_count,
//       user_id?, request_path?, status_code?,
//       file?, line?, target?, error_chain?, details?
//     } }

import { wsOnMessage } from '@/lib/wsConnection'
import { reportError, reportWarning, reportInfo } from '@/lib/errorReporter'

interface BackendSystemEvent {
  fingerprint?: string
  severity: 'error' | 'warning' | 'info'
  source: string
  message: string
  origin?: 'backend' | 'tracing' | 'frontend'
  group_count?: number
  occurred_at?: string
  user_id?: string
  request_path?: string
  status_code?: number
  file?: string
  line?: number
  target?: string
  error_chain?: string
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
    // Skip events that originated from the frontend itself — we already
    // toasted them locally; surfacing them again from the WS broadcast
    // would double up.
    if (ev.origin === 'frontend') return

    // Skip gateway/unavailable responses from the rumahl-home request
    // middleware. These fire when a proxied upstream service (e.g.
    // rumahl-control on :8091) is not running in a partial dev setup —
    // every polled OS endpoint then re-broadcasts the same error as a
    // toast, flooding the UI with "HTTP request returned a server error
    // (×N)". The dashboard already handles these gracefully (system stats
    // show "–", ConnectionStatus reflects reachability), so they are
    // logged server-side but not surfaced as toasts.
    //
    // Note: these events come via the tracing capture, so `status_code` is
    // never populated (EventMeta::default() leaves it None and the
    // middleware logs the field as `status`). Matching on the message + origin is
    // therefore the reliable discriminator; the status-code range check is
    // kept as a secondary guard in case a future path sets it.
    if (ev.message === 'HTTP request returned a server error') {
      const status = ev.status_code ?? 0
      if (status >= 500 && status <= 504) return
      // Tracing-captured 5xx (status_code absent) → the graceful-skip above.
      if (ev.origin === 'tracing') return
    }

    const count = ev.group_count ?? 1
    const suffix = count > 1 ? ` (×${count})` : ''
    const message = `${ev.message}${suffix}`
    const source = `backend:${ev.source}`

    // Build a useful one-line description from the metadata we have.
    const descParts: string[] = []
    if (ev.request_path) descParts.push(ev.request_path)
    if (ev.status_code != null) descParts.push(`HTTP ${ev.status_code}`)
    if (ev.file) descParts.push(`${ev.file}${ev.line ? `:${ev.line}` : ''}`)
    if (ev.target && descParts.length === 0) descParts.push(ev.target)
    const description = descParts.length > 0 ? descParts.join(' · ') : undefined

    // Bypass dedup — backend already groups identical events server-side.
    // Skip backend re-post — this event already came from the backend.
    const opts = { bypassDedup: true, skipBackend: true, description }
    switch (ev.severity) {
      case 'error':
        reportError(source, message, undefined, opts)
        break
      case 'warning':
        reportWarning(source, message, undefined, opts)
        break
      case 'info':
        reportInfo(source, message, opts)
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

