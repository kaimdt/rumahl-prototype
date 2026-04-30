/**
 * Settings sync – backs up localStorage settings to the backend
 * user_preferences table and restores them on new browsers.
 *
 * Synced keys are loaded from the backend on init. When any synced
 * key changes in localStorage, the new value is debounce-pushed to
 * the backend.
 */

import { getBackendUrl } from '@/lib/config'
const API_BASE = getBackendUrl()
import { authFetch } from '@/lib/authHelpers'

// Keys that should be synced to backend for cross-device use
const SYNCED_KEYS = [
  'ha-overview-variants',
  'ha-active-overview-variant',
  'ha-dynamic-overview-enabled',
  'ha-sleep-mode',
  'ha-auto-theme',
  'ha-selected-theme',
  'night-mode-settings',
  'accent-color-settings',
  'screensaver-enabled',
  'screensaver-timeout',
  'screensaver-schedules',
  'color-scenes',
  'glass-settings',
  'ha-haptic-feedback',
  'ha-nav-labels',
  'ha-nav-style',
  'ha-animations-reduced',
  'ha-font-size',
  'ha-widget-compact',
  'ha-global-card-style',
]

let syncUserId: string | null = null
// Per-key debounce timers to avoid cancelling saves for different keys
const saveTimers = new Map<string, number>()

async function getUserId(): Promise<string | null> {
  if (syncUserId) return syncUserId

  const username = localStorage.getItem('ha-username') || 'default'
  try {
    const res = await authFetch(`/api/config/users/${username}`)
    if (res.ok) {
      const u = await res.json()
      syncUserId = u.id
      return u.id
    }
  } catch {
    // Backend not available
  }
  return null
}

/** Safely convert a backend preference_value to a localStorage string */
function toLocalStorageValue(val: unknown): string {
  if (typeof val === 'string') return val
  return JSON.stringify(val)
}

/** Load all preferences from backend and populate localStorage for missing/stale keys */
export async function loadSettingsFromBackend() {
  try {
    const userId = await getUserId()
    if (!userId) return

    const res = await authFetch(`/api/config/preferences/${userId}`)
    if (!res.ok) return

    const prefs: Array<{ preference_key: string; preference_value: unknown }> = await res.json()

    for (const pref of prefs) {
      if (!SYNCED_KEYS.includes(pref.preference_key)) continue

      const backendVal = toLocalStorageValue(pref.preference_value)
      const localVal = localStorage.getItem(pref.preference_key)

      if (localVal === null || localVal !== backendVal) {
        // Restore from backend (missing locally or backend has newer value)
        localStorage.setItem(pref.preference_key, backendVal)
        console.log('[SettingsSync] Restored', pref.preference_key, 'from backend')
      }
    }
  } catch (err) {
    console.warn('[SettingsSync] Failed to load settings from backend:', err)
  }
}

/** Push a single setting to the backend */
async function pushSetting(key: string, value: string) {
  try {
    const userId = await getUserId()
    if (!userId) return

    // localStorage stores JSON-serialized strings; the backend expects
    // preference_value as a JSON value (serde_json::Value), so parse it.
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { parsed = value }

    await authFetch(`/api/config/preferences/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preference_key: key,
        preference_value: parsed,
      }),
    })
  } catch {
    // Silently fail — localStorage is the primary store
  }
}

/** Push all synced settings to backend (used on initial migration) */
export async function pushAllSettingsToBackend() {
  for (const key of SYNCED_KEYS) {
    const val = localStorage.getItem(key)
    if (val !== null) {
      await pushSetting(key, val)
    }
  }
}

/** Debounced save of a single key to backend. Called from useLocalStorage. */
export function scheduleSyncToBackend(key: string, value: string) {
  if (!SYNCED_KEYS.includes(key)) return

  const existingTimer = saveTimers.get(key)
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer)
  }
  saveTimers.set(key, window.setTimeout(() => {
    saveTimers.delete(key)
    pushSetting(key, value)
  }, 2000))
}
