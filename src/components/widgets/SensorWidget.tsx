import { useState, useRef, useCallback, memo } from 'react'
import { motion } from 'framer-motion'
import { Thermometer, Drop, Lightning, Gauge, Clock, Calendar } from '@phosphor-icons/react'
import type { SensorEntity } from '@/lib/types'
import { haptics } from '@/lib/haptics'
import { SensorDetailDialog } from './SensorDetailDialog'
import { formatSensorValue, isIsoDateTime, formatDateTime } from '@/lib/formatValue'

interface SensorWidgetProps {
  entity: SensorEntity
  onUpdate?: () => void
  config?: Record<string, unknown>
  widgetSize?: { w: number; h: number }
}

export const SensorWidget = memo(function SensorWidget({ entity, config, widgetSize }: SensorWidgetProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const name = entity.attributes.friendly_name || entity.entity_id
  const value = entity.state
  const unit = entity.attributes.unit_of_measurement || ''
  const deviceClass = entity.attributes.device_class
  const longPressTimerRef = useRef<number | undefined>(undefined)
  const pointerActiveRef = useRef(false)
  const dialogOpenedRef = useRef(false)

  const getIcon = () => {
    if (isIsoDateTime(value)) return <Clock size={20} weight="fill" />
    switch (deviceClass) {
      case 'temperature':
        return <Thermometer size={20} weight="fill" />
      case 'humidity':
        return <Drop size={20} weight="fill" />
      case 'power':
      case 'energy':
        return <Lightning size={20} weight="fill" />
      case 'timestamp':
      case 'date':
        return <Calendar size={20} weight="fill" />
      default:
        return <Gauge size={20} weight="fill" />
    }
  }

  const getColor = () => {
    const normalizedValue = String(value).trim().toLowerCase()

    if (normalizedValue === 'unavailable' || normalizedValue === 'unknown') {
      return 'var(--muted-foreground)'
    }

    if (unit === '%' && !deviceClass) {
      return 'oklch(from var(--foreground) l c h / 0.8)'
    }

    switch (deviceClass) {
      case 'temperature':
        return 'oklch(0.60 0.20 25)'
      case 'humidity':
        return 'oklch(0.60 0.18 210)'
      case 'power':
      case 'energy':
        return 'oklch(0.65 0.20 140)'
      case 'timestamp':
      case 'date':
        return 'oklch(0.60 0.16 250)'
      default:
        return 'oklch(0.65 0.18 250)'
    }
  }

  const color = getColor()
  const isDateValue = isIsoDateTime(value)
  const displayValue = isDateValue ? formatDateTime(value) : value

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== undefined) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = undefined
    }
  }, [])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    pointerActiveRef.current = true
    dialogOpenedRef.current = false
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      dialogOpenedRef.current = true
      haptics.impact('medium')
      setDialogOpen(true)
    }, 500)
  }, [clearLongPressTimer])

  const handlePointerUp = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearLongPressTimer()
  }, [clearLongPressTimer])

  const handlePointerLeave = useCallback(() => {
    if (!pointerActiveRef.current) return
    pointerActiveRef.current = false
    clearLongPressTimer()
  }, [clearLongPressTimer])

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
            <span className="text-sm font-mono ml-2 max-w-[55%] truncate text-right" style={{ color }}>
              {displayValue}{unit && !isDateValue ? ` ${unit}` : ''}
            </span>
          </div>
        </div>
        <SensorDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
      </>
    )
  }

  const sensorW = widgetSize?.w ?? 1
  const sensorH = widgetSize?.h ?? 1
  const isSensorLarge = sensorW >= 2 && sensorH >= 3

  return (
    <>
      <motion.div
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        className="glass-card glass-card-shimmer rounded-2xl theme-transition relative overflow-hidden cursor-pointer select-none touch-none h-full"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{
          type: 'spring',
          stiffness: 400,
          damping: 25,
        }}
      >
        <div className={`relative ${isSensorLarge ? 'p-5 h-full flex flex-col' : 'p-4 sm:p-5'}`}>
          <div className={`flex items-center ${isSensorLarge ? 'gap-3' : 'justify-between'}`}>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div
                className={`icon-container-premium ${isSensorLarge ? 'p-3' : 'p-2.5'} rounded-xl transition-all duration-300`}
                data-active="true"
                style={{
                  backgroundColor: `color-mix(in oklch, ${color} 30%, transparent)`,
                  color: color,
                  boxShadow: `0 4px 20px color-mix(in oklch, ${color} 15%, transparent), 0 0 30px color-mix(in oklch, ${color} 06%, transparent)`,
                }}
              >
                {getIcon()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className={`font-medium ${isSensorLarge ? 'text-base' : 'text-sm'} truncate`}>{name}</h3>
                <p className="text-xs text-muted-foreground">Sensor</p>
              </div>
            </div>
            {!isSensorLarge && (
              <div className="text-right max-w-[55%]">
                <div
                  className={`font-semibold truncate number-display ${
                    displayValue.length > 12 ? 'text-sm' : displayValue.length > 8 ? 'text-lg' : 'text-2xl'
                  } ${isDateValue ? '' : 'font-mono'}`}
                  style={{ color }}
                  title={isDateValue ? value : undefined}
                >
                  {displayValue}
                </div>
                {unit && !isDateValue && (
                  <div className="text-xs text-muted-foreground font-mono truncate">{unit}</div>
                )}
              </div>
            )}
          </div>
          {isSensorLarge && (
            <div className="flex-1 flex flex-col items-center justify-center">
              <div
                className={`font-semibold number-display text-center ${isDateValue ? '' : 'font-mono'}`}
                style={{ color, fontSize: displayValue.length > 12 ? '1.5rem' : displayValue.length > 8 ? '2rem' : '3rem', lineHeight: 1.1 }}
                title={isDateValue ? value : undefined}
              >
                {displayValue}
              </div>
              {unit && !isDateValue && (
                <div className="text-sm text-muted-foreground font-mono mt-1">{unit}</div>
              )}
            </div>
          )}
        </div>
      </motion.div>
      <SensorDetailDialog entity={entity} open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  )
})