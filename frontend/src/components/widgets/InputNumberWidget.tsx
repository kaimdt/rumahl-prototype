import { useState, useRef, useCallback } from 'react'
import { Sliders } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface InputNumberWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function InputNumberWidget({ entity, onUpdate }: InputNumberWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [localValue, setLocalValue] = useState<number | null>(null)
  const commitTimer = useRef<number | undefined>(undefined)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const min = (entity.attributes.min as number) ?? 0
  const max = (entity.attributes.max as number) ?? 100
  const step = (entity.attributes.step as number) ?? 1
  const unit = (entity.attributes.unit_of_measurement as string) || ''
  const currentValue = localValue ?? (parseFloat(entity.state) || min)

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value)
    setLocalValue(val)
    haptics.selectionChanged()

    // Debounce the service call
    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current)
    }
    commitTimer.current = window.setTimeout(async () => {
      setIsUpdating(true)
      try {
        await haService.setValue(entity.entity_id, val)
        toast.success(`${name}: ${val}${unit}`)
        haptics.notification('success')
        onUpdate?.()
      } catch {
        toast.error('Fehler beim Setzen des Werts')
        haptics.notification('error')
      } finally {
        setIsUpdating(false)
        setLocalValue(null)
      }
    }, 400)
  }, [entity.entity_id, name, unit, onUpdate])

  const percentage = ((currentValue - min) / (max - min)) * 100

  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
    <div {...longPressHandlers} className="glass-card rounded-2xl theme-transition relative overflow-hidden select-none touch-none">
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2.5 rounded-xl"
            style={{
              backgroundColor: 'oklch(from var(--accent) l c h / 0.2)',
              color: 'var(--accent)',
            }}
          >
            <Sliders size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {currentValue}{unit}
            </p>
          </div>
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
            step={step}
            value={currentValue}
            onChange={handleChange}
            disabled={isUpdating}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-foreground/40">{min}{unit}</span>
          <span className="text-[10px] text-foreground/40">{max}{unit}</span>
        </div>
      </div>
    </div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Sliders size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
