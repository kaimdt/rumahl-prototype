import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Robot } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface VacuumWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

const stateLabels: Record<string, string> = {
  cleaning: 'Reinigt',
  docked: 'Angedockt',
  idle: 'Inaktiv',
  returning: 'Kehrt zurück',
  error: 'Fehler',
}

export function VacuumWidget({ entity, onUpdate }: VacuumWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const state = entity.state
  const batteryLevel = entity.attributes.battery_level as number | undefined
  const isActive = state === 'cleaning'
  const isError = state === 'error'
  const label = stateLabels[state] || state

  const handleAction = async (
    action: () => Promise<void>,
    actionLabel: string
  ) => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await action()
      toast.success(`${name}: ${actionLabel}`)
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
              backgroundColor: isError
                ? 'oklch(0.55 0.25 30 / 0.3)'
                : isActive
                  ? 'oklch(from var(--accent) l c h / 0.3)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
              color: isError
                ? 'oklch(0.55 0.25 30)'
                : isActive
                  ? 'var(--accent)'
                  : 'var(--muted-foreground)',
            }}
          >
            <Robot size={20} weight={isActive ? 'fill' : 'regular'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {label}
              {batteryLevel !== undefined && ` · ${batteryLevel}%`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() =>
              handleAction(
                () => haService.startVacuum(entity.entity_id),
                'Gestartet'
              )
            }
            disabled={isUpdating || isActive}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Start
          </button>
          <button
            onClick={() =>
              handleAction(
                () => haService.stopVacuum(entity.entity_id),
                'Gestoppt'
              )
            }
            disabled={isUpdating || state === 'docked' || state === 'idle'}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Stopp
          </button>
          <button
            onClick={() =>
              handleAction(
                () => haService.returnToBase(entity.entity_id),
                'Kehrt zur Basis zurück'
              )
            }
            disabled={isUpdating || state === 'docked' || state === 'returning'}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Basis
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Robot size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
