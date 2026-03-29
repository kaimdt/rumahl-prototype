import { User } from '@phosphor-icons/react'
import { motion } from 'framer-motion'
import type { EntityState } from '@/lib/types'
import { toBackendImageUrl } from '@/lib/imageUrl'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'
import { GenericEntityDialog } from './GenericEntityDialog'

interface PersonWidgetProps {
  entity: EntityState
  onUpdate?: () => void
}

export function PersonWidget({ entity }: PersonWidgetProps) {
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const location = entity.state
  const isHome = location === 'home'
  const entityPicture = toBackendImageUrl(entity.attributes.entity_picture as string | undefined)
  const displayLocation = isHome ? 'Zuhause' : location === 'not_home' ? 'Abwesend' : location
  const statusColor = isHome ? 'var(--accent)' : 'oklch(0.62 0.14 30)'
  const { dialogOpen, setDialogOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
    <motion.div
      className="glass-card rounded-2xl theme-transition relative overflow-hidden select-none touch-none"
      whileHover={{ scale: 1.01 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      {...longPressHandlers}
    >
      <div
        className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-2xl opacity-40 pointer-events-none"
        style={{ backgroundColor: statusColor }}
      />
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          {entityPicture ? (
            <div className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0 border border-foreground/15">
              <img src={entityPicture} alt={name} className="w-full h-full object-cover" />
            </div>
          ) : (
            <div
              className="p-3 rounded-xl transition-all duration-300"
              style={{
                backgroundColor: isHome
                  ? 'oklch(from var(--accent) l c h / 0.3)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isHome ? 'var(--accent)' : 'var(--muted-foreground)',
              }}
            >
              <User size={20} weight={isHome ? 'fill' : 'regular'} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-sm truncate">{name}</h3>
            <p className="text-xs text-muted-foreground truncate">Person / Tracker</p>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-xl bg-foreground/6 border border-foreground/10 px-3 py-2">
          <span className="text-[11px] text-foreground/60 uppercase tracking-wider">Status</span>
          <span
            className="px-2 py-1 rounded-full text-[11px] font-medium"
            style={{
              backgroundColor: `color-mix(in oklch, ${statusColor} 20%, transparent)`,
              color: statusColor,
            }}
          >
            {displayLocation}
          </span>
        </div>
      </div>
    </motion.div>
    <GenericEntityDialog
      entityId={entity.entity_id}
      entityName={name}
      entityState={displayLocation}
      icon={<User size={20} weight="fill" />}
      color={statusColor}
      open={dialogOpen}
      onOpenChange={setDialogOpen}
    />
    </>
  )
}
