import { useState } from 'react'
import { motion } from 'motion/react'
import { ShieldWarning } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface AlarmWidgetProps {
  entity: EntityState
  onUpdate?: () => void
  config?: Record<string, unknown>
}

const stateLabels: Record<string, string> = {
  disarmed: 'Unscharf',
  armed_home: 'Zuhause',
  armed_away: 'Abwesend',
  armed_night: 'Nacht',
  triggered: 'Ausgelöst!',
  pending: 'Warten',
  arming: 'Wird scharf',
}

function getStateColor(state: string): {
  bg: string
  fg: string
} {
  switch (state) {
    case 'disarmed':
      return {
        bg: 'oklch(0.55 0.18 145 / 0.3)',
        fg: 'oklch(0.55 0.18 145)',
      }
    case 'triggered':
      return {
        bg: 'oklch(0.55 0.25 30 / 0.3)',
        fg: 'oklch(0.55 0.25 30)',
      }
    case 'armed_home':
    case 'armed_away':
    case 'armed_night':
    case 'arming':
      return {
        bg: 'oklch(from var(--accent) l c h / 0.3)',
        fg: 'var(--accent)',
      }
    default:
      return {
        bg: 'oklch(from var(--muted) l c h / 0.5)',
        fg: 'var(--muted-foreground)',
      }
  }
}

export function AlarmWidget({ entity, onUpdate, config }: AlarmWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const [code, setCode] = useState('')
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const state = entity.state
  const codeRequired = entity.attributes.code_arm_required as boolean | undefined
  const label = stateLabels[state] || state
  const colors = getStateColor(state)
  const isArmed = state.startsWith('armed_')

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
      setCode('')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Steuern')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const codeValue = codeRequired && code ? code : undefined

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
              backgroundColor: colors.bg,
              color: colors.fg,
            }}
          >
            <ShieldWarning
              size={20}
              weight={isArmed || state === 'triggered' ? 'fill' : 'regular'}
            />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground font-mono">{label}</p>
          </div>
        </div>

        {codeRequired && (
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            placeholder="Code eingeben"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-full px-3 py-2 mb-3 rounded-xl bg-foreground/5 text-foreground text-xs font-mono text-center tracking-widest placeholder:text-foreground/30 outline-none focus:ring-1 focus:ring-accent"
          />
        )}

        <div className="flex gap-2">
          <button
            onClick={() =>
              handleAction(
                () => haService.disarmAlarm(entity.entity_id, codeValue),
                'Unscharf geschaltet'
              )
            }
            disabled={isUpdating || state === 'disarmed'}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Unscharf
          </button>
          <button
            onClick={() =>
              handleAction(
                () => haService.armAlarm(entity.entity_id, 'arm_home', codeValue),
                'Zuhause scharf'
              )
            }
            disabled={isUpdating || state === 'armed_home'}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Zuhause
          </button>
          <button
            onClick={() =>
              handleAction(
                () => haService.armAlarm(entity.entity_id, 'arm_away', codeValue),
                'Abwesend scharf'
              )
            }
            disabled={isUpdating || state === 'armed_away'}
            className="flex-1 px-3 py-2 rounded-xl bg-foreground/5 hover:bg-foreground/10 text-foreground/70 text-xs font-medium transition-colors disabled:opacity-30 flex items-center justify-center gap-1.5"
          >
            Abwesend
          </button>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={entity.state}
      icon={<ShieldWarning size={20} weight="fill" />}
      color={colors.fg}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
      modalSize={config?.modalSize as string | undefined}
    />
    </>
  )
}
