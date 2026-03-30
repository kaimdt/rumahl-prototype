import { useState } from 'react'
import { motion } from 'framer-motion'
import { HashStraight, Minus, Plus, ArrowCounterClockwise } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface CounterWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: Record<string, unknown>
}

export function CounterWidget({ entity, onUpdate, config }: CounterWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const value = entity.state

  const handleAction = async (action: 'increment' | 'decrement' | 'reset', label: string) => {
    if (isUpdating) return
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (action === 'increment') await haService.increment(entity.entity_id)
      else if (action === 'decrement') await haService.decrement(entity.entity_id)
      else await haService.resetCounter(entity.entity_id)
      toast.success(`${name}: ${label}`)
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
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-40 pointer-events-none"
        style={{ backgroundColor: 'var(--accent)' }}
      />

      <div className="relative p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl"
            style={{
              backgroundColor: 'oklch(from var(--accent) l c h / 0.2)',
              color: 'var(--accent)',
            }}
          >
            <HashStraight size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground">Counter</p>
          </div>
        </div>

        <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
          <p className="text-[11px] uppercase tracking-[0.14em] text-foreground/45">Aktueller Wert</p>
          <p className="text-3xl font-mono font-semibold text-foreground leading-tight">{value}</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => handleAction('decrement', 'Verringert')}
            disabled={isUpdating}
            className="h-10 rounded-xl bg-foreground/6 hover:bg-foreground/12 text-foreground/80 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Minus size={16} weight="bold" />
            Minus
          </button>
          <button
            onClick={() => handleAction('increment', 'Erhöht')}
            disabled={isUpdating}
            className="h-10 rounded-xl bg-accent/14 hover:bg-accent/22 text-accent text-xs font-semibold transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Plus size={16} weight="bold" />
            Plus
          </button>
        </div>

        <button
          onClick={() => handleAction('reset', 'Zurückgesetzt')}
          disabled={isUpdating}
          className="w-full h-9 rounded-xl bg-foreground/6 hover:bg-foreground/12 text-foreground/55 text-xs transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
        >
          <ArrowCounterClockwise size={12} />
          Zurücksetzen
        </button>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<HashStraight size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      modalSize={config?.modalSize as string | undefined}
    />
    </>
  )
}
