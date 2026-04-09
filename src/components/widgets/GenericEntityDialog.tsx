import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { motion } from 'framer-motion'
import { ClockCounterClockwise } from '@phosphor-icons/react'
import { EntityHistoryPanel } from './EntityHistoryPanel'
import { isIsoDateTime, formatDateTime } from '@/lib/formatValue'
import { getModalSizeClass } from '@/lib/utils'

interface GenericEntityDialogProps {
  entityId: string
  entityName: string
  entityState: string
  unit?: string
  icon?: React.ReactNode
  color?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Extra content to show in the details tab */
  children?: React.ReactNode
  modalSize?: string
}

export function GenericEntityDialog({
  entityId,
  entityName,
  entityState,
  unit,
  icon,
  color = 'oklch(0.65 0.18 250)',
  open,
  onOpenChange,
  children,
  modalSize,
}: GenericEntityDialogProps) {
  const [activeTab, setActiveTab] = useState<'details' | 'history'>('details')

  const displayValue = isIsoDateTime(entityState) ? formatDateTime(entityState) : entityState

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`${getModalSizeClass(modalSize)} glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden`}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{entityName}</DialogTitle>
        </DialogHeader>

        {/* Ambient glow */}
        <motion.div
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
          animate={{ opacity: 0.15, scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
          style={{
            background: `radial-gradient(circle, ${color}, transparent 70%)`,
            filter: 'blur(40px)',
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            {icon && (
              <div
                className="p-2 rounded-xl shrink-0"
                style={{
                  backgroundColor: `color-mix(in oklch, ${color} 25%, transparent)`,
                  color: color,
                }}
              >
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{entityName}</h2>
              <p className="text-xs text-foreground/40 font-mono truncate">{entityId}</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="relative px-5 pb-2">
          <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid oklch(from var(--foreground) l c h / 0.1)' }}>
            <button
              onClick={() => setActiveTab('details')}
              className="flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: activeTab === 'details' ? 'oklch(from var(--foreground) l c h / 0.1)' : 'transparent',
                color: activeTab === 'details' ? 'var(--foreground)' : 'oklch(from var(--foreground) l c h / 0.4)',
              }}
            >
              Details
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

        {activeTab === 'details' ? (
          <div className="relative px-5 pb-5 space-y-4">
            {/* Current state */}
            <motion.div
              className="flex justify-center py-4"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.05 }}
            >
              <div className="text-center">
                <span
                  className={`font-light ${displayValue.length > 15 ? 'text-xl' : displayValue.length > 8 ? 'text-3xl' : 'text-4xl'}`}
                  style={{ color }}
                >
                  {displayValue}
                </span>
                {unit && (
                  <span className="text-xl font-light ml-1" style={{ color }}>
                    {unit}
                  </span>
                )}
              </div>
            </motion.div>

            {/* Extra details from parent widget */}
            {children}
          </div>
        ) : (
          <div className="relative px-5 pb-5">
            <EntityHistoryPanel
              entityId={entityId}
              entityState={entityState}
              unit={unit}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
