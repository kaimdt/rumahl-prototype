import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, ArrowsOutCardinal } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { useLongPress } from '@/hooks/use-long-press'
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
  const isOn = entity.state === 'on'
  const brightness = entity.attributes.brightness || 0
  const name = entity.attributes.friendly_name || entity.entity_id
  const currentBrightnessRef = useRef(brightness)
  const startBrightnessRef = useRef(0)

  currentBrightnessRef.current = brightness

  const handleToggle = useCallback(async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(isOn ? `${name} ausgeschaltet` : `${name} eingeschaltet`, {
        duration: 2000,
      })
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Schalten')
    } finally {
      setIsUpdating(false)
    }
  }, [entity.entity_id, isUpdating, isOn, name, onUpdate])

  const handleLongPress = useCallback(() => {
    setDialogOpen(true)
  }, [])

  const handleDragStart = useCallback(() => {
    startBrightnessRef.current = currentBrightnessRef.current
    setDragBrightness(currentBrightnessRef.current)
  }, [])

  const handleDrag = useCallback(
    (_delta: { x: number; y: number }, total: { x: number; y: number }) => {
      const sensitivity = 0.8
      const change = -total.y * sensitivity
      const newBrightness = Math.max(
        0,
        Math.min(255, startBrightnessRef.current + change)
      )
      setDragBrightness(Math.round(newBrightness))
    },
    []
  )

  const handleDragEnd = useCallback(async () => {
    if (dragBrightness === null) return

    setIsUpdating(true)
    try {
      if (dragBrightness === 0) {
        await haService.turnOff(entity.entity_id)
        toast.success(`${name} ausgeschaltet`)
      } else {
        await haService.turnOn(entity.entity_id, { brightness: dragBrightness })
        toast.success(`${name} auf ${Math.round((dragBrightness / 255) * 100)}%`)
      }
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Helligkeit')
    } finally {
      setIsUpdating(false)
      setDragBrightness(null)
    }
  }, [dragBrightness, entity.entity_id, name, onUpdate])

  const { handlers, isDragging } = useLongPress({
    onShortPress: handleToggle,
    onLongPress: handleLongPress,
    onDragStart: handleDragStart,
    onDrag: handleDrag,
    onDragEnd: handleDragEnd,
    threshold: 500,
    dragThreshold: 10,
  })

  const displayBrightness = dragBrightness !== null ? dragBrightness : brightness
  const displayIsOn = dragBrightness !== null ? dragBrightness > 0 : isOn

  return (
    <>
      <motion.div
        className={`glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none ${
          isDragging ? 'scale-105 shadow-2xl' : ''
        }`}
        style={{
          transition: isDragging ? 'none' : 'all 0.3s ease',
        }}
        whileHover={{ scale: isDragging ? 1.05 : 1.02 }}
        whileTap={{ scale: isDragging ? 1.05 : 0.98 }}
        {...handlers}
      >
        <div className="p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <motion.div
                className={`p-2.5 rounded-xl transition-all duration-300 ${
                  displayIsOn
                    ? 'bg-gradient-to-br from-success/30 to-success/20 shadow-lg shadow-success/20 text-success'
                    : 'bg-muted/50 text-muted-foreground'
                }`}
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
            <motion.div
              animate={{
                opacity: isDragging ? 1 : 0,
                scale: isDragging ? 1 : 0.5,
              }}
              className="absolute top-4 right-4"
            >
              <ArrowsOutCardinal
                size={20}
                weight="bold"
                className="text-accent"
              />
            </motion.div>
          </div>

          <AnimatePresence>
            {isDragging && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 overflow-hidden"
              >
                <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-success/60 to-success rounded-full"
                    style={{
                      width: `${(displayBrightness / 255) * 100}%`,
                    }}
                    layout
                  />
                </div>
                <div className="text-center mt-2">
                  <span className="text-2xl font-bold font-mono text-foreground">
                    {Math.round((displayBrightness / 255) * 100)}%
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {!isDragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.6 }}
            className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-muted-foreground pointer-events-none"
          >
            Tippen · Halten · Ziehen
          </motion.div>
        )}
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
