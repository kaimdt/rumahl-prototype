/**
 * windowPreview — capture a rendered window (DOM node) into a data-URL image
 * so the taskbar preview can show a REAL thumbnail of the running app.
 *
 * Uses `html-to-image` (MIT, browser-only) to render any DOM — including
 * external images and iframes — reliably. The captured image is stored per
 * pageId in a module-level map (and mirrored to localStorage so previews
 * survive reloads).
 */
import { storage } from '@/lib/storage'

const STORE_KEY = 'rumahl-window-previews'

// Module-level map (pageId -> dataURL) — fast in-session access.
const previewMap = new Map<string, string>()

function loadPersisted(): Record<string, string> {
  try {
    const raw = storage.get<Record<string, string>>(STORE_KEY, {})
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

/** Sync the in-memory map from the persisted store once. */
let hydrated = false
function ensureHydrated() {
  if (hydrated) return
  hydrated = true
  const persisted = loadPersisted()
  for (const [k, v] of Object.entries(persisted)) previewMap.set(k, v)
}

/** Store a preview for a given pageId (persists to localStorage). */
export function setWindowPreview(pageId: string, dataUrl: string): void {
  previewMap.set(pageId, dataUrl)
  try {
    const all = loadPersisted()
    all[pageId] = dataUrl
    storage.set(STORE_KEY, all)
  } catch {
    // storage may be unavailable (kiosk) — in-memory map alone still works
  }
}

/** Clear the stored preview for a window (e.g. when it closes). */
export function clearWindowPreview(pageId: string): void {
  previewMap.delete(pageId)
  try {
    const all = loadPersisted()
    delete all[pageId]
    storage.set(STORE_KEY, all)
  } catch {
    /* ignore */
  }
}

/** Read the current preview for a pageId (falls back to persisted). */
export function getWindowPreview(pageId: string): string | null {
  ensureHydrated()
  return previewMap.get(pageId) ?? null
}

/**
 * Capture the given DOM node as a PNG data-URL.
 * Uses `html-to-image` (MIT, browser-only) which reliably renders any DOM —
 * including external images and iframes — via `<foreignObject>` + canvas.
 * Returns null on failure.
 */
export async function captureWindowPreview(node: HTMLElement): Promise<string | null> {
  if (!node || node.clientWidth < 2 || node.clientHeight < 2) return null
  try {
    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(node, {
      pixelRatio: 1,
      width: node.scrollWidth,
      height: node.scrollHeight,
      cacheBust: true,
      backgroundColor: '#0b0d12',
    })
    return dataUrl
  } catch {
    return null
  }
}

export const WINDOW_PREVIEW_CAPTURE_EVENT = 'rumahl:window-preview-capture'
