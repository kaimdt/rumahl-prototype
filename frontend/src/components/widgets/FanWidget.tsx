import { useTranslation } from 'react-i18next'
import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'motion/react'
import { Fan } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'
import { FanControlDialog } from './FanControlDialog'

interface FanWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: Record<string, unknown>
}

export function FanWidget({ entity, onUpdate, config }: FanWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragPercent, setDragPercent] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const percentage = (entity.attributes.percentage as number) ?? 0
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const dialogOpenedRef = useRef(false)
  const startXRef = useRef<number>(0)
  const pointerActiveRef = useRef(false)
  const lastPercentChangeRef = useRef(0)

  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  useEffect(() => {
    if (Date.now() - lastPercentChangeRef.current > 4000) {
      setDragPercent(null)
    }
  }, [entity.attributes.percentage])

  const displayPercent = dragPercent !== null ? dragPercent : percentage
  const displayIsOn = dragPercent !== null ? dragPercent > 0 : isOn

  const calculatePercentFromX = useCallback((clientX: number) => {
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

  const updateSpeed = useCallback(async (newPercent: number) => {
    lastPercentChangeRef.current = Date.now()
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (newPercent === 0) {
        await haService.turnOff(entity.entity_id)
      } else {
        await haService.callService('fan', 'set_percentage', entity.entity_id, {
          percentage: newPercent,
        })
      }
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Anpassen der Geschwindigkeit')
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

      const initialPercent = calculatePercentFromX(startXRef.current)
      if (initialPercent !== null) {
        setDragPercent(initialPercent)
      }
    }

    if (hasMovedRef.current) {
      const newPercent = calculatePercentFromX(e.clientX)
      if (newPercent !== null && (dragPercent === null || Math.abs(newPercent - dragPercent) > 2)) {
        setDragPercent(newPercent)
        haptics.selectionChanged()
      }
    }
  }, [isPressed, dragPercent, calculatePercentFromX, clearLongPressTimer])

  const handlePointerUp = useCallback(async () => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearLongPressTimer()
    setIsDragging(false)
    setIsPressed(false)

    if (hasMovedRef.current && dragPercent !== null) {
      updateSpeed(dragPercent)
    } else if (!hasMovedRef.current && !isDraggingRef.current && !dialogOpenedRef.current) {
      // Short tap — toggle
      haptics.impact('medium')
      setOptimisticOn(!isOn)
      setIsUpdating(true)
      try {
        await haService.toggleEntity(entity.entity_id)
        haptics.notification('success')
        onUpdate?.()
      } catch {
        setOptimisticOn(null)
        toast.error('Fehler beim Schalten')
        haptics.notification('error')
      } finally {
        setIsUpdating(false)
      }
    }

    isDraggingRef.current = false
    hasMovedRef.current = false
  }, [dragPercent, updateSpeed, clearLongPressTimer, entity.entity_id, onUpdate, isOn])

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
            <span className={`text-sm font-mono shrink-0 ml-2 ${displayIsOn ? 'text-accent' : 'text-foreground/40'}`}>
              {displayIsOn ? `${displayPercent}%` : 'Aus'}
            </span>
          </div>
        </div>
        <FanControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
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
        {/* Speed fill overlay */}
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsOn
              ? 'linear-gradient(to right, oklch(from var(--accent) l c h) 0%, transparent 100%)'
              : 'transparent',
            opacity: displayIsOn ? 0.4 : 0,
          }}
          animate={{
            clipPath: `inset(0 ${100 - displayPercent}% 0 0)`,
          }}
          transition={{ duration: 0.2 }}
        />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <motion.div
                className="p-2.5 rounded-xl transition-all duration-300"
                style={{
                  backgroundColor: displayIsOn
                    ? 'oklch(from var(--accent) l c h / 0.3)'
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: displayIsOn ? 'var(--accent)' : 'var(--muted-foreground)',
                  boxShadow: displayIsOn
                    ? '0 4px 20px oklch(from var(--accent) l c h / 0.2)'
                    : 'none',
                }}
                animate={
                  displayIsOn
                    ? {
                        scale: [1, 1.1, 1],
                        rotate: [0, 180, 360],
                      }
                    : {}
                }
                transition={{
                  duration: 3,
                  repeat: displayIsOn ? Infinity : 0,
                  ease: 'linear',
                }}
              >
                <Fan size={20} weight={displayIsOn ? 'fill' : 'regular'} />
              </motion.div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {displayIsOn ? `${displayPercent}%` : 'Aus'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
      <FanControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
    </>
  )
}
