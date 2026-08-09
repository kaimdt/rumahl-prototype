/**
 * Accent-tinted icons: recolor app icons (and file-explorer folders) with the
 * current primary accent color, using the classic sepia+hue-rotate technique.
 */

const STORAGE_KEY = 'iora-accent-icons'

export function readAccentIcons(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function applyAccentIcons(enabled: boolean) {
  const root = document.documentElement
  if (enabled) {
    root.setAttribute('data-accent-icons', 'true')
  } else {
    root.removeAttribute('data-accent-icons')
  }
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false')
  } catch { /* ignore */ }
}

export function toggleAccentIcons(): boolean {
  const next = !readAccentIcons()
  applyAccentIcons(next)
  return next
}
