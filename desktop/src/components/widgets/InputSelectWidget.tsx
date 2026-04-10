import { useState } from 'react'
import { ListBullets } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface InputSelectWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function InputSelectWidget({ entity, onUpdate }: InputSelectWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const options = (entity.attributes.options as string[]) || []
  const currentOption = entity.state

  const handleSelect = async (option: string) => {
    if (isUpdating || option === currentOption) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.selectOption(entity.entity_id, option)
      toast.success(`${name}: ${option}`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Setzen der Auswahl')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

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
            <ListBullets size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {currentOption}
            </p>
          </div>
        </div>
        <select
          value={currentOption}
          onChange={(e) => handleSelect(e.target.value)}
          disabled={isUpdating}
          className="w-full px-3 py-2 rounded-xl bg-foreground/5 border border-foreground/10 text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-accent/50 disabled:opacity-50"
        >
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    </div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<ListBullets size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
