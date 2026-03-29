import { useState } from 'react'
import { motion } from 'framer-motion'
import { Play } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface ScriptWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function ScriptWidget({ entity, onUpdate }: ScriptWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const isRunning = entity.state === 'on'

  const handleExecute = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.turnOn(entity.entity_id)
      toast.success(`${name}: Gestartet`)
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
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300"
            style={{
              backgroundColor: isRunning
                ? 'oklch(from var(--accent) l c h / 0.3)'
                : 'oklch(from var(--muted) l c h / 0.5)',
              color: isRunning ? 'var(--accent)' : 'var(--muted-foreground)',
            }}
          >
            <motion.div
              animate={isRunning ? { rotate: [0, 0, -10, 10, -10, 0] } : {}}
              transition={isRunning ? { repeat: Infinity, duration: 1.2, ease: 'easeInOut' } : {}}
            >
              <Play size={20} weight={isRunning ? 'fill' : 'regular'} />
            </motion.div>
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">
              {isRunning ? 'Läuft...' : 'Bereit'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExecute}
            disabled={isUpdating || isRunning}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Play size={14} weight="bold" />
            Ausführen
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Play size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
