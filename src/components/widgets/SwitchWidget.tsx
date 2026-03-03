import { useState } from 'react'
import { motion } from 'framer-motion'
import { Power, PlugsConnected } from '@phosphor-icons/react'
import type { SwitchEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { toast } from 'sonner'

interface SwitchWidgetProps {
  entity: SwitchEntity
  onUpdate?: () => void
}

export function SwitchWidget({ entity, onUpdate }: SwitchWidgetProps) {
  const [isUpdating, setIsUpdating] = useState(false)
  const isOn = entity.state === 'on'
  const name = entity.attributes.friendly_name || entity.entity_id

  const handleToggle = async () => {
    if (isUpdating) return

    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      toast.success(isOn ? `${name} ausgeschaltet` : `${name} eingeschaltet`)
      haptics.notification('success')
      onUpdate?.()
    } catch (error) {
      toast.error('Fehler beim Schalten')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  return (
    <motion.button
      onClick={handleToggle}
      disabled={isUpdating}
      className="glass-card rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none disabled:opacity-50"
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      transition={{
        type: 'spring',
        stiffness: 400,
        damping: 25,
      }}
    >
      <div className="relative p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <motion.div
              className={`p-2.5 rounded-xl transition-all duration-300`}
              style={{
                backgroundColor: isOn
                  ? 'oklch(from var(--accent) l c h / 0.3)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isOn ? 'var(--accent)' : 'var(--muted-foreground)',
                boxShadow: isOn
                  ? '0 4px 20px oklch(from var(--accent) l c h / 0.2)'
                  : 'none',
              }}
              animate={
                isOn
                  ? {
                      scale: [1, 1.05, 1],
                    }
                  : {}
              }
              transition={{
                duration: 2,
                repeat: isOn ? Infinity : 0,
                repeatType: 'reverse',
              }}
            >
              <PlugsConnected
                size={20}
                weight={isOn ? 'fill' : 'regular'}
              />
            </motion.div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{name}</h3>
              <p className="text-xs text-muted-foreground font-mono">
                {isOn ? 'Eingeschaltet' : 'Ausgeschaltet'}
              </p>
            </div>
          </div>
          <div
            className={`p-2 rounded-full transition-all duration-300 ${
              isOn
                ? 'bg-accent/20 text-accent'
                : 'bg-muted/50 text-muted-foreground'
            }`}
          >
            <Power size={18} weight={isOn ? 'fill' : 'regular'} />
          </div>
        </div>
      </div>
    </motion.button>
  )
}
