import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb } from '@phosphor-icons/react'
import type { EntityState, LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { LightControlDialog } from './LightControlDialog'

interface LightWidgetProps {
  entity: LightEntity
  onUpdate?: () => void
  allEntities?: EntityState[]
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

export const LightWidget = memo(function LightWidget({ entity, onUpdate, allEntities, config, widgetSize }: LightWidgetProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragBrightness, setDragBrightness] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const brightness = entity.attributes.brightness || 0
  const name = entity.attributes.friendly_name || entity.entity_id
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const fastTapTimerRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const dialogOpenedRef = useRef(false)
  const toggledRef = useRef(false)
  const startXRef = useRef<number>(0)
  const pointerActiveRef = useRef(false)
  const lastBrightnessChangeRef = useRef(0)
  const lastLiveSendRef = useRef(0)
  const liveSendTimerRef = useRef<number | undefined>(undefined)

  // Clear optimistic state when entity actually updates
  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  // Clear drag brightness when entity brightness updates from server
  useEffect(() => {
    if (Date.now() - lastBrightnessChangeRef.current > 4000) {
      setDragBrightness(null)
    }
  }, [entity.attributes.brightness])

  const displayBrightness = dragBrightness !== null ? dragBrightness : brightness
  const displayIsOn = dragBrightness !== null ? dragBrightness > 0 : isOn

  const rgbColor = entity.attributes.rgb_color
  const lightColor = rgbColor 
    ? `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`
    : 'oklch(0.68 0.18 140)'

  const calculateBrightnessFromX = useCallback((clientX: number) => {
    if (!cardRef.current) return null
    const rect = cardRef.current.getBoundingClientRect()
    const margin = 16
    const x = clientX - rect.left - margin
    const usableWidth = rect.width - margin * 2
    const percentage = Math.max(0, Math.min(1, x / usableWidth))
    return Math.round(percentage * 255)
  }, [])

  const clearTimers = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
    if (fastTapTimerRef.current !== undefined) {
      window.clearTimeout(fastTapTimerRef.current)
      fastTapTimerRef.current = undefined
    }
  }, [])

  // Send brightness to HA while dragging (throttled, fire-and-forget)
  const sendLiveBrightness = useCallback((value: number) => {
    const now = Date.now()
    const THROTTLE_MS = 500
    if (liveSendTimerRef.current) {
      window.clearTimeout(liveSendTimerRef.current)
    }
    if (now - lastLiveSendRef.current >= THROTTLE_MS) {
      lastLiveSendRef.current = now
      lastBrightnessChangeRef.current = now
      haService.turnOnFireAndForget(entity.entity_id, { brightness: Math.max(1, value) })
    } else {
      // Schedule a trailing send
      liveSendTimerRef.current = window.setTimeout(() => {
        lastLiveSendRef.current = Date.now()
        lastBrightnessChangeRef.current = Date.now()
        haService.turnOnFireAndForget(entity.entity_id, { brightness: Math.max(1, value) })
      }, THROTTLE_MS - (now - lastLiveSendRef.current))
    }
  }, [entity.entity_id])

  const updateBrightness = useCallback((newBrightness: number) => {
    lastBrightnessChangeRef.current = Date.now()
    haptics.impact('medium')
    const finalBrightness = Math.max(1, newBrightness)
    haService.turnOnFireAndForget(entity.entity_id, { brightness: finalBrightness })
    haptics.notification('success')
  }, [entity.entity_id])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    clearTimers()
    isDraggingRef.current = false
    hasMovedRef.current = false
    dialogOpenedRef.current = false
    toggledRef.current = false
    startXRef.current = e.clientX
    pointerActiveRef.current = true
    setIsPressed(true)

    haptics.impact('light')

    longPressTimerRef.current = window.setTimeout(() => {
      if (!hasMovedRef.current) {
        haptics.impact('medium')
        dialogOpenedRef.current = true
        setDialogOpen(true)
        setDragBrightness(null)
        setIsPressed(false)
      }
    }, 500)
  }, [clearTimers])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    // Only handle movement if pointer is down (being pressed)
    if (!isPressed) return

    const movementThreshold = 5
    const distanceMoved = Math.abs(e.clientX - startXRef.current)

    if (distanceMoved > movementThreshold && !hasMovedRef.current) {
      hasMovedRef.current = true
      isDraggingRef.current = true
      setIsDragging(true)
      clearTimers()

      const initialBrightness = calculateBrightnessFromX(startXRef.current)
      if (initialBrightness !== null) {
        setDragBrightness(initialBrightness)
      }
    }

    if (hasMovedRef.current) {
      const newBrightness = calculateBrightnessFromX(e.clientX)
      if (newBrightness !== null && (dragBrightness === null || Math.abs(newBrightness - dragBrightness) > 3)) {
        setDragBrightness(newBrightness)
        sendLiveBrightness(newBrightness)
        haptics.selectionChanged()
      }
    }
  }, [isPressed, dragBrightness, calculateBrightnessFromX, clearTimers, sendLiveBrightness])

  const handlePointerUp = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimers()
    if (liveSendTimerRef.current) {
      window.clearTimeout(liveSendTimerRef.current)
      liveSendTimerRef.current = undefined
    }
    setIsDragging(false)
    setIsPressed(false)

    if (hasMovedRef.current && dragBrightness !== null) {
      updateBrightness(dragBrightness)
    } else if (!hasMovedRef.current && !isDraggingRef.current && !dialogOpenedRef.current) {
      haptics.impact('medium')
      setOptimisticOn(!isOn)
      haService.toggleEntityFireAndForget(entity.entity_id)
      haptics.notification('success')
    }

    isDraggingRef.current = false
    hasMovedRef.current = false
  }, [dragBrightness, updateBrightness, clearTimers, entity.entity_id, isOn])

  // Compact variant
  if (config?.cardVariant === 'compact' || config?.cardVariant === 'toggle') {
    const isToggleOnly = config?.cardVariant === 'toggle'
    return (
      <>
        <div
          className="glass-card rounded-2xl theme-transition p-2.5 cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Lightbulb
                size={16}
                weight={displayIsOn ? 'fill' : 'regular'}
                className={displayIsOn ? 'text-accent' : 'text-foreground/40'}
              />
              <span className="text-sm font-medium text-foreground truncate">{name}</span>
            </div>
            {isToggleOnly ? (
              <span className={`text-xs px-2 py-1 rounded-full shrink-0 ml-2 ${displayIsOn ? 'bg-accent/15 text-accent' : 'bg-foreground/8 text-foreground/50'}`}>
                {displayIsOn ? 'An' : 'Aus'}
              </span>
            ) : (
              <span className={`text-sm font-mono shrink-0 ml-2 ${displayIsOn ? 'text-accent' : 'text-foreground/40'}`}>
                {displayIsOn ? `${Math.round((displayBrightness / 255) * 100)}%` : 'Aus'}
              </span>
            )}
          </div>
        </div>
        <LightControlDialog
          entity={entity}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onUpdate={onUpdate}
          allEntities={allEntities}
          modalSize={config?.modalSize as string | undefined}
        />
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
        className={`glass-card glass-card-shimmer rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none ${displayIsOn ? 'widget-glow-active' : ''}`}
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
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsOn 
              ? `linear-gradient(to right, ${lightColor} 0%, color-mix(in oklch, ${lightColor} 40%, transparent) 60%, transparent 100%)`
              : 'transparent',
            opacity: displayIsOn ? 0.35 : 0,
          }}
          animate={{
            clipPath: `inset(0 ${100 - (displayBrightness / 255) * 100}% 0 0)`,
          }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />
        
        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="icon-container-premium p-2.5 rounded-xl transition-all duration-300"
                data-active={displayIsOn}
                style={{
                  backgroundColor: displayIsOn
                    ? `color-mix(in oklch, ${lightColor} 30%, transparent)`
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: displayIsOn ? lightColor : 'var(--muted-foreground)',
                  boxShadow: displayIsOn
                    ? `0 4px 20px color-mix(in oklch, ${lightColor} 25%, transparent), 0 0 40px color-mix(in oklch, ${lightColor} 10%, transparent)`
                    : 'none',
                }}
              >
                <Lightbulb
                  size={20}
                  weight={displayIsOn ? 'fill' : 'regular'}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono number-display">
                  {displayIsOn
                    ? `${Math.round((displayBrightness / 255) * 100)}%`
                    : 'Aus'}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <LightControlDialog
        entity={entity}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUpdate={onUpdate}
        allEntities={allEntities}
        modalSize={config?.modalSize as string | undefined}
      />
    </>
  )
})