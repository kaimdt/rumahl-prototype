import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Fan, Power } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { EntityHistoryPanel } from './EntityHistoryPanel'

interface FanControlDialogProps {
  entity: EntityState
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

function SpeedColumn({
  percentage,
  isOn,
  onChange,
  onCommit,
}: {
  percentage: number
  isOn: boolean
  onChange: (value: number) => void
  onCommit: (value: number) => void
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  const fanColor = 'oklch(0.65 0.18 200)'

  const calcPercentage = useCallback((clientY: number) => {
    if (!columnRef.current) return percentage
    const rect = columnRef.current.getBoundingClientRect()
    const margin = 8
    const y = clientY - rect.top - margin
    const usableHeight = rect.height - margin * 2
    const ratio = 1 - Math.max(0, Math.min(1, y / usableHeight))
    return Math.round(ratio * 100)
  }, [percentage])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    const val = calcPercentage(e.clientY)
    onChange(val)
    haptics.impact('light')
  }, [calcPercentage, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const val = calcPercentage(e.clientY)
    onChange(val)
    haptics.selectionChanged()
  }, [calcPercentage, onChange])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    const val = calcPercentage(e.clientY)
    onCommit(val)
    haptics.impact('medium')
  }, [calcPercentage, onCommit])

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={columnRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="relative w-20 h-52 rounded-[28px] overflow-hidden cursor-pointer touch-none select-none"
        style={{
          background: 'oklch(from var(--foreground) l c h / 0.06)',
          border: '1px solid oklch(from var(--foreground) l c h / 0.1)',
        }}
      >
        {/* Fill */}
        <motion.div
          className="absolute bottom-0 left-0 right-0 rounded-[28px]"
          initial={false}
          animate={{ height: `${percentage}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{
            background: isOn
              ? `linear-gradient(to top, ${fanColor}, color-mix(in oklch, ${fanColor} 60%, white))`
              : 'oklch(from var(--foreground) l c h / 0.15)',
          }}
        />

        {/* Glow */}
        {isOn && (
          <motion.div
            className="absolute bottom-0 left-0 right-0 pointer-events-none"
            initial={false}
            animate={{ height: `${Math.min(percentage + 10, 100)}%`, opacity: 0.5 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            style={{
              background: `radial-gradient(ellipse at bottom, ${fanColor}, transparent 70%)`,
              filter: 'blur(8px)',
            }}
          />
        )}

        {/* Thumb indicator */}
        <motion.div
          className="absolute left-0 right-0 flex justify-center pointer-events-none"
          initial={false}
          animate={{ bottom: `${percentage}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          <div
            className="w-12 h-1.5 rounded-full bg-white/90"
            style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.3)', transform: 'translateY(50%)' }}
          />
        </motion.div>

        {/* Percentage */}
        <div className="absolute inset-0 flex items-center justify-center">
          <motion.span
            className="text-2xl font-bold drop-shadow-sm"
            style={{
              color: percentage > 45 ? 'rgba(0,0,0,0.7)' : 'oklch(from var(--foreground) l c h / 0.8)',
            }}
            key={percentage}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {percentage}%
          </motion.span>
        </div>
      </div>

      <span className="text-xs text-foreground/50 font-medium">Geschwindigkeit</span>
    </div>
  )
}

export function FanControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
}: FanControlDialogProps) {
  const [optimisticOn, setOptimisticOn] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')
  const isOn = optimisticOn !== null ? optimisticOn : entity.state === 'on'
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const [isUpdating, setIsUpdating] = useState(false)
  const [percentage, setPercentage] = useState(
    (entity.attributes.percentage as number) || 0
  )
  const lastChangeRef = useRef<Record<string, number>>({})

  const fanColor = 'oklch(0.65 0.18 200)'

  useEffect(() => {
    setOptimisticOn(null)
  }, [entity.state])

  useEffect(() => {
    if (
      entity.attributes.percentage !== undefined &&
      Date.now() - (lastChangeRef.current.percentage ?? 0) > 4000
    ) {
      setPercentage(entity.attributes.percentage as number)
    }
  }, [entity])

  const handleToggle = async () => {
    haptics.impact('medium')
    setOptimisticOn(!isOn)
    setIsUpdating(true)
    try {
      await haService.toggleEntity(entity.entity_id)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      setOptimisticOn(null)
      toast.error('Fehler beim Schalten')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleSpeedChange = (value: number) => {
    setPercentage(value)
  }

  const handleSpeedCommit = async (value: number) => {
    lastChangeRef.current.percentage = Date.now()
    setIsUpdating(true)
    try {
      await haService.callService('fan', 'set_percentage', entity.entity_id, {
        percentage: value,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Anpassen der Geschwindigkeit')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handlePresetSpeed = async (value: number) => {
    const prev = percentage
    setPercentage(value)
    lastChangeRef.current.percentage = Date.now()
    if (!isOn) setOptimisticOn(true)
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('fan', 'set_percentage', entity.entity_id, {
        percentage: value,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch {
      setPercentage(prev)
      setOptimisticOn(null)
      toast.error('Fehler beim Anpassen der Geschwindigkeit')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const otherAttributes = Object.entries(entity.attributes).filter(
    ([key]) => !['friendly_name', 'percentage'].includes(key)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[380px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Ventilator Steuerung</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        {isOn && (
          <motion.div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            animate={{ opacity: 0.2, scale: [1, 1.05, 1] }}
            transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
            style={{
              background: `radial-gradient(circle, ${fanColor}, transparent 70%)`,
              filter: 'blur(40px)',
            }}
          />
        )}

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={isOn ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: isOn
                  ? `color-mix(in oklch, ${fanColor} 25%, transparent)`
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isOn ? fanColor : 'var(--muted-foreground)',
              }}
            >
              <motion.div
                animate={isOn ? { rotate: [0, 180, 360] } : { rotate: 0 }}
                transition={isOn ? { duration: 3, repeat: Infinity, ease: 'linear' } : {}}
              >
                <Fan size={20} weight={isOn ? 'fill' : 'regular'} />
              </motion.div>
            </motion.div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40">
                {isOn ? `Eingeschaltet - ${percentage}%` : 'Ausgeschaltet'}
              </p>
            </div>
          </div>
          <motion.button
            onClick={handleToggle}
            disabled={isUpdating}
            className="p-2.5 rounded-full transition-colors shrink-0"
            style={{
              backgroundColor: isOn
                ? `color-mix(in oklch, ${fanColor} 20%, transparent)`
                : 'oklch(from var(--foreground) l c h / 0.08)',
              color: isOn ? fanColor : 'var(--foreground)',
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

        {activeTab === 'controls' ? (
        <div className="relative px-5 pb-5 space-y-5">
          {/* Speed slider + presets */}
          <div className="flex items-start gap-5">
            <SpeedColumn
              percentage={percentage}
              isOn={isOn}
              onChange={handleSpeedChange}
              onCommit={handleSpeedCommit}
            />

            <div className="flex-1 space-y-4 pt-1">
              <div>
                <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5 mb-2.5">
                  <Fan size={14} weight="fill" />
                  Schnellwahl
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[25, 50, 75, 100].map((p) => (
                    <motion.button
                      key={p}
                      onClick={() => handlePresetSpeed(p)}
                      className="py-2.5 rounded-xl text-xs font-semibold transition-colors"
                      style={{
                        backgroundColor:
                          percentage === p
                            ? `color-mix(in oklch, ${fanColor} 25%, transparent)`
                            : 'oklch(from var(--foreground) l c h / 0.06)',
                        color:
                          percentage === p
                            ? fanColor
                            : 'oklch(from var(--foreground) l c h / 0.6)',
                        border:
                          percentage === p
                            ? `1px solid color-mix(in oklch, ${fanColor} 30%, transparent)`
                            : '1px solid oklch(from var(--foreground) l c h / 0.08)',
                      }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      {p}%
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Entity info */}
              <div className="rounded-xl p-3" style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground/40">Status</span>
                    <span className="text-foreground/60 font-medium">{isOn ? 'An' : 'Aus'}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-foreground/40">Geschwindigkeit</span>
                    <span className="text-foreground/60 font-medium">{percentage}%</span>
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
              </div>
            </div>
          </div>
        </div>
        ) : (
        <div className="relative px-5 pb-5">
          <EntityHistoryPanel
            entityId={entity.entity_id}
            entityState={entity.state}
            color={isOn ? 'var(--accent)' : undefined}
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
