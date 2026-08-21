import type { OsLaunchMode } from '@/contexts/OsWindowContext'

/**
 * Per-app launch mode preference.
 *
 * Users can choose how an app runs (fullscreen / window / split / immersive)
 * from the dock context menu or launcher quick menu. The choice is stored
 * per page so the app keeps launching the same way until changed.
 */

const LAUNCH_MODE_KEY = 'rumahl-os-launch-mode'

const VALID_MODES: OsLaunchMode[] = ['fullscreen', 'immersive', 'window', 'split-left', 'split-right']

export function getPreferredLaunchMode(pageId: string): OsLaunchMode {
  try {
    const stored = localStorage.getItem(`${LAUNCH_MODE_KEY}-${pageId}`)
    if (stored && (VALID_MODES as string[]).includes(stored)) {
      return stored as OsLaunchMode
    }
  } catch {
    // localStorage unavailable — fall back to fullscreen
  }
  return 'fullscreen'
}

export function setPreferredLaunchMode(pageId: string, mode: OsLaunchMode) {
  try {
    localStorage.setItem(`${LAUNCH_MODE_KEY}-${pageId}`, mode)
  } catch {
    // ignore persistence errors
  }
}
