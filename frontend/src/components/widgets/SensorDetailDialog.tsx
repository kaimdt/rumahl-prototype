import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Thermometer, Drop, Lightning, Gauge } from '@phosphor-icons/react'
import type { SensorEntity } from '@/lib/types'
import { motion } from 'motion/react'
import { EntityHistoryPanel } from './EntityHistoryPanel'
import { isIsoDateTime, formatDateTime } from '@/lib/formatValue'

interface SensorDetailDialogProps {
  entity: SensorEntity
  open: boolean
  onOpenChange: (open: boolean) => void
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

function getDeviceClassIcon(deviceClass: string | undefined, size = 20) {
  switch (deviceClass) {
    case 'temperature':
      return <Thermometer size={size} weight="fill" />
    case 'humidity':
      return <Drop size={size} weight="fill" />
    case 'power':
    case 'energy':
      return <Lightning size={size} weight="fill" />
    default:
      return <Gauge size={size} weight="fill" />
  }
}

function getDeviceClassColor(deviceClass: string | undefined): string {
  switch (deviceClass) {
    case 'temperature':
      return 'oklch(0.60 0.20 25)'
    case 'humidity':
      return 'oklch(0.60 0.18 210)'
    case 'power':
    case 'energy':
      return 'oklch(0.65 0.20 140)'
    default:
      return 'oklch(0.65 0.18 250)'
  }
}

export function SensorDetailDialog({
  entity,
  open,
  onOpenChange,
}: SensorDetailDialogProps) {
  const [activeTab, setActiveTab] = useState<'controls' | 'history'>('controls')
  const name = entity.attributes.friendly_name || entity.entity_id
  const value = entity.state
  const unit = entity.attributes.unit_of_measurement || ''
  const deviceClass = entity.attributes.device_class
  const color = getDeviceClassColor(deviceClass)

  const otherAttributes = Object.entries(entity.attributes).filter(
    ([key]) => !['friendly_name', 'unit_of_measurement', 'device_class'].includes(key)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[380px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{name} Sensor Details</DialogTitle>
        </DialogHeader>
        {/* Ambient glow */}
        <motion.div
          className="absolute -top-20 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full pointer-events-none"
          animate={{ opacity: 0.2, scale: [1, 1.05, 1] }}
          transition={{ duration: 4, repeat: Infinity, repeatType: 'reverse' }}
          style={{
            background: `radial-gradient(circle, ${color}, transparent 70%)`,
            filter: 'blur(40px)',
          }}
        />

        {/* Header */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <motion.div
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 2.5, repeat: Infinity }}
              className="p-2 rounded-xl shrink-0"
              style={{
                backgroundColor: `color-mix(in oklch, ${color} 25%, transparent)`,
                color: color,
              }}
            >
              {getDeviceClassIcon(deviceClass)}
            </motion.div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground truncate">{name}</h2>
              <p className="text-xs text-foreground/40">Sensor</p>
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

        {activeTab === 'controls' ? (
        <div className="relative px-5 pb-5 space-y-5">
          {/* Large value display */}
          <motion.div
            className="flex justify-center py-6"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.05 }}
          >
            <div className="text-center">
              {isIsoDateTime(value) ? (
                <span
                  className="text-2xl font-light"
                  style={{ color }}
                >
                  {formatDateTime(value)}
                </span>
              ) : (
                <>
                  <span
                    className={`font-light ${value.length > 10 ? 'text-2xl' : 'text-5xl'}`}
                    style={{ color }}
                  >
                    {value}
                  </span>
                  {unit && (
                    <span
                      className="text-2xl font-light ml-1"
                      style={{ color }}
                    >
                      {unit}
                    </span>
                  )}
                </>
              )}
            </div>
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
                <span className="text-foreground/40">Geräte-Klasse</span>
                <span className="text-foreground/60 font-medium capitalize">
                  {deviceClass || '\u2014'}
                </span>
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
            unit={entity.attributes.unit_of_measurement}
          />
        </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
