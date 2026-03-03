import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ThermometerSimple, Flame, Snowflake, Fan, Wind, ArrowsOutCardinal } from '@phosphor-icons/react'
import type { ClimateEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { useLongPress } from '@/hooks/use-long-press'
import { ClimateControlDialog } from './ClimateControlDialog'
import { toast } from 'sonner'

interface ClimateWidgetProps {
  entity: ClimateEntity
  onUpdate?: () => void
}

export function ClimateWidget({ entity, onUpdate }: ClimateWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dragTemp, setDragTemp] = useState<number | null>(null)
  const currentTemp = entity.attributes.current_temperature || 0
  const targetTemp = entity.attributes.temperature || 20
  const mode = entity.state
  const name = entity.attributes.friendly_name || entity.entity_id
  const hvacAction = entity.attributes.hvac_action
  const currentTempRef = useRef(targetTemp)
  const startTempRef = useRef(0)

  currentTempRef.current = targetTemp

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

  const getModeColor = (modeType: string) => {
    switch (modeType) {
      case 'heat':
        return 'from-destructive/30 to-destructive/20 shadow-destructive/20 text-destructive'
      case 'cool':
        return 'from-accent/30 to-accent/20 shadow-accent/20 text-accent'
      case 'auto':
        return 'from-success/30 to-success/20 shadow-success/20 text-success'
      default:
        return 'bg-muted/50 text-muted-foreground'
    }
  }

  const handleToggle = useCallback(async () => {
    if (isUpdating) return
    setIsUpdating(true)
    try {
      const newMode = mode === 'off' ? 'auto' : 'off'
      await haService.callService('climate', 'set_hvac_mode', entity.entity_id, {
        hvac_mode: newMode,
      })
      toast.success(mode === 'off' ? `${name} aktiviert` : `${name} deaktiviert`, {
        duration: 2000,
      })
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Schalten')
    } finally {
      setIsUpdating(false)
    }
  }, [entity.entity_id, isUpdating, mode, name, onUpdate])

  const handleLongPress = useCallback(() => {
    setDialogOpen(true)
  }, [])

  const handleDragStart = useCallback(() => {
    startTempRef.current = currentTempRef.current
    setDragTemp(currentTempRef.current)
  }, [])

  const handleDrag = useCallback(
    (_delta: { x: number; y: number }, total: { x: number; y: number }) => {
      const sensitivity = 0.02
      const change = -total.y * sensitivity
      const newTemp = Math.max(
        15,
        Math.min(30, startTempRef.current + change)
      )
      setDragTemp(Math.round(newTemp * 2) / 2)
    },
    []
  )

  const handleDragEnd = useCallback(async () => {
    if (dragTemp === null) return

    setIsUpdating(true)
    try {
      await haService.callService('climate', 'set_temperature', entity.entity_id, {
        temperature: dragTemp,
      })
      toast.success(`${name} auf ${dragTemp.toFixed(1)}°C`)
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Anpassen der Temperatur')
    } finally {
      setIsUpdating(false)
      setDragTemp(null)
    }
  }, [dragTemp, entity.entity_id, name, onUpdate])

  const { handlers, isDragging } = useLongPress({
    onShortPress: handleToggle,
    onLongPress: handleLongPress,
    onDragStart: handleDragStart,
    onDrag: handleDrag,
    onDragEnd: handleDragEnd,
    threshold: 500,
    dragThreshold: 10,
  })

  const displayTemp = dragTemp !== null ? dragTemp : targetTemp

  return (
    <>
      <motion.div
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
        {...handlers}
      >
        <div className="p-4 sm:p-5">
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <motion.div
                  className={`p-2.5 rounded-xl transition-all duration-300 bg-gradient-to-br shadow-lg ${getModeColor(mode)}`}
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 3, repeat: Infinity, repeatType: 'reverse' }}
                >
                  {getModeIcon(mode)}
                </motion.div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm truncate">{name}</h3>
                  <p className="text-xs text-muted-foreground capitalize">
                    {hvacAction || mode}
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

            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-1">
                <div className="flex items-baseline gap-1">
                  <ThermometerSimple size={16} weight="fill" className="text-muted-foreground" />
                  <span className="text-2xl font-light">{currentTemp.toFixed(1)}</span>
                  <span className="text-xs text-muted-foreground">°C</span>
                </div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Aktuell</p>
              </div>

              <div className="h-12 w-px bg-border"></div>

              <div className="flex-1 text-center space-y-1">
                <div className="text-2xl font-light">{displayTemp.toFixed(1)}°C</div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ziel</p>
              </div>
            </div>

            <AnimatePresence>
              {isDragging && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="relative h-2 bg-muted/50 rounded-full overflow-hidden">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent/60 to-accent rounded-full"
                      style={{
                        width: `${((displayTemp - 15) / (30 - 15)) * 100}%`,
                      }}
                      layout
                    />
                  </div>
                  <div className="text-center mt-2">
                    <span className="text-2xl font-bold font-mono text-foreground">
                      {displayTemp.toFixed(1)}°C
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
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

      <ClimateControlDialog
        entity={entity}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onUpdate={onUpdate}
      />
    </>
  )
}
