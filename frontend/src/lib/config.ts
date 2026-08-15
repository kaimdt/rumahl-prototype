/**
 * IORA Central Configuration Module
 *
 * In IORA OS there are NO .env files. All configuration lives in the
 * Global Config system (settings table in the database, accessible via
 * GET/PUT /api/admin/settings).
 *
 * This module provides a simple getter/setter pattern that works everywhere:
 * - React components (via useBackendUrl / useAssistUrl hooks)
 * - Non-React code (via getBackendUrl / getAssistUrl functions)
 * - Initial bootstrap (falls back to Vite env vars for dev convenience)
 *
 * The GlobalConfigProvider calls setBackendUrl/setAssistUrl after fetching
 * the live config from the backend on app startup.
 */

// ── Bootstrap: Vite env vars are ONLY for local development ──────────
// In production (IORA OS), the frontend is served from the same origin
// as the backend, so relative URLs work and these will be empty strings.

const DEV_BACKEND_URL = import.meta.env.VITE_BACKEND_URL || ''
const DEV_ASSIST_URL = import.meta.env.VITE_IORA_ASSIST_URL || ''

let _backendUrl = DEV_BACKEND_URL
let _assistUrl = DEV_ASSIST_URL

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (normalized === ['local', 'host'].join('') || normalized === '::1') return true
  const parts = normalized.split('.').map((part) => Number(part))
  return parts.length === 4
    && parts[0] === 127
    && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
}

function browserSafeBaseUrl(url: string): string {
  if (!url || typeof window === 'undefined') return url
  try {
    const parsed = new URL(url, window.location.origin)
    if (isLoopbackHost(parsed.hostname) && !isLoopbackHost(window.location.hostname)) {
      return ''
    }
  } catch {
    return ''
  }
  return url
}

/** Returns the current backend URL. Safe to call from anywhere. */
export function getBackendUrl(): string {
  let url = _backendUrl;
  // Development fallback: Only when running on the Vite dev server (port 5173)
  // do we default to localhost:3001. In production / IORA OS / remote dev VM
  // access, use relative URLs (same origin) so API calls reach the same host.
  if (typeof window !== 'undefined'
      && isLoopbackHost(window.location.hostname)
      && window.location.port === '5173') {
    // On the dev server (localhost OR 127.0.0.1) a stored loopback
    // `backend.url` (e.g. an app-assigned port or a stale entry) would
    // bypass the Vite proxy and break CORS/SSE streams. Non-loopback
    // values (remote dev backends) are kept.
    let storedLoopback = false
    if (url) {
      try {
        storedLoopback = isLoopbackHost(new URL(url, window.location.origin).hostname)
      } catch {
        storedLoopback = false
      }
    }
    if (!url || storedLoopback) {
      url = DEV_BACKEND_URL || 'http://localhost:3001'
    }
  }
  return browserSafeBaseUrl(url)
}

/** Returns the current assist/AI URL. Safe to call from anywhere. */
export function getAssistUrl(): string {
  // In production/desktop: assist URL may not be set separately.
  // Fall back to backend URL, which iora-home proxies to iora-assist.
  let url = _assistUrl;
  if (!url) {
    url = _backendUrl;
  }
  if (!url && typeof window !== 'undefined') {
    // Last resort: derive from page origin or use localhost default
    const origin = window.location.origin;
    if (origin && window.location.port !== '5173') {
      url = origin; // Production or remote dev: same-origin deployment
    } else {
      url = 'http://localhost:3001'; // Vite dev server default
    }
  }

  if (url && typeof window !== 'undefined') {
    try {
      const assist = new URL(url, window.location.origin)
      if (isLoopbackHost(assist.hostname) && !isLoopbackHost(window.location.hostname)) {
        return getBackendUrl() || url
      }
    } catch {
      return getBackendUrl() || url
    }
  }
  return browserSafeBaseUrl(url)
}

/** Called by GlobalConfigProvider after fetching live config. */
export function setBackendUrl(url: string): void {
  if (url && url !== _backendUrl) {
    _backendUrl = url
  }
}

/** Called by GlobalConfigProvider after fetching live config. */
export function setAssistUrl(url: string): void {
  if (url && url !== _assistUrl) {
    _assistUrl = url
  }
}

/**
 * Returns the Dev Bridge URL.
 * In production (IORA OS), the dev bridge runs on port 8101 of the same host.
 * In local development, it can be overridden via VITE_DEV_BRIDGE_URL.
 */
export function getDevBridgeUrl(): string {
  if (import.meta.env.VITE_DEV_BRIDGE_URL) return import.meta.env.VITE_DEV_BRIDGE_URL

  if (_backendUrl) {
    try {
      const parsed = new URL(_backendUrl, globalThis.location?.origin)
      parsed.port = '8101'
      parsed.pathname = ''
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString().replace(/\/$/, '')
    } catch {
      return _backendUrl.replace(/:\d+$/, ':8101')
    }
  }

  if (typeof window !== 'undefined' && window.location.hostname) {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:8101`
  }

  return ''
}
