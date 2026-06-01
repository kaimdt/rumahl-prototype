import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Power, PlugsConnected } from '@phosphor-icons/react'
import type { SwitchEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion } from 'motion/react'
import { EntityHistoryPanel } from './EntityHistoryPanel'

interface SwitchControlDialogProps {
  entity: SwitchEntity
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate?: () => void
}

function formatRelativeTime(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffH / 24)

  if (diffMin < 1) return 'gerade eben'
  if (diffMin < 60) return `vor ${diffMin} min`
  if (diffH < 24) return `vor ${diffH} h`
  return `vor ${diffDays} Tagen`
}

export function SwitchControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
}: SwitchControlDialogProps) {
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const name = entity.attributes.friendly_name || entity.entity_id
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')

  const accentColor = 'var(--accent)'

  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  const handleToggle = () => {
    haptics.impact('medium')
    setOptimisticOn(!isOn)
    haService.toggleEntityFireAndForget(entity.entity_id)
    haptics.notification('success')
  }

  const otherAttributes = Object.entries(entity.attributes).filter(
    ([key]) => key !== 'friendly_name'
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[380px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Schalter Steuerung</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        {isOn && (
          <div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            style={{
              background: `radial-gradient(circle, ${accentColor}, transparent 70%)`,
              filter: 'blur(40px)',
              opacity: 0.2,
            }}
          />
        )}

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: isOn
                  ? `color-mix(in oklch, ${accentColor} 25%, transparent)`
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isOn ? accentColor : 'var(--muted-foreground)',
              }}
            >
              <PlugsConnected size={20} weight={isOn ? 'fill' : 'regular'} />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40">
                {isOn ? 'Eingeschaltet' : 'Ausgeschaltet'}
              </p>
            </div>
          </div>
          <motion.button
            onClick={handleToggle}
            className="p-2.5 rounded-full transition-colors shrink-0"
            style={{
              backgroundColor: isOn
                ? `color-mix(in oklch, ${accentColor} 20%, transparent)`
                : 'oklch(from var(--foreground) l c h / 0.08)',
              color: isOn ? accentColor : 'var(--foreground)',
            }}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <Power size={20} weight="bold" />
          </motion.button>
        </div>

        {/* Tab bar */}
        <div className="relative px-5 pb-2">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid oklch(from var(--foreground) l c h / 0.1)' }}>
            <button
              onClick={() => setActiveTab('controls')}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: activeTab === 'controls' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                color: activeTab === 'controls' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
              }}
            >
              Steuerung
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: activeTab === 'history' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                color: activeTab === 'history' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
              }}
            >
              Verlauf
            </button>
          </div>
        </div>

        {/* Main content */}
        {activeTab === 'controls' ? (
        <div className="relative px-5 pb-5 space-y-5">
          {/* Large toggle button */}
          <motion.div
            className="flex justify-center py-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
          >
            <motion.button
              onClick={handleToggle}
              className="relative w-24 h-24 rounded-full flex items-center justify-center transition-colors"
              style={{
                backgroundColor: isOn
                  ? `color-mix(in oklch, ${accentColor} 25%, transparent)`
                  : 'oklch(from var(--foreground) l c h / 0.06)',
                border: isOn
                  ? `2px solid color-mix(in oklch, ${accentColor} 40%, transparent)`
                  : '2px solid oklch(from var(--foreground) l c h / 0.1)',
                color: isOn ? accentColor : 'oklch(from var(--foreground) l c h / 0.4)',
                boxShadow: isOn
                  ? `0 0 40px color-mix(in oklch, ${accentColor} 30%, transparent)`
                  : 'none',
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Power size={40} weight={isOn ? 'fill' : 'regular'} />
              {/* Glow ring when on */}
              {isOn && (
                <div
                  className="absolute inset-0 rounded-full pointer-events-none"
                  style={{
                    boxShadow: `0 0 30px color-mix(in oklch, ${accentColor} 40%, transparent), inset 0 0 15px color-mix(in oklch, ${accentColor} 15%, transparent)`,
                    opacity: 0.4,
                  }}
                />
              )}
            </motion.button>
          </motion.div>

          {/* Entity info box */}
          <motion.div
            className="rounded-xl p-3"
            style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-foreground/40">Status</span>
                <span className="text-foreground/60 font-medium">{isOn ? 'An' : 'Aus'}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-foreground/40">Letzte Änderung</span>
                <span className="text-foreground/60 font-medium">
                  {formatRelativeTime(entity.last_changed)}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-foreground/40">Entity-ID</span>
                <span className="text-foreground/60 font-medium font-mono text-[10px]">
                  {entity.entity_id}
                </span>
              </div>
              {otherAttributes.map(([key, value]) => (
                <div key={key} className="flex justify-between text-[11px]">
                  <span className="text-foreground/40">{key}</span>
                  <span className="text-foreground/60 font-medium truncate ml-2 max-w-[60%] text-right">
                    {String(value)}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
        ) : (
        <div className="relative px-5 pb-5">
          <EntityHistoryPanel
            entityId={entity.entity_id}
            entityState={entity.state}
            color={isOn ? accentColor : undefined}
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
