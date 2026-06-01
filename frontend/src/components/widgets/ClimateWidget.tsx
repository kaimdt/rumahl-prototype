import { useTranslation } from 'react-i18next'
import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { motion } from 'motion/react'
import { ThermometerSimple, Flame, Snowflake, Fan, Wind } from '@phosphor-icons/react'
import type { ClimateEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { ClimateControlDialog } from './ClimateControlDialog'
import { toast } from 'sonner'

interface ClimateWidgetProps {
  entity: ClimateEntity
  onUpdate?: () => void
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

export const ClimateWidget = memo(function ClimateWidget({ entity, onUpdate, config, widgetSize }: ClimateWidgetProps) {
  const { t } = useTranslation()
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragTemp, setDragTemp] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isPressed, setIsPressed] = useState(false)
  const [optimisticMode, setOptimisticMode] = useState<string | null>(null)
  const currentTemp = entity.attributes.current_temperature || 0
  const targetTemp = entity.attributes.temperature || 20
  const mode = optimisticMode ?? entity.state
  const name = entity.attributes.friendly_name || entity.entity_id
  const hvacAction = entity.attributes.hvac_action
  const minTemp = Number(entity.attributes.min_temp ?? 7)
  const maxTemp = Number(entity.attributes.max_temp ?? 35)
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const dialogOpenedRef = useRef(false)
  const startXRef = useRef<number>(0)
  const pointerActiveRef = useRef(false)
  const lastTempChangeRef = useRef(0)

  // Clear drag temp when entity temp updates from server (with guard)
  useEffect(() => {
    if (Date.now() - lastTempChangeRef.current > 4000) {
      setDragTemp(null)
    }
  }, [entity.attributes.temperature])

  // Clear optimistic mode when entity state updates from server
  useEffect(() => {
    setOptimisticMode(null)
  }, [entity.state])

  const displayTemp = dragTemp !== null ? dragTemp : targetTemp
  const displayIsActive = mode !== 'off'

  const getActionColor = (action: string | undefined) => {
    switch (action) {
      case 'heating':
        return 'oklch(0.65 0.25 25)'
      case 'cooling':
        return 'oklch(0.65 0.18 240)'
      case 'idle':
        return 'oklch(0.75 0.15 85)'
      case 'off':
      default:
        return 'oklch(from var(--foreground) l c h / 0.25)'
    }
  }

  const getModeIcon = (modeType: string) => {
    switch (modeType) {
      case 'heat':
        return <Flame size={20} weight="fill" />
      case 'cool':
        return <Snowflake size={20} weight="fill" />
      case 'auto':
        return <Fan size={20} weight="fill" />
      default:
        return <Wind size={20} weight="regular" />
    }
  }

  const actionColor = getActionColor(hvacAction)

  const calculateTempFromX = useCallback((clientX: number) => {
    if (!cardRef.current) return null
    const rect = cardRef.current.getBoundingClientRect()
    const margin = 16
    const x = clientX - rect.left - margin
    const usableWidth = rect.width - margin * 2
    const percentage = Math.max(0, Math.min(1, x / usableWidth))
    const temp = minTemp + percentage * (maxTemp - minTemp)
    return Math.round(temp * 2) / 2 // Round to 0.5 steps
  }, [minTemp, maxTemp])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const updateTemperature = useCallback((newTemp: number) => {
    lastTempChangeRef.current = Date.now()
    haptics.impact('medium')
    haService.callServiceFireAndForget('climate', 'set_temperature', entity.entity_id, {
      temperature: newTemp,
    })
    haptics.notification('success')
  }, [entity.entity_id])

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
        setDragTemp(null)
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

      const initialTemp = calculateTempFromX(startXRef.current)
      if (initialTemp !== null) {
        setDragTemp(initialTemp)
      }
    }

    if (hasMovedRef.current) {
      const newTemp = calculateTempFromX(e.clientX)
      if (newTemp !== null && (dragTemp === null || Math.abs(newTemp - dragTemp) >= 0.5)) {
        setDragTemp(newTemp)
        haptics.selectionChanged()
      }
    }
  }, [isPressed, dragTemp, calculateTempFromX, clearLongPressTimer])

  const handlePointerUp = useCallback(async () => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearLongPressTimer()
    setIsDragging(false)
    setIsPressed(false)

    if (hasMovedRef.current && dragTemp !== null) {
      updateTemperature(dragTemp)
    } else if (!hasMovedRef.current && !isDraggingRef.current && !dialogOpenedRef.current) {
      // Short tap — toggle off/auto
      const newMode = mode === 'off' ? 'auto' : 'off'
      setOptimisticMode(newMode)
      haptics.impact('medium')
      haService.callServiceFireAndForget('climate', 'set_hvac_mode', entity.entity_id, {
        hvac_mode: newMode,
      })
    }

    isDraggingRef.current = false
    hasMovedRef.current = false
  }, [dragTemp, updateTemperature, clearLongPressTimer, entity.entity_id, mode])

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
            <span className={`text-sm font-mono shrink-0 ml-2 ${displayIsActive ? 'text-accent' : 'text-foreground/40'}`}>
              {displayIsActive ? `${displayTemp.toFixed(1)}°C` : t('common.off')}
            </span>
          </div>
        </div>
        <ClimateControlDialog
          entity={entity}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onUpdate={onUpdate}
          modalSize={config?.modalSize as string | undefined}
        />
      </>
    )
  }

  const clampedPercent = Math.max(0, Math.min(100, ((displayTemp - minTemp) / (maxTemp - minTemp)) * 100))

  return (
    <>
      <motion.div
        ref={cardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className={`glass-card glass-card-shimmer rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none ${displayIsActive ? 'widget-glow-active' : ''}`}
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
        {/* Temperature fill overlay */}
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsActive
              ? `linear-gradient(to right, ${actionColor} 0%, color-mix(in oklch, ${actionColor} 40%, transparent) 60%, transparent 100%)`
              : 'transparent',
            opacity: displayIsActive ? 0.35 : 0,
          }}
          animate={{
            clipPath: `inset(0 ${100 - clampedPercent}% 0 0)`,
          }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        />

        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className="icon-container-premium p-2.5 rounded-xl transition-all duration-300"
                data-active={displayIsActive}
                style={{
                  backgroundColor: displayIsActive
                    ? `color-mix(in oklch, ${actionColor} 30%, transparent)`
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: displayIsActive ? actionColor : 'var(--muted-foreground)',
                  boxShadow: displayIsActive
                    ? `0 4px 20px color-mix(in oklch, ${actionColor} 25%, transparent), 0 0 40px color-mix(in oklch, ${actionColor} 08%, transparent)`
                    : 'none',
                }}
              >
                {getModeIcon(mode)}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono number-display">
                  {displayIsActive
                    ? `${displayTemp.toFixed(1)}°C`
                    : t('common.off')}
                </p>
              </div>
            </div>
            {displayIsActive && (
              <div className="text-right shrink-0 ml-2">
                <div className="flex items-baseline gap-0.5">
                  <ThermometerSimple size={12} weight="fill" className="text-muted-foreground" />
                  <span className="text-sm font-light text-muted-foreground number-display">{currentTemp.toFixed(1)}°</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      <ClimateControlDialog
        entity={entity}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUpdate={onUpdate}
        modalSize={config?.modalSize as string | undefined}
      />
    </>
  )
})