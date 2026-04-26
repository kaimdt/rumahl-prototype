import { useState, useCallback } from 'react'
import { CalendarDots } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface DateTimeWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function DateTimeWidget({ entity, onUpdate }: DateTimeWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const hasDate = entity.attributes.has_date as boolean
  const hasTime = entity.attributes.has_time as boolean

  const handleChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      const data: Record<string, unknown> = {}
      if (hasDate && hasTime) {
        const [date, time] = e.target.value.includes('T')
          ? e.target.value.split('T')
          : [e.target.value, '']
        if (date) data.date = date
        if (time) data.time = time
      } else if (hasDate) {
        data.date = e.target.value
      } else if (hasTime) {
        data.time = e.target.value
      }
      await haService.setDateTime(entity.entity_id, data)
      toast.success(`${name} aktualisiert`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Setzen')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }, [entity.entity_id, name, hasDate, hasTime, onUpdate])

  const inputType = hasDate && hasTime ? 'datetime-local' : hasDate ? 'date' : 'time'
  const inputValue = entity.state === 'unknown' ? '' : entity.state

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
            <CalendarDots size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {entity.state}
            </p>
          </div>
        </div>
        <input
          type={inputType}
          value={inputValue}
          onChange={handleChange}
          disabled={isUpdating}
          className="w-full px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
        />
      </div>
    </div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<CalendarDots size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
