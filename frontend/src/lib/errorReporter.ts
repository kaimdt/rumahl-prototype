// ── Centralised error reporter ─────────────────────────────────────
//
// Surfaces errors that previously got swallowed by `catch {}` blocks or
// fire-and-forget promises. Every call:
//
//   1. console.error/warn so DevTools, Sentry-like shims, and CI capture see it
//   2. toast.error/warn (sonner) so the user sees something happened
//   3. POSTs to `/api/system-events/client` so the Admin Control Center
//      can show every error in a unified, persisted log.
//   4. de-duplicates identical (source, message) pairs within a short window
//      so a flapping component doesn't carpet-bomb the UI.
//
// Usage:
//   import { reportError, reportWarning } from '@/lib/errorReporter'
//
//   try { await fetch(...) }
//   catch (e) { reportError('weather-widget', 'Could not load forecast', e) }

import { toast } from 'sonner'
import { getBackendUrl } from '@/lib/config'

const DEDUP_WINDOW_MS = 5_000
const seenRecently = new Map<string, number>()

function dedupKey(severity: string, source: string, message: string) {
  return `${severity}::${source}::${message}`
}

function shouldEmit(key: string): boolean {
  const now = Date.now()
  // Periodically prune
  if (seenRecently.size > 200) {
    for (const [k, t] of seenRecently) {
      if (now - t > DEDUP_WINDOW_MS) seenRecently.delete(k)
    }
  }
  const last = seenRecently.get(key)
  if (last && now - last < DEDUP_WINDOW_MS) return false
  seenRecently.set(key, now)
  return true
}

function formatError(err: unknown): string | undefined {
  if (err == null) return undefined
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try { return JSON.stringify(err) } catch { return String(err) }
}

function errorChain(err: unknown): string | undefined {
  if (!err) return undefined
  if (err instanceof Error) {
    const parts: string[] = []
    let cur: unknown = err
    let depth = 0
    while (cur instanceof Error && depth < 6) {
      parts.push(`${cur.name}: ${cur.message}`)
      cur = (cur as { cause?: unknown }).cause
      depth++
    }
    if (err.stack) parts.push(err.stack)
    return parts.join('\n')
  }
  return formatError(err)
}

// ── Backend ingest (fire-and-forget) ──────────────────────────────────
let ingestDisabled = false
function postToBackend(
  severity: 'error' | 'warning' | 'info',
  source: string,
  message: string,
  err: unknown,
  extra?: Record<string, unknown>,
): void {
  if (ingestDisabled || typeof window === 'undefined') return
  // Don't post events that came back to us from the WS broadcast.
  if (source.startsWith('backend:') || source.startsWith('tracing:')) return
  try {
    const body = {
      severity,
      source,
      message: message.slice(0, 2000),
      request_path: window.location.pathname,
      error_chain: errorChain(err),
      extra: {
        ua: navigator.userAgent,
        url: window.location.href,
        ...(extra ?? {}),
      },
    }
    // Use cookie-based auth (iora_token) — backend service_routes accepts it.
    void fetch(`${getBackendUrl()}/api/system-events/client`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {
      // Swallow — never recurse into the reporter from a failed report.
    })
  } catch {
    // If JSON.stringify or anything else explodes, disable to be safe.
    ingestDisabled = true
  }
}

export interface ReportOptions {
  /** Skip toast — only log. Useful for noisy paths that still deserve a console trace. */
  silent?: boolean
  /** Override the description shown in the toast (defaults to source). */
  description?: string
  /** Disable de-duplication for this call (always emit). */
  bypassDedup?: boolean
  /** Skip posting to the backend (used by the WS listener to avoid loops). */
  skipBackend?: boolean
  /** Extra metadata attached to the backend payload. */
  meta?: Record<string, unknown>
}

export function reportError(
  source: string,
  message: string,
  error?: unknown,
  opts: ReportOptions = {},
): void {
  const detail = formatError(error)
  if (error !== undefined) {
    // eslint-disable-next-line no-console
    console.error(`[${source}] ${message}`, error)
  } else {
    // eslint-disable-next-line no-console
    console.error(`[${source}] ${message}`)
  }
  if (!opts.skipBackend) postToBackend('error', source, message, error, opts.meta)
  if (opts.silent) return

  const key = dedupKey('error', source, message)
  if (!opts.bypassDedup && !shouldEmit(key)) return

  const description = opts.description ?? (detail ? `${source}: ${detail}` : source)
  toast.error(message, { description })
}

export function reportWarning(
  source: string,
  message: string,
  error?: unknown,
  opts: ReportOptions = {},
): void {
  if (error !== undefined) {
    // eslint-disable-next-line no-console
    console.warn(`[${source}] ${message}`, error)
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[${source}] ${message}`)
  }
  if (!opts.skipBackend) postToBackend('warning', source, message, error, opts.meta)
  if (opts.silent) return
  const key = dedupKey('warn', source, message)
  if (!opts.bypassDedup && !shouldEmit(key)) return
  const detail = formatError(error)
  const description = opts.description ?? (detail ? `${source}: ${detail}` : source)
  toast.warning(message, { description })
}

export function reportInfo(
  source: string,
  message: string,
  opts: ReportOptions = {},
): void {
  // eslint-disable-next-line no-console
  console.info(`[${source}] ${message}`)
  if (!opts.skipBackend) postToBackend('info', source, message, undefined, opts.meta)
  if (opts.silent) return
  const key = dedupKey('info', source, message)
  if (!opts.bypassDedup && !shouldEmit(key)) return
  toast(message, { description: opts.description ?? source })
}

// ── Global handlers ──────────────────────────────────────────────────
let globalHandlersInstalled = false
export function installGlobalErrorHandlers() {
  if (globalHandlersInstalled || typeof window === 'undefined') return
  globalHandlersInstalled = true

  window.addEventListener('error', (ev) => {
    // Skip ResizeObserver loop noise — it's not actionable.
    if (ev.message?.startsWith('ResizeObserver loop')) return
    reportError(
      'window',
      ev.message || 'Uncaught error',
      ev.error,
      {
        description: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : undefined,
        meta: { filename: ev.filename, lineno: ev.lineno, colno: ev.colno },
      },
    )
  })

  window.addEventListener('unhandledrejection', (ev) => {
    reportError('promise', 'Unhandled promise rejection', ev.reason)
  })
}

