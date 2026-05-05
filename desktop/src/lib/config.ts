/**
 * IORA Desktop – Shared Config
 * URL resolution for the Tauri desktop environment.
 * Falls back to the apiBase (user-configured IORA Home URL) when
 * the assist-specific URL is not configured.
 */

const DEV_DEFAULT = 'http://localhost:3001'

let _backendUrl = ''
let _assistUrl = ''

// ── Bootstrap from apiBase ────────────────────────────────────────────
function getApiBaseFromStorage(): string {
  try {
    const stored = localStorage.getItem('iora-home-url')
    return stored || ''
  } catch { return '' }
}

function resolveBaseUrl(): string {
  const fromStorage = getApiBaseFromStorage()
  if (fromStorage) return fromStorage
  return DEV_DEFAULT
}

/** Returns the current backend URL. */
export function getBackendUrl(): string {
  if (_backendUrl) return _backendUrl
  return resolveBaseUrl()
}

/** Returns the current assist/AI URL. Falls back to backend URL. */
export function getAssistUrl(): string {
  if (_assistUrl) return _assistUrl
  // In IORA OS, iora-home proxies /api/assist/* to iora-assist.
  // So the assist URL is the same as the backend URL.
  return getBackendUrl()
}

export function setBackendUrl(url: string): void {
  if (url) _backendUrl = url
}

export function setAssistUrl(url: string): void {
  if (url) _assistUrl = url
}

export function getDevBridgeUrl(): string {
  return getBackendUrl().replace('3001', '8101')
}
