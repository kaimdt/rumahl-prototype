import { motion } from 'framer-motion'
import { ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'

interface BinarySensorWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

function toLabel(rawState: string): string {
  const state = rawState.toLowerCase()
  if (state === 'on' || state === 'open' || state === 'detected' || state === 'true') return 'Aktiv'
  if (state === 'off' || state === 'closed' || state === 'clear' || state === 'false') return 'Inaktiv'
  return rawState
}

export function BinarySensorWidget({ entity }: BinarySensorWidgetProps) {
  const name = String(entity.attributes.friendly_name || entity.entity_id)
  const label = toLabel(entity.state)
  const isActive = label === 'Aktiv'
  const statusColor = isActive ? 'oklch(0.55 0.14 55)' : 'var(--muted-foreground)'
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
    <motion.div
      {...longPressHandlers}
      className="glass-card rounded-2xl theme-transition relative overflow-hidden select-none touch-none"
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <div className="absolute inset-x-0 top-0 h-1" style={{
        background: isActive
          ? 'linear-gradient(90deg, oklch(0.70 0.18 35), oklch(0.74 0.15 55))'
          : 'linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))',
      }} />

      <div className="relative p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div
              className="p-2.5 rounded-xl"
              style={{
                backgroundColor: isActive
                  ? 'oklch(0.80 0.08 70 / 0.35)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isActive ? 'oklch(0.55 0.14 55)' : 'var(--muted-foreground)',
              }}
            >
              {isActive ? <WarningCircle size={20} weight="fill" /> : <ShieldCheck size={20} weight="fill" />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{name}</h3>
              <p className="text-xs text-muted-foreground">Binary Sensor</p>
            </div>
          </div>

          <span
            className="px-2.5 py-1 rounded-full text-[11px] font-medium"
            style={{
              backgroundColor: isActive
                ? 'oklch(0.78 0.08 70 / 0.25)'
                : 'oklch(from var(--foreground) l c h / 0.08)',
              color: isActive ? 'oklch(0.58 0.14 55)' : 'var(--foreground)',
            }}
          >
            {label}
          </span>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={label}
      icon={<ShieldCheck size={20} weight="fill" />}
      color={statusColor}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
