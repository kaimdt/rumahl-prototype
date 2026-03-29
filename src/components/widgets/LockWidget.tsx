import { useState } from 'react'
import { motion } from 'framer-motion'
import { LockKey } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface LockWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function LockWidget({ entity, onUpdate }: LockWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const isLocked = entity.state === 'locked'
  const statusColor = isLocked ? 'var(--accent)' : 'oklch(0.75 0.15 55)'
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  const handleToggleLock = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (isLocked) {
        await haService.unlockEntity(entity.entity_id)
        toast.success(`${name}: Entriegelt`)
      } else {
        await haService.lockEntity(entity.entity_id)
        toast.success(`${name}: Verriegelt`)
      }
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Steuern')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <>
    <motion.div
      {...longPressHandlers}
      className="glass-card rounded-2xl theme-transition relative overflow-hidden select-none touch-none"
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300"
            style={{
              backgroundColor: isLocked
                ? 'oklch(from var(--accent) l c h / 0.3)'
                : 'oklch(0.75 0.15 55 / 0.3)',
              color: isLocked ? 'var(--accent)' : 'oklch(0.75 0.15 55)',
            }}
          >
            <LockKey size={20} weight={isLocked ? 'fill' : 'regular'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {isLocked ? 'Verriegelt' : 'Entriegelt'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleToggleLock}
            disabled={isUpdating}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <LockKey size={14} weight="bold" />
            {isLocked ? 'Entriegeln' : 'Verriegeln'}
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<LockKey size={20} weight="fill" />}
      color={statusColor}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
