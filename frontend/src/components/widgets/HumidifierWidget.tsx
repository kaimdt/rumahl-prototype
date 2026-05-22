import { useState, useRef, useCallback } from 'react'
import { motion } from 'motion/react'
import { Drop } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface HumidifierWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function HumidifierWidget({ entity, onUpdate }: HumidifierWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [localHumidity, setLocalHumidity] = useState<number | null>(null)
  const commitTimer = useRef<number | undefined>(undefined)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const isOn = entity.state === 'on'
  const currentHumidity = entity.attributes.current_humidity as number | undefined
  const targetHumidity = localHumidity ?? (entity.attributes.humidity as number) ?? 50
  const min = (entity.attributes.min_humidity as number) ?? 0
  const max = (entity.attributes.max_humidity as number) ?? 100

  const handleToggle = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(isOn ? `${name} ausgeschaltet` : `${name} eingeschaltet`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Steuern')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleHumidityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setLocalHumidity(val)
    haptics.selectionChanged()

    // Debounce the service call
    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current)
    }
    commitTimer.current = window.setTimeout(async () => {
      setIsUpdating(true)
      try {
        await haService.setHumidity(entity.entity_id, val)
        toast.success(`${name}: ${val}%`)
        haptics.notification('success')
        onUpdate?.()
      } catch {
        toast.error('Fehler beim Steuern')
        haptics.notification('error')
      } finally {
        setIsUpdating(false)
        setLocalHumidity(null)
      }
    }, 400)
  }, [entity.entity_id, name, onUpdate])

  const percentage = ((targetHumidity - min) / (max - min)) * 100

  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
    <motion.div
      {...longPressHandlers}
      className="glass-card rounded-2xl theme-transition relative overflow-hidden select-none touch-none"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300"
            style={{
              backgroundColor: isOn
                ? 'oklch(from var(--accent) l c h / 0.3)'
                : 'oklch(from var(--muted) l c h / 0.5)',
              color: isOn ? 'var(--accent)' : 'var(--muted-foreground)',
            }}
          >
            <Drop size={20} weight={isOn ? 'fill' : 'regular'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {isOn ? 'An' : 'Aus'}
              {currentHumidity !== undefined && ` · Aktuell: ${currentHumidity}%`}
            </p>
          </div>
        </div>

        <button
          onClick={handleToggle}
          disabled={isUpdating}
          className="w-full px-3 py-2 mb-3 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
        >
          {isOn ? 'Ausschalten' : 'Einschalten'}
        </button>

        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-foreground/40">Ziel-Feuchte</span>
            <span className="text-xs font-mono text-foreground/70">{targetHumidity}%</span>
          </div>
          <div className="relative">
            <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${percentage}%`,
                  backgroundColor: 'var(--accent)',
                }}
              />
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={1}
              value={targetHumidity}
              onChange={handleHumidityChange}
              disabled={isUpdating || !isOn}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-[10px] text-foreground/40">{min}%</span>
            <span className="text-[10px] text-foreground/40">{max}%</span>
          </div>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Drop size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
