/**
 * Centralized API base URL for rumahl Desktop.
 *
 * In the Tauri desktop app the user can configure a remote rumahl Home URL
 * (e.g. https://home.example.com) which is persisted in the Tauri config
 * and mirrored to localStorage for quick synchronous reads.
 *
 * All modules that need to call the backend should import getApiBase()
 * instead of reading VITE_BACKEND_URL directly.
 */

const STORAGE_KEY = 'rumahl-home-url'
const DEV_DEFAULT_API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : ''

/** Internal mutable state – only mutated through setApiBase / initApiBase */
let _apiBase: string =
  localStorage.getItem(STORAGE_KEY) || import.meta.env.VITE_BACKEND_URL || DEV_DEFAULT_API_BASE || ''

// Strip trailing slash for consistent concatenation
_apiBase = _apiBase.replace(/\/+$/, '')

/** Return the current backend base URL (e.g. "https://home.example.com" or "") */
export function getApiBase(): string {
  return _apiBase
}

/** Update the backend URL at runtime. Persists to localStorage. */
export function setApiBase(url: string) {
  _apiBase = url.replace(/\/+$/, '')
  if (_apiBase) {
    localStorage.setItem(STORAGE_KEY, _apiBase)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
  // Dispatch a custom event so the WebSocket layer can reconnect
  window.dispatchEvent(new CustomEvent('rumahl-api-base-changed', { detail: _apiBase }))
}

/**
 * Initialise from Tauri config. Call once at app startup.
 * Falls back gracefully when not running inside Tauri.
 */
export async function initApiBase(): Promise<string> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const config = await invoke<{ rumahl_home_url: string }>('get_config')
    if (config?.rumahl_home_url) {
      setApiBase(config.rumahl_home_url)
    }
  } catch {
    // Not in Tauri context – keep current value
  }
  return _apiBase
}
