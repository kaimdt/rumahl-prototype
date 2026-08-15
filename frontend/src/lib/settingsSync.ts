/**
 * Settings sync – backs up localStorage settings to the backend
 * user_preferences table and restores them on new browsers.
 *
 * Synced keys are loaded from the backend on init. When any synced
 * key changes in localStorage, the new value is debounce-pushed to
 * the backend.
 */

import { authFetch } from '@/lib/authHelpers'

// Keys that should be synced to backend for cross-device use
const SYNCED_KEYS = [
  'ha-overview-variants',
  'ha-active-overview-variant',
  'ha-dynamic-overview-enabled',
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
  'iora-os-launcher',
  'iora-os-custom-launchers',
  'iora-os-launcher-widgets',
  'iora-os-launcher-folders',
  'iora-time-theme-boundaries',
  'iora-ui-scale',
  'iora-os-session-locked',
  'iora-auto-lock-minutes',
  'iora-kiosk-mode',
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

/** Safely convert a backend preference_value to a localStorage string.
 *  Always JSON-serialize to match storage.set()/storage.get() round-tripping
 *  (a string value must be stored quoted so JSON.parse restores it). If the
 *  backend stored a JSON string (a previously double-encoded object), parse
 *  it first so the object form is restored. */
function toLocalStorageValue(val: unknown): string {
  if (typeof val === 'string') {
    const trimmed = val.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.stringify(JSON.parse(val)) } catch { /* keep raw */ }
    }
  }
  return JSON.stringify(val)
}

/** Global (admin-set) default keys in system_preferences → local preference key. */
const GLOBAL_DEFAULT_MAP: Record<string, string> = {
  'defaults.accent': 'accent-color-settings',
  'defaults.glass': 'glass-settings',
  'defaults.theme': 'ha-selected-theme',
  'defaults.auto_theme': 'ha-auto-theme',
  'defaults.time_boundaries': 'iora-time-theme-boundaries',
}

/** Apply admin global defaults for any appearance key the user hasn't set. */
async function applyGlobalDefaults(userKeys: Set<string>) {
  try {
    const res = await authFetch('/api/config/system/preferences')
    if (!res.ok) return
    const prefs = (await res.json()) as Array<{ preference_key: string; preference_value: unknown }>
    for (const pref of prefs) {
      const localKey = GLOBAL_DEFAULT_MAP[pref.preference_key]
      if (!localKey || userKeys.has(localKey)) continue
      // Normalize: if the backend stored a JSON string, parse it so the
      // object round-trips correctly (avoids double-encoded values).
      let value = pref.preference_value
      if (typeof value === 'string') {
        try { value = JSON.parse(value) } catch { /* keep the raw string */ }
      }
      // Match storage.set()'s JSON serialization so storage.get() parses it back.
      localStorage.setItem(localKey, JSON.stringify(value))
    }
  } catch {
    // Global defaults are optional
  }
}

/** Load all preferences from backend and populate localStorage for missing/stale keys */
export async function loadSettingsFromBackend() {
  try {
    const userId = await getUserId()
    if (!userId) return

    const res = await authFetch(`/api/config/preferences/${userId}`)
    if (!res.ok) return

    const prefs: Array<{ preference_key: string; preference_value: unknown }> = await res.json()
    const userKeys = new Set<string>()

    for (const pref of prefs) {
      if (!SYNCED_KEYS.includes(pref.preference_key)) continue

      userKeys.add(pref.preference_key)
      const backendVal = toLocalStorageValue(pref.preference_value)
      const localVal = localStorage.getItem(pref.preference_key)

      // Restore from the backend ONLY when the key is missing locally.
      // Backend values must never clobber a fresh local value on every load:
      // a stale backend preference (e.g. an old light theme id, or a launcher
      // manifest from before a local edit) would otherwise force itself onto
      // every page load system-wide. Local changes still propagate to the
      // backend via scheduleSyncToBackend, so other devices keep receiving
      // updates whenever a key is missing (first run / cleared storage).
      if (localVal === null) {
        localStorage.setItem(pref.preference_key, backendVal)
        console.log('[SettingsSync] Restored', pref.preference_key, 'from backend')
      }
    }

    // Fall back to admin global defaults for appearance keys the user hasn't set.
    await applyGlobalDefaults(userKeys)

    window.dispatchEvent(new CustomEvent('iora:settings-synced'))
  } catch (err) {
    console.warn('[SettingsSync] Failed to load settings from backend:', err)
  }
}

/** Largest preference payload we're willing to push (backend limit). */
const MAX_PREFERENCE_BYTES = 1_500_000
const oversizedWarned = new Set<string>()

/** Push a single setting to the backend */
async function pushSetting(key: string, value: string) {
  try {
    const userId = await getUserId()
    if (!userId) return

    // localStorage stores JSON-serialized strings; the backend expects
    // preference_value as a JSON value (serde_json::Value), so parse it.
    let parsed: unknown
    try { parsed = JSON.parse(value) } catch { parsed = value }
    // Recover from a previously double-encoded object: if parsing produced a
    // JSON string, parse it once more so the backend stores the object form.
    if (typeof parsed === 'string') {
      const trimmed = parsed.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { parsed = JSON.parse(parsed) } catch { /* keep string */ }
      }
    }

    const body = JSON.stringify({ preference_key: key, preference_value: parsed })
    if (body.length > MAX_PREFERENCE_BYTES) {
      if (!oversizedWarned.has(key)) {
        oversizedWarned.add(key)
        console.warn(`[SettingsSync] Skipping oversized preference '${key}' (${body.length} bytes)`)
      }
      return
    }

    const res = await authFetch(`/api/config/preferences/${userId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    if (!res.ok) {
      // Non-OK (e.g. 413) should not spam the console/error reporter.
      if (!oversizedWarned.has(key)) {
        oversizedWarned.add(key)
        console.warn(`[SettingsSync] Failed to sync '${key}': HTTP ${res.status}`)
      }
    }
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
