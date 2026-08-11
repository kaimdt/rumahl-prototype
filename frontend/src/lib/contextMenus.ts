import { useEffect } from 'react'

/**
 * Global context-menu coordination: only ONE right-click menu may be open
 * at any time. Opening a menu anywhere closes every other menu first.
 */
export const CLOSE_CONTEXT_MENUS_EVENT = 'iora:close-context-menus'

export function closeAllContextMenus() {
  window.dispatchEvent(new Event(CLOSE_CONTEXT_MENUS_EVENT))
}

/** Closes this component's menu whenever any other menu opens. */
export function useCloseOnOtherMenu(onClose: () => void) {
  useEffect(() => {
    const handler = () => onClose()
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, handler)
    return () => window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, handler)
  }, [onClose])
}
