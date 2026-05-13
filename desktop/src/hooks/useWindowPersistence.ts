/**
 * Window state persistence hook.
 *
 * Saves the window position and size to the Tauri config on move/resize,
 * debounced by 1 second. Restores saved position on startup.
 */
import { useEffect, useRef, useCallback } from 'react'
import { tauriApi } from '@/lib/tauri'

const SAVE_DEBOUNCE_MS = 1000

/**
 * Hook that persists window state (position + size) to config.
 * Call once in your main App component.
 */
export function useWindowPersistence() {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSave = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  const saveState = useCallback(async (x: number, y: number, w: number, h: number) => {
    // Debounce: only save if values changed since last save
    if (
      lastSave.current &&
      lastSave.current.x === x &&
      lastSave.current.y === y &&
      lastSave.current.w === w &&
      lastSave.current.h === h
    ) {
      return
    }

    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
    }

    saveTimer.current = setTimeout(async () => {
      try {
        await tauriApi.saveWindowState(x, y, w, h)
        lastSave.current = { x, y, w, h }
      } catch {
        // Not in Tauri context
      }
    }, SAVE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    let unlisten: (() => void) | null = null

    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const win = getCurrentWindow()

        // Listen for resize and move events
        const { listen } = await import('@tauri-apps/api/event')
        const fn = await listen('tauri://window-event', async () => {
          try {
            const pos = await win.outerPosition()
            const size = await win.outerSize()
            saveState(pos.x, pos.y, size.width, size.height)
          } catch {
            // Window might be closing
          }
        })
        unlisten = fn

        // Also save position on first load
        try {
          const pos = await win.outerPosition()
          const size = await win.outerSize()
          saveState(pos.x, pos.y, size.width, size.height)
        } catch {}
      })
      .catch(() => {})

    return () => { unlisten?.() }
  }, [saveState])
}
