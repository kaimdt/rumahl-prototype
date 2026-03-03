import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { LightControlDialog } from './LightControlDialog'
import { toast } from 'sonner'

interface LightWidgetProps {
  entity: LightEntity
  onUpdate?: () => void
}

export function LightWidget({ entity, onUpdate }: LightWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragBrightness, setDragBrightness] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const isOn = entity.state === 'on'
  const brightness = entity.attributes.brightness || 0
  const name = entity.attributes.friendly_name || entity.entity_id
  const cardRef = useRef<HTMLDivElement>(null)
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const isDraggingRef = useRef(false)
  const hasMovedRef = useRef(false)
  const startXRef = useRef<number>(0)

  const displayBrightness = dragBrightness !== null ? dragBrightness : brightness
  const displayIsOn = dragBrightness !== null ? dragBrightness > 0 : isOn

  const rgbColor = entity.attributes.rgb_color
  const lightColor = rgbColor 
    ? `rgb(${rgbColor[0]}, ${rgbColor[1]}, ${rgbColor[2]})`
    : 'oklch(0.68 0.18 140)'

  const calculateBrightnessFromX = useCallback((clientX: number) => {
    if (!cardRef.current) return null
    const rect = cardRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(percentage * 255)
  }, [])

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const updateBrightness = useCallback(async (newBrightness: number) => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (newBrightness === 0) {
        await haService.turnOff(entity.entity_id)
        toast.success(`${name} ausgeschaltet`)
      } else {
        await haService.turnOn(entity.entity_id, { brightness: newBrightness })
        toast.success(`${name} auf ${Math.round((newBrightness / 255) * 100)}%`)
      }
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Helligkeit')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
      setDragBrightness(null)
    }
  }, [entity.entity_id, name, onUpdate])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    clearLongPressTimer()
    isDraggingRef.current = false
    hasMovedRef.current = false
    startXRef.current = e.clientX

    haptics.impact('light')

    longPressTimerRef.current = window.setTimeout(() => {
      if (!hasMovedRef.current) {
        haptics.impact('medium')
        setDialogOpen(true)
        setDragBrightness(null)
      }
    }, 500)
  }, [clearLongPressTimer])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const movementThreshold = 5
    const distanceMoved = Math.abs(e.clientX - startXRef.current)
    
    if (distanceMoved > movementThreshold && !hasMovedRef.current) {
      hasMovedRef.current = true
      isDraggingRef.current = true
      setIsDragging(true)
      clearLongPressTimer()
      
      const initialBrightness = calculateBrightnessFromX(startXRef.current)
      if (initialBrightness !== null) {
        setDragBrightness(initialBrightness)
      }
    }

    if (hasMovedRef.current) {
      const newBrightness = calculateBrightnessFromX(e.clientX)
      if (newBrightness !== null && (dragBrightness === null || Math.abs(newBrightness - dragBrightness) > 3)) {
        setDragBrightness(newBrightness)
        haptics.selectionChanged()
      }
    }
  }, [dragBrightness, calculateBrightnessFromX, clearLongPressTimer])

  const handlePointerUp = useCallback(async () => {
    clearLongPressTimer()
    setIsDragging(false)

    if (hasMovedRef.current && dragBrightness !== null) {
      updateBrightness(dragBrightness)
    } else if (!hasMovedRef.current && !isDraggingRef.current) {
      haptics.impact('medium')
      setIsUpdating(true)
      try {
        await haService.turnOff(entity.entity_id)
        toast.success(`${name} ausgeschaltet`)
        haptics.notification('success')
        onUpdate?.()
      } catch (error) {
        toast.error('Fehler beim Ausschalten')
        haptics.notification('error')
      } finally {
        setIsUpdating(false)
      }
    }

    isDraggingRef.current = false
    hasMovedRef.current = false
  }, [dragBrightness, updateBrightness, clearLongPressTimer, entity.entity_id, name, onUpdate])

  return (
    <>
      <motion.div
        ref={cardRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none"
        whileHover={{ scale: isDragging ? 1 : 1.02 }}
        whileTap={{ 
          scale: isDragging ? 1 : 0.98,
          transition: {
            type: "spring",
            stiffness: 500,
            damping: 30,
          }
        }}
        animate={{
          scale: isDragging ? 1.05 : 1,
        }}
        transition={{
          type: "spring",
          stiffness: 400,
          damping: 25,
        }}
      >
        <motion.div
          className="absolute inset-0 rounded-2xl pointer-events-none"
          style={{
            background: displayIsOn 
              ? `linear-gradient(to right, ${lightColor} 0%, transparent 100%)`
              : 'transparent',
            opacity: displayIsOn ? 0.4 : 0,
          }}
          animate={{
            clipPath: `inset(0 ${100 - (displayBrightness / 255) * 100}% 0 0)`,
          }}
          transition={{ duration: 0.2 }}
        />
        
        <div className="relative p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <motion.div
                className={`p-2.5 rounded-xl transition-all duration-300`}
                style={{
                  backgroundColor: displayIsOn 
                    ? `color-mix(in oklch, ${lightColor} 30%, transparent)`
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: displayIsOn ? lightColor : 'var(--muted-foreground)',
                  boxShadow: displayIsOn 
                    ? `0 4px 20px color-mix(in oklch, ${lightColor} 20%, transparent)`
                    : 'none',
                }}
                animate={
                  displayIsOn
                    ? {
                        scale: [1, 1.1, 1],
                        rotate: [0, 5, -5, 0],
                      }
                    : {}
                }
                transition={{
                  duration: 2,
                  repeat: displayIsOn ? Infinity : 0,
                  repeatType: 'reverse',
                }}
              >
                <Lightbulb
                  size={20}
                  weight={displayIsOn ? 'fill' : 'regular'}
                />
              </motion.div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono">
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
      />
    </>
  )
}
