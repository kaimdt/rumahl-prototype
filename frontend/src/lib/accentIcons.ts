/**
 * Accent-tinted icons: recolor app icons (and file-explorer folders) with the
 * current primary accent color, using the classic sepia+hue-rotate technique.
 */

const STORAGE_KEY = 'iora-accent-icons'

let styleEl: HTMLStyleElement | null = null

/**
 * The filter rule is injected at runtime on top of the stylesheet entry —
 * some CSS pipelines (Lightning CSS/Tailwind v4) drop rules whose filter
 * contains var() in angle functions, so we guarantee it exists in the CSSOM.
 */
const FILTER_RULE = `[data-accent-icons="true"] .ora-app-icon img,
[data-accent-icons="true"] .ora-dock-item img,
[data-accent-icons="true"] .ora-folder-icon img,
[data-accent-icons="true"] .ora-file-tile img,
[data-accent-icons="true"] .ora-file-row img,
[data-accent-icons="true"] .ora-file-table-row img,
[data-accent-icons="true"] .ora-sidebar-item img {
  filter: sepia(1) hue-rotate(var(--accent-hue-rot, 30deg)) saturate(2.2) brightness(0.92) !important;
}`

function ensureStyle() {
  if (styleEl || typeof document === 'undefined') return
  styleEl = document.createElement('style')
  styleEl.id = 'ora-accent-icon-filter'
  styleEl.textContent = FILTER_RULE
  document.head.appendChild(styleEl)
}

export function readAccentIcons(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function applyAccentIcons(enabled: boolean) {
  ensureStyle()
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
