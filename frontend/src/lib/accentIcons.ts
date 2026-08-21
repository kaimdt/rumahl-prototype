/**
 * Accent-tinted icons: recolor app icons (and file-explorer folders) with the
 * current primary accent color, using the classic sepia+hue-rotate technique.
 */

const STORAGE_KEY = 'rumahl-accent-icons'

let styleEl: HTMLStyleElement | null = null

/**
 * The filter rule is injected at runtime on top of the stylesheet entry —
 * some CSS pipelines (Lightning CSS/Tailwind v4) drop rules whose filter
 * contains var() in angle functions, so we guarantee it exists in the CSSOM.
 * Both raster images and vector glyphs (Phosphor etc.) are tinted so every
 * app icon follows the accent color, with or without an image.
 */
const FILTER_RULE = `[data-accent-icons="true"] .rumahl-app-icon img,
[data-accent-icons="true"] .rumahl-dock-item img,
[data-accent-icons="true"] .rumahl-folder-icon img,
[data-accent-icons="true"] .rumahl-file-tile img,
[data-accent-icons="true"] .rumahl-file-row img,
[data-accent-icons="true"] .rumahl-file-table-row img,
[data-accent-icons="true"] .rumahl-sidebar-item img,
[data-accent-icons="true"] .rumahl-app-icon svg,
[data-accent-icons="true"] .rumahl-dock-item svg,
[data-accent-icons="true"] .rumahl-folder-icon svg,
[data-accent-icons="true"] .rumahl-file-tile svg,
[data-accent-icons="true"] .rumahl-file-row svg,
[data-accent-icons="true"] .rumahl-file-table-row svg,
[data-accent-icons="true"] .rumahl-sidebar-item svg {
  filter: sepia(1) hue-rotate(var(--accent-hue-rot, 30deg)) saturate(2.2) brightness(0.92) !important;
}`

function ensureStyle() {
  if (styleEl || typeof document === 'undefined') return
  styleEl = document.createElement('style')
  styleEl.id = 'rumahl-accent-icon-filter'
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
