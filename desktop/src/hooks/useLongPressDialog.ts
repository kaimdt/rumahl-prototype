import { useRef, useCallback, useState } from 'react'
import { haptics } from '@/lib/haptics'

/**
 * Hook for long-press to open a dialog.
 * Returns pointer handlers and dialog state.
 */
export function useLongPressDialog(delay = 500) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const pointerActiveRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerActiveRef.current = true
    clearTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      haptics.impact('medium')
      setDialogOpen(true)
    }, delay)
  }, [clearTimer, delay])

  const handlePointerUp = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimer()
  }, [clearTimer])

  const handlePointerLeave = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimer()
  }, [clearTimer])

  return {
    dialogOpen,
    setDialogOpen,
    longPressHandlers: {
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      onPointerLeave: handlePointerLeave,
    },
  }
}
