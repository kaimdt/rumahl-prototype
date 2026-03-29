import { useState, useRef, useCallback } from 'react'
import { Textbox } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface TextInputWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function TextInputWidget({ entity, onUpdate }: TextInputWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [localValue, setLocalValue] = useState<string | null>(null)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const maxLength = (entity.attributes.max as number) || undefined
  const currentValue = localValue ?? entity.state

  const handleSubmit = useCallback(async () => {
    if (localValue === null || localValue === entity.state) return
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.setText(entity.entity_id, localValue)
      toast.success(`${name}: ${localValue}`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Setzen des Texts')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
      setLocalValue(null)
    }
  }, [localValue, entity.entity_id, entity.state, name, onUpdate])

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
            <Textbox size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {entity.state}
            </p>
          </div>
        </div>
        <input
          type="text"
          value={currentValue}
          onChange={(e) => setLocalValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          disabled={isUpdating}
          maxLength={maxLength}
          className="w-full px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
          placeholder="Text eingeben..."
        />
      </div>
    </div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Textbox size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
