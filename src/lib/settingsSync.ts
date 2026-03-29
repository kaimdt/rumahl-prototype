/**
 * Settings sync – backs up localStorage settings to the backend
 * user_preferences table and restores them on new browsers.
 *
 * Synced keys are loaded from the backend on init. When any synced
 * key changes in localStorage, the new value is debounce-pushed to
 * the backend.
 */

const API_BASE = import.meta.env.VITE_BACKEND_URL || ''

// Keys that should be synced to backend for cross-device use
const SYNCED_KEYS = [
  'ha-overview-variants',
  'ha-active-overview-variant',
  'ha-dynamic-overview-enabled',
  'ha-sleep-mode',
  'ha-auto-theme',
  'night-mode-settings',
  'accent-color-settings',
  'screensaver-enabled',
  'screensaver-timeout',
  'color-scenes',
  'glass-settings',
]

let syncUserId: string | null = null
let saveTimer: number | undefined

async function getUserId(): Promise<string | null> {
  if (syncUserId) return syncUserId

  const username = localStorage.getItem('ha-username') || 'default'
  try {
    const res = await fetch(`${API_BASE}/api/config/users/${username}`)
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

/** Load all preferences from backend and populate localStorage for missing/stale keys */
export async function loadSettingsFromBackend() {
  try {
    const userId = await getUserId()
    if (!userId) return

    const res = await fetch(`${API_BASE}/api/config/preferences/${userId}`)
    if (!res.ok) return

    const prefs: Array<{ preference_key: string; preference_value: string }> = await res.json()

    for (const pref of prefs) {
      if (!SYNCED_KEYS.includes(pref.preference_key)) continue

      const localVal = localStorage.getItem(pref.preference_key)
      if (localVal === null) {
        // localStorage doesn't have this key — restore from backend
        localStorage.setItem(pref.preference_key, pref.preference_value)
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

    await fetch(`${API_BASE}/api/config/preferences/${userId}`, {
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

  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer)
  }
  saveTimer = window.setTimeout(() => {
    pushSetting(key, value)
  }, 2000)
}
