/**
 * Per-app "open outside rumahl OS" preference.
 *
 * Apple-settings-style switch: an installed app can be opened directly via
 * its published port (own browser tab, outside the rumahl desktop runner)
 * instead of being embedded through the App Embedding Gateway. The
 * preference is a user override on top of the manifest `display.mode`.
 */

const STORAGE_KEY = 'rumahl-app-open-external'
export const APP_OPEN_PREFS_EVENT = 'rumahl:app-open-prefs-changed'

function readPrefs(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed as Record<string, boolean> : {}
  } catch {
    return {}
  }
}

function writePrefs(prefs: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(APP_OPEN_PREFS_EVENT))
}

/** Whether the user wants this app opened directly via its port. */
export function isAppOpenExternal(appId: string): boolean {
  try {
    return readPrefs()[appId] === true
  } catch {
    return false
  }
}

/** Toggle the per-app "open outside rumahl OS" preference. */
export function setAppOpenExternal(appId: string, external: boolean): void {
  const prefs = readPrefs()
  if (external) {
    prefs[appId] = true
  } else {
    delete prefs[appId]
  }
  writePrefs(prefs)
}
