import { useState } from 'react'
import { motion } from 'motion/react'
import { GearSix } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface AutomationWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: Record<string, unknown>
}

export function AutomationWidget({ entity, onUpdate, config }: AutomationWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const isOn = entity.state === 'on'
  const lastTriggered = entity.attributes.last_triggered as string | undefined

  const formatLastTriggered = (timestamp: string | undefined): string => {
    if (!timestamp) return 'Nie'
    try {
      const date = new Date(timestamp)
      return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return 'Unbekannt'
    }
  }

  const handleTrigger = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('automation', 'trigger', entity.entity_id)
      toast.success(`${name}: Ausgelöst`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Steuern')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleToggle = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(`${name}: ${isOn ? 'Deaktiviert' : 'Aktiviert'}`)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Steuern')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

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
            <GearSix size={20} weight={isOn ? 'fill' : 'regular'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {isOn ? 'Aktiv' : 'Inaktiv'} · {formatLastTriggered(lastTriggered)}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleTrigger}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <GearSix size={14} weight="bold" />
            Auslösen
          </button>
          <button
            onClick={handleToggle}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            {isOn ? 'Deaktivieren' : 'Aktivieren'}
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<GearSix size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      modalSize={config?.modalSize as string | undefined}
    />
    </>
  )
}
