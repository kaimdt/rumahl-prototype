import { useState } from 'react'
import { motion } from 'framer-motion'
import { Hourglass, Play, Pause, Stop } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface TimerWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function TimerWidget({ entity, onUpdate }: TimerWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const remaining = (entity.attributes.remaining as string) || '0:00:00'
  const isActive = entity.state === 'active'
  const isPaused = entity.state === 'paused'
  const isIdle = entity.state === 'idle'

  const stateLabel = isActive ? 'Laeuft' : isPaused ? 'Pausiert' : 'Inaktiv'
  const remainingParts = remaining.split(':').map((part) => part.padStart(2, '0'))
  const formattedRemaining = remainingParts.length === 3
    ? `${remainingParts[0]}:${remainingParts[1]}:${remainingParts[2]}`
    : remaining

  const handleAction = async (action: 'start' | 'pause' | 'cancel', label: string) => {
    if (isUpdating) return
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      if (action === 'start') await haService.startTimer(entity.entity_id)
      else if (action === 'pause') await haService.pauseTimer(entity.entity_id)
      else await haService.cancelTimer(entity.entity_id)
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
        className="absolute inset-x-0 top-0 h-1"
        style={{
          background: isActive
            ? 'linear-gradient(90deg, var(--accent), color-mix(in oklch, var(--accent) 60%, white))'
            : 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
        }}
      />

      <div className="relative p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-3">
          <div
            className="p-2.5 rounded-xl transition-all duration-300"
            style={{
              backgroundColor: isActive
                ? 'oklch(from var(--accent) l c h / 0.3)'
                : 'oklch(from var(--muted) l c h / 0.5)',
              color: isActive ? 'var(--accent)' : 'var(--muted-foreground)',
            }}
          >
            <Hourglass size={20} weight={isActive ? 'fill' : 'regular'} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground">Timer</p>
          </div>
          <span className="text-[11px] px-2 py-1 rounded-full bg-foreground/8 border border-foreground/12 text-foreground/75">
            {stateLabel}
          </span>
        </div>

        <div className="rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-foreground/45">Restzeit</p>
          <p className="font-mono text-xl font-semibold mt-0.5">{!isIdle ? formattedRemaining : '00:00:00'}</p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => handleAction('start', 'Gestartet')}
            disabled={isUpdating || isActive}
            className="flex-1 h-10 rounded-xl bg-accent/14 hover:bg-accent/22 text-accent text-xs font-semibold transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Play size={14} weight="bold" />
            Start
          </button>
          <button
            onClick={() => handleAction('pause', 'Pausiert')}
            disabled={isUpdating || !isActive}
            className="flex-1 h-10 rounded-xl bg-foreground/6 hover:bg-foreground/12 text-foreground/80 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Pause size={14} weight="bold" />
            Pause
          </button>
          <button
            onClick={() => handleAction('cancel', 'Abgebrochen')}
            disabled={isUpdating || isIdle}
            className="flex-1 h-10 rounded-xl bg-foreground/6 hover:bg-foreground/12 text-foreground/80 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            <Stop size={14} weight="bold" />
            Stopp
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<Hourglass size={20} weight="fill" />}
      color={'var(--accent)'}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
