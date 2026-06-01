import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowsDownUp, ArrowUp, Stop, ArrowDown } from '@phosphor-icons/react'
import type { EntityState } from '@/lib/types'
import { haService } from '@/lib/homeAssistant'
import { haptics } from '@/lib/haptics'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { EntityHistoryPanel } from './EntityHistoryPanel'

interface CoverControlDialogProps {
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

function PositionColumn({
  position,
  isActive,
  onChange,
  onCommit,
}: {
  position: number
  isActive: boolean
  onChange: (value: number) => void
  onCommit: (value: number) => void
}) {
  const columnRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  const coverColor = 'oklch(0.65 0.15 270)'

  const calcPosition = useCallback((clientY: number) => {
    if (!columnRef.current) return position
    const rect = columnRef.current.getBoundingClientRect()
    const margin = 8
    const y = clientY - rect.top - margin
    const usableHeight = rect.height - margin * 2
    const ratio = 1 - Math.max(0, Math.min(1, y / usableHeight))
    return Math.round(ratio * 100)
  }, [position])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    isDraggingRef.current = true
    const val = calcPosition(e.clientY)
    onChange(val)
    haptics.impact('light')
  }, [calcPosition, onChange])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    const val = calcPosition(e.clientY)
    onChange(val)
    haptics.selectionChanged()
  }, [calcPosition, onChange])

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    const val = calcPosition(e.clientY)
    onCommit(val)
    haptics.impact('medium')
  }, [calcPosition, onCommit])

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
          animate={{ height: `${position}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{
            background: isActive
              ? `linear-gradient(to top, ${coverColor}, color-mix(in oklch, ${coverColor} 60%, white))`
              : 'oklch(from var(--foreground) l c h / 0.15)',
          }}
        />

        {/* Glow */}
        {isActive && position > 0 && (
          <motion.div
            className="absolute bottom-0 left-0 right-0 pointer-events-none"
            initial={false}
            animate={{ height: `${Math.min(position + 10, 100)}%`, opacity: 0.5 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            style={{
              background: `radial-gradient(ellipse at bottom, ${coverColor}, transparent 70%)`,
              filter: 'blur(8px)',
            }}
          />
        )}

        {/* Thumb indicator */}
        <motion.div
          className="absolute left-0 right-0 flex justify-center pointer-events-none"
          initial={false}
          animate={{ bottom: `${position}%` }}
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
              color: position > 45 ? 'rgba(0,0,0,0.7)' : 'oklch(from var(--foreground) l c h / 0.8)',
            }}
            key={position}
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.15 }}
          >
            {position}%
          </motion.span>
        </div>
      </div>

      <span className="text-xs text-foreground/50 font-medium">Position</span>
    </div>
  )
}

export function CoverControlDialog({
  entity,
  open,
  onOpenChange,
  onUpdate,
}: CoverControlDialogProps) {
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const isActive = entity.state !== 'closed'
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')
  const [isUpdating, setIsUpdating] = useState(false)
  const [position, setPosition] = useState(
    (entity.attributes.current_position as number) ?? (isActive ? 100 : 0)
  )
  const lastChangeRef = useRef<Record<string, number>>({})

  const coverColor = 'oklch(0.65 0.15 270)'

  useEffect(() => {
    if (
      entity.attributes.current_position !== undefined &&
      Date.now() - (lastChangeRef.current.position ?? 0) > 4000
    ) {
      setPosition(entity.attributes.current_position as number)
    }
  }, [entity])

  const handlePositionChange = (value: number) => {
    setPosition(value)
  }

  const handlePositionCommit = async (value: number) => {
    lastChangeRef.current.position = Date.now()
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'set_cover_position', entity.entity_id, {
        position: value,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Einstellen der Position')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleQuickPosition = async (value: number) => {
    const prev = position
    setPosition(value)
    lastChangeRef.current.position = Date.now()
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'set_cover_position', entity.entity_id, {
        position: value,
      })
      haptics.notification('success')
      onUpdate?.()
    } catch {
      setPosition(prev)
      toast.error('Fehler beim Einstellen der Position')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleOpen = async () => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'open_cover', entity.entity_id)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Öffnen')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleStop = async () => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'stop_cover', entity.entity_id)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Stoppen')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const handleClose = async () => {
    haptics.impact('medium')
    setIsUpdating(true)
    try {
      await haService.callService('cover', 'close_cover', entity.entity_id)
      haptics.notification('success')
      onUpdate?.()
    } catch {
      toast.error('Fehler beim Schließen')
      haptics.notification('error')
    } finally {
      setIsUpdating(false)
    }
  }

  const otherAttributes = Object.entries(entity.attributes).filter(
    ([key]) => !['friendly_name', 'current_position'].includes(key)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[380px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Rollladen Steuerung</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        {isActive && (
          <motion.div
            className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
            animate={{ opacity: 0.2, scale: [1, 1.05, 1] }}
            transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
            style={{
              background: `radial-gradient(circle, ${coverColor}, transparent 70%)`,
              filter: 'blur(40px)',
            }}
          />
        )}

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={isActive ? { scale: [1, 1.08, 1] } : {}}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: isActive
                  ? `color-mix(in oklch, ${coverColor} 25%, transparent)`
                  : 'oklch(from var(--muted) l c h / 0.5)',
                color: isActive ? coverColor : 'var(--muted-foreground)',
              }}
            >
              <ArrowsDownUp size={20} weight={isActive ? 'fill' : 'regular'} />
            </motion.div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40 capitalize">
                {entity.state === 'open' ? 'Offen' : entity.state === 'closed' ? 'Geschlossen' : entity.state}
              </p>
            </div>
          </div>
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
          {/* Position slider + controls */}
          <div className="flex items-start gap-5">
            <PositionColumn
              position={position}
              isActive={isActive}
              onChange={handlePositionChange}
              onCommit={handlePositionCommit}
            />

            <div className="flex-1 space-y-4 pt-1">
              {/* Quick positions */}
              <div>
                <label className="text-xs font-semibold text-foreground/70 flex items-center gap-1.5 mb-2.5">
                  <ArrowsDownUp size={14} weight="fill" />
                  Schnellwahl
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Offen', value: 100 },
                    { label: 'Halb', value: 50 },
                    { label: 'Geschlossen', value: 0 },
                  ].map(({ label, value }) => (
                    <motion.button
                      key={value}
                      onClick={() => handleQuickPosition(value)}
                      className="py-2.5 rounded-xl text-xs font-semibold transition-colors"
                      style={{
                        backgroundColor:
                          position === value
                            ? `color-mix(in oklch, ${coverColor} 25%, transparent)`
                            : 'oklch(from var(--foreground) l c h / 0.06)',
                        color:
                          position === value
                            ? coverColor
                            : 'oklch(from var(--foreground) l c h / 0.6)',
                        border:
                          position === value
                            ? `1px solid color-mix(in oklch, ${coverColor} 30%, transparent)`
                            : '1px solid oklch(from var(--foreground) l c h / 0.08)',
                      }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      {label}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Action buttons */}
              <div>
                <label className="text-xs font-semibold text-foreground/70 mb-2.5 block">
                  Steuerung
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Öffnen', icon: ArrowUp, action: handleOpen },
                    { label: 'Stopp', icon: Stop, action: handleStop },
                    { label: 'Schließen', icon: ArrowDown, action: handleClose },
                  ].map(({ label, icon: Icon, action }) => (
                    <motion.button
                      key={label}
                      onClick={action}
                      disabled={isUpdating}
                      className="flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-[11px] font-medium transition-colors"
                      style={{
                        backgroundColor: 'oklch(from var(--foreground) l c h / 0.04)',
                        color: 'oklch(from var(--foreground) l c h / 0.6)',
                        border: '1px solid oklch(from var(--foreground) l c h / 0.06)',
                      }}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                    >
                      <Icon size={18} weight="regular" />
                      {label}
                    </motion.button>
                  ))}
                </div>
              </div>
            </div>
          </div>

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
                <span className="text-foreground/60 font-medium capitalize">
                  {entity.state === 'open' ? 'Offen' : entity.state === 'closed' ? 'Geschlossen' : entity.state}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-foreground/40">Position</span>
                <span className="text-foreground/60 font-medium">{position}%</span>
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
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
