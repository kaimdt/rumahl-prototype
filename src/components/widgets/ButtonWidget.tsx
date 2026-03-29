import { useState } from 'react'
import { motion } from 'framer-motion'
import { CursorClick } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface ButtonWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function ButtonWidget({ entity, onUpdate }: ButtonWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id

  const formatLastPressed = (timestamp: string | undefined): string => {
    if (!timestamp) return ''
    try {
      const date = new Date(timestamp)
      return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return ''
    }
  }

  const lastPressed = formatLastPressed(entity.last_changed)

  const handlePress = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.pressButton(entity.entity_id)
      toast.success(`${name}: Gedrückt`)
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
      className="glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none"
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      onClick={handlePress}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300"
            style={{
              backgroundColor: 'oklch(from var(--accent) l c h / 0.3)',
              color: 'var(--accent)',
            }}
          >
            <CursorClick size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            {lastPressed && (
              <p className="text-xs text-muted-foreground font-mono">
                Zuletzt: {lastPressed}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<CursorClick size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
