import { useRef, useCallback, useState, useEffect } from 'react'

export interface UseLongPressOptions {
  onShortPress?: () => void
  onLongPress?: () => void
  onDragStart?: () => void
  onDrag?: (delta: { x: number; y: number }, total: { x: number; y: number }) => void
  onDragEnd?: () => void
  threshold?: number
  dragThreshold?: number
}

export function useLongPress({
  onShortPress,
  onLongPress,
  onDragStart,
  onDrag,
  onDragEnd,
  threshold = 500,
  dragThreshold = 10,
}: UseLongPressOptions) {
  const [isDragging, setIsDragging] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)
  const startPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const currentPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const totalDragRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const hasDraggedRef = useRef(false)
  const hasLongPressedRef = useRef(false)
  const isActiveRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])

  const handleStart = useCallback(
    (clientX: number, clientY: number) => {
      isActiveRef.current = true
      hasDraggedRef.current = false
      hasLongPressedRef.current = false
      startPositionRef.current = { x: clientX, y: clientY }
      currentPositionRef.current = { x: clientX, y: clientY }
      totalDragRef.current = { x: 0, y: 0 }

      timerRef.current = window.setTimeout(() => {
        if (isActiveRef.current && !hasDraggedRef.current) {
          hasLongPressedRef.current = true
          onLongPress?.()
        }
      }, threshold)
    },
    [onLongPress, threshold]
  )

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isActiveRef.current) return

      const deltaX = clientX - currentPositionRef.current.x
      const deltaY = clientY - currentPositionRef.current.y
      const totalX = clientX - startPositionRef.current.x
      const totalY = clientY - startPositionRef.current.y

      totalDragRef.current = { x: totalX, y: totalY }

      const distance = Math.sqrt(totalX * totalX + totalY * totalY)

      if (distance > dragThreshold && !hasLongPressedRef.current) {
        if (!hasDraggedRef.current) {
          hasDraggedRef.current = true
          clearTimer()
          setIsDragging(true)
          onDragStart?.()
        }
      }

      if (hasDraggedRef.current) {
        onDrag?.(
          { x: deltaX, y: deltaY },
          { x: totalX, y: totalY }
        )
      }

      currentPositionRef.current = { x: clientX, y: clientY }
    },
    [onDragStart, onDrag, dragThreshold, clearTimer]
  )

  const handleEnd = useCallback(() => {
    clearTimer()
    isActiveRef.current = false

    if (hasDraggedRef.current) {
      setIsDragging(false)
      onDragEnd?.()
    } else if (!hasLongPressedRef.current) {
      onShortPress?.()
    }

    hasDraggedRef.current = false
    hasLongPressedRef.current = false
  }, [clearTimer, onShortPress, onDragEnd])

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  const handlers = {
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault()
      handleStart(e.clientX, e.clientY)
    },
    onMouseMove: (e: React.MouseEvent) => {
      handleMove(e.clientX, e.clientY)
    },
    onMouseUp: () => {
      handleEnd()
    },
    onMouseLeave: () => {
      if (isActiveRef.current && !hasDraggedRef.current) {
        handleEnd()
      }
    },
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0]
      handleStart(touch.clientX, touch.clientY)
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0]
      handleMove(touch.clientX, touch.clientY)
    },
    onTouchEnd: () => {
      handleEnd()
    },
    onTouchCancel: () => {
      handleEnd()
    },
  }

  return { handlers, isDragging }
}
