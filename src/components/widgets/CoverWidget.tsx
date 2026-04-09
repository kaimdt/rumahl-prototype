import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowsDownUp } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'
import { CoverControlDialog } from './CoverControlDialog'

interface CoverWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: Record<string, unknown>
}

export function CoverWidget({ entity, onUpdate, config }: CoverWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragPosition, setDragPosition] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [optimisticState, setOptimisticState] = useState<string | null>(null)
  const displayState = optimisticState ?? entity.state
  const isOpen = displayState === 'open'
  const isClosed = displayState === 'closed'
  const position = (entity.attributes.current_position as number) ?? (isOpen ? 100 : 0)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const dialogOpenedRef = useRef(false)
  const startXRef = useRef<number>(0)
  const pointerActiveRef = useRef(false)
  const lastPositionChangeRef = useRef(0)

  useEffect(() => {
    setOptimisticState(null)
  }, [entity.state])

  useEffect(() => {
    if (Date.now() - lastPositionChangeRef.current > 4000) {
      setDragPosition(null)
    }
  }, [entity.attributes.current_position])

  const displayPosition = dragPosition !== null ? dragPosition : position
  const displayIsOpen = dragPosition !== null ? dragPosition > 0 : isOpen

  const calculatePositionFromX = useCallback((clientX: number) => {
    if (!cardRef.current) return null
    const rect = cardRef.current.getBoundingClientRect()
    const margin = 16
    const x = clientX - rect.left - margin
    const usableWidth = rect.width - margin * 2
    const pct = Math.max(0, Math.min(1, x / usableWidth))
    return Math.round(pct * 100)
  }, [])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const updatePosition = useCallback(async (newPosition: number) => {
    lastPositionChangeRef.current = Date.now()
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'set_cover_position', entity.entity_id, {
        position: newPosition,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Anpassen der Position')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }, [entity.entity_id, onUpdate])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    clearLongPressTimer()
    isDraggingRef.current = false
    hasMovedRef.current = false
    dialogOpenedRef.current = false
    startXRef.current = e.clientX
    pointerActiveRef.current = true
    setIsPressed(true)

    haptics.impact('light')

    longPressTimerRef.current = window.setTimeout(() => {
      if (!hasMovedRef.current) {
        haptics.impact('medium')
        dialogOpenedRef.current = true
        setDialogOpen(true)
        setIsPressed(false)
      }
    }, 500)
  }, [clearLongPressTimer])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPressed) return

    const movementThreshold = 5
    const distanceMoved = Math.abs(e.clientX - startXRef.current)

    if (distanceMoved > movementThreshold && !hasMovedRef.current) {
      hasMovedRef.current = true
      isDraggingRef.current = true
      setIsDragging(true)
      clearLongPressTimer()

      const initialPos = calculatePositionFromX(startXRef.current)
      if (initialPos !== null) {
        setDragPosition(initialPos)
      }
    }

    if (hasMovedRef.current) {
      const newPos = calculatePositionFromX(e.clientX)
      if (newPos !== null && (dragPosition === null || Math.abs(newPos - dragPosition) > 2)) {
        setDragPosition(newPos)
        haptics.selectionChanged()
      }
    }
  }, [isPressed, dragPosition, calculatePositionFromX, clearLongPressTimer])

  const handlePointerUp = useCallback(async () => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearLongPressTimer()
    setIsDragging(false)
    setIsPressed(false)

    if (hasMovedRef.current && dragPosition !== null) {
      updatePosition(dragPosition)
    } else if (!hasMovedRef.current && !isDraggingRef.current && !dialogOpenedRef.current) {
      // Short tap — toggle open/close
      haptics.impact('medium')
      const newState = isOpen ? 'closed' : 'open'
      setOptimisticState(newState)
      setIsUpdating(true)
      try {
        if (isOpen) {
          await haService.callService('cover', 'close_cover', entity.entity_id)
        } else {
          await haService.callService('cover', 'open_cover', entity.entity_id)
        }
        haptics.notification('success')
        onUpdate?.()
      } catch {
        setOptimisticState(null)
        toast.error('Fehler beim Steuern')
        haptics.notification('error')
      } finally {
        setIsUpdating(false)
      }
    }

    isDraggingRef.current = false
    hasMovedRef.current = false
  }, [dragPosition, updatePosition, clearLongPressTimer, entity.entity_id, onUpdate, isOpen])

  // Compact variant
  if (config?.cardVariant === 'compact') {
    return (
      <>
        <div
          className="glass-card rounded-2xl theme-transition p-2.5 cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground truncate">{name}</span>
            <span className={`text-sm font-mono shrink-0 ml-2 ${displayIsOpen ? 'text-accent' : 'text-foreground/40'}`}>
              {isClosed ? 'Zu' : `${displayPosition}%`}
            </span>
          </div>
        </div>
        <CoverControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
      </>
    )
  }

  return (
    <>
      <motion.div
        ref={cardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none"
        initial={{ scale: 1 }}
        animate={{
          scale: isDragging ? 1.02 : isPressed ? 0.98 : 1,
        }}
        whileHover={!isDragging && !isPressed ? { scale: 1.01 } : {}}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 30,
        }}
      >
        {/* Position fill overlay */}
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsOpen
              ? 'linear-gradient(to right, oklch(from var(--accent) l c h) 0%, transparent 100%)'
              : 'transparent',
            opacity: displayIsOpen ? 0.4 : 0,
          }}
          animate={{
            clipPath: `inset(0 ${100 - displayPosition}% 0 0)`,
          }}
          transition={{ duration: 0.2 }}
        />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <motion.div
                className="p-2.5 rounded-xl transition-all duration-300"
                style={{
                  backgroundColor: displayIsOpen
                    ? 'oklch(from var(--accent) l c h / 0.3)'
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: displayIsOpen ? 'var(--accent)' : 'var(--muted-foreground)',
                  boxShadow: displayIsOpen
                    ? '0 4px 20px oklch(from var(--accent) l c h / 0.2)'
                    : 'none',
                }}
              >
                <ArrowsDownUp size={20} weight={displayIsOpen ? 'fill' : 'regular'} />
              </motion.div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {isClosed ? 'Geschlossen' : displayIsOpen ? `${displayPosition}%` : entity.state}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      <CoverControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
    </>
  )
}
