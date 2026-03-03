import { useState, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Lightbulb } from '@phosphor-icons/react'
import type { LightEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { LightControlDialog } from './LightControlDialog'
import { useLongPress } from '@/hooks/use-long-press'
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
  const cardRef = useRef<HTMLDivElement>(null)

  const displayBrightness = dragBrightness !== null ? dragBrightness : brightness
  const displayIsOn = dragBrightness !== null ? dragBrightness > 0 : isOn

  const calculateBrightnessFromX = useCallback((clientX: number) => {
    if (!cardRef.current) return null
    const rect = cardRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(percentage * 255)
  }, [])

  const handleToggle = useCallback(async () => {
    if (isUpdating) return
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(isOn ? `${name} ausgeschaltet` : `${name} eingeschaltet`, {
        duration: 2000,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Schalten')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }, [entity.entity_id, isUpdating, isOn, name, onUpdate])

  const { handlers, isDragging } = useLongPress({
    onShortPress: handleToggle,
    onLongPress: () => {
      haptics.impact('medium')
      setDialogOpen(true)
    },
    onDragStart: () => {
      haptics.impact('light')
    },
    onDrag: (delta, total) => {
      if (!cardRef.current) return
      const rect = cardRef.current.getBoundingClientRect()
      const currentX = total.x + rect.width / 2
      const newBrightness = calculateBrightnessFromX(currentX)
      if (newBrightness !== null) {
        if (dragBrightness === null || Math.abs(newBrightness - dragBrightness) > 3) {
          haptics.selectionChanged()
          setDragBrightness(newBrightness)
        }
      }
    },
    onDragEnd: async () => {
      if (dragBrightness === null) return
      
      haptics.impact('medium')
      setIsUpdating(true)
      try {
        if (dragBrightness === 0) {
          await haService.turnOff(entity.entity_id)
          toast.success(`${name} ausgeschaltet`)
        } else {
          await haService.turnOn(entity.entity_id, { brightness: dragBrightness })
          toast.success(`${name} auf ${Math.round((dragBrightness / 255) * 100)}%`)
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
    },
    threshold: 500,
    dragThreshold: 5,
  })

  return (
    <>
      <motion.div
        ref={cardRef}
        {...handlers}
        className="glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none"
        whileHover={{ scale: isDragging ? 1 : 1.02 }}
        whileTap={{ scale: isDragging ? 1 : 0.98 }}
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
          className="absolute inset-y-0 left-0 bg-gradient-to-r from-success/40 to-success/20 rounded-2xl pointer-events-none"
          style={{
            width: `${(displayBrightness / 255) * 100}%`,
          }}
          animate={{
            opacity: displayIsOn ? 0.8 : 0.2,
          }}
          transition={{ duration: 0.2 }}
        />
        
        <div className="relative p-4 sm:p-5 space-y-4">
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
          </div>

          {displayIsOn && (
            <div className="pointer-events-none">
              <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-success/60 to-success rounded-full"
                  style={{
                    width: `${(displayBrightness / 255) * 100}%`,
                  }}
                  animate={{
                    opacity: displayIsOn ? 1 : 0.3,
                  }}
                />
              </div>
            </div>
          )}
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
