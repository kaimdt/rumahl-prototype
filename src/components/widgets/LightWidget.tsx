import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, Gear } from '@phosphor-icons/react'
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
  const sliderRef = useRef<HTMLDivElement>(null)

  const displayBrightness = dragBrightness !== null ? dragBrightness : brightness
  const displayIsOn = dragBrightness !== null ? dragBrightness > 0 : isOn

  const calculateBrightness = useCallback((clientX: number) => {
    if (!sliderRef.current) return null
    const rect = sliderRef.current.getBoundingClientRect()
    const x = clientX - rect.left
    const percentage = Math.max(0, Math.min(1, x / rect.width))
    return Math.round(percentage * 255)
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    
    haptics.impact('light')
    setIsDragging(true)
    const newBrightness = calculateBrightness(e.clientX)
    if (newBrightness !== null) {
      setDragBrightness(newBrightness)
    }
    
    sliderRef.current?.setPointerCapture(e.pointerId)
  }, [calculateBrightness])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return
    e.preventDefault()
    
    const newBrightness = calculateBrightness(e.clientX)
    if (newBrightness !== null && Math.abs(newBrightness - (dragBrightness || 0)) > 3) {
      haptics.selectionChanged()
      setDragBrightness(newBrightness)
    }
  }, [isDragging, dragBrightness, calculateBrightness])

  const handlePointerUp = useCallback(async (e: React.PointerEvent) => {
    if (!isDragging) return
    e.preventDefault()
    
    setIsDragging(false)
    
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
  }, [isDragging, dragBrightness, entity.entity_id, name, onUpdate])

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

  return (
    <>
      <motion.div
        className="glass-card rounded-2xl theme-transition relative overflow-hidden"
        whileHover={{ scale: 1.02 }}
      >
        <div className="p-4 sm:p-5 space-y-4">
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
            <button
              onClick={() => setDialogOpen(true)}
              className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <Gear size={20} className="text-muted-foreground" />
            </button>
          </div>

          <div className="space-y-2">
            <div
              ref={sliderRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="relative h-12 bg-muted/50 rounded-xl overflow-hidden cursor-pointer touch-none select-none"
            >
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-success/60 to-success rounded-xl"
                style={{
                  width: `${(displayBrightness / 255) * 100}%`,
                }}
                animate={{
                  opacity: displayIsOn ? 1 : 0.3,
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold font-mono text-foreground drop-shadow-lg">
                  {Math.round((displayBrightness / 255) * 100)}%
                </span>
              </div>
            </div>
            
            <div className="flex justify-between items-center">
              <span className="text-[10px] text-muted-foreground">0%</span>
              <span className="text-[10px] text-muted-foreground">100%</span>
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
