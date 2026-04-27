import { useState, useRef, useCallback, useEffect, memo } from 'react'
import { motion } from 'framer-motion'
import { Power, PlugsConnected } from '@phosphor-icons/react'
import type { SwitchEntity } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { SwitchControlDialog } from './SwitchControlDialog'

interface SwitchWidgetProps {
  entity: SwitchEntity
  onUpdate?: () => void
  config?: Record<string, unknown>
}

export const SwitchWidget = memo(function SwitchWidget({ entity, onUpdate, config }: SwitchWidgetProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const name = entity.attributes.friendly_name || entity.entity_id
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const fastTapTimerRef = useRef<number | undefined>(undefined)
  const pointerActiveRef = useRef(false)
  const dialogOpenedRef = useRef(false)
  const toggledRef = useRef(false)

  // Clear optimistic state when entity actually updates from server
  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  const handleToggle = useCallback(() => {
    haptics.impact('medium')
    setOptimisticOn(!isOn)
    haService.toggleEntityFireAndForget(entity.entity_id)
    haptics.notification('success')
  }, [isOn, entity.entity_id])

  const clearTimers = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
    if (fastTapTimerRef.current !== undefined) {
      window.clearTimeout(fastTapTimerRef.current)
      fastTapTimerRef.current = undefined
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    pointerActiveRef.current = true
    dialogOpenedRef.current = false
    clearTimers()

    // Long-press: open dialog after 500ms
    longPressTimerRef.current = window.setTimeout(() => {
      dialogOpenedRef.current = true
      haptics.impact('medium')
      setDialogOpen(true)
    }, 500)
  }, [clearTimers])

  const handlePointerUp = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimers()
    // Toggle on quick tap (no long-press dialog opened)
    if (!dialogOpenedRef.current) {
      handleToggle()
    }
  }, [clearTimers, handleToggle])

  const handlePointerLeave = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearTimers()
  }, [clearTimers])

  // Compact variant
  if (config?.cardVariant === 'compact') {
    return (
      <>
        <div
          className="glass-card rounded-2xl theme-transition p-2.5 cursor-pointer select-none touch-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground truncate">{name}</span>
            <span className={`text-sm font-mono shrink-0 ml-2 ${isOn ? 'text-accent' : 'text-foreground/40'}`}>
              {isOn ? 'An' : 'Aus'}
            </span>
          </div>
        </div>
        <SwitchControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
      </>
    )
  }

  return (
    <>
      <motion.div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className={`glass-card glass-card-shimmer rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none ${isOn ? 'widget-glow-active' : ''}`}
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
              <div
                className="icon-container-premium p-2.5 rounded-xl transition-all duration-300"
                data-active={isOn}
                style={{
                  backgroundColor: isOn
                    ? 'oklch(from var(--accent) l c h / 0.3)'
                    : 'oklch(from var(--muted) l c h / 0.5)',
                  color: isOn ? 'var(--accent)' : 'var(--muted-foreground)',
                  boxShadow: isOn
                    ? '0 4px 20px oklch(from var(--accent) l c h / 0.25), 0 0 40px oklch(from var(--accent) l c h / 0.08)'
                    : 'none',
                }}
              >
                <PlugsConnected size={20} weight={isOn ? 'fill' : 'regular'} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-medium text-sm truncate">{name}</h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {isOn ? 'Eingeschaltet' : 'Ausgeschaltet'}
                </p>
              </div>
            </div>
            <motion.div
              className="p-2 rounded-full transition-colors duration-300"
              animate={{
                backgroundColor: isOn
                  ? 'oklch(from var(--accent) l c h / 0.2)'
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isOn ? 'var(--accent)' : 'var(--muted-foreground)',
              }}
              transition={{ duration: 0.3 }}
            >
              <Power size={18} weight={isOn ? 'fill' : 'regular'} />
            </motion.div>
          </div>
        </div>
      </motion.div>
      <SwitchControlDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} onUpdate={onUpdate} />
    </>
  )
})