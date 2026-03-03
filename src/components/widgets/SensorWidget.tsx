import { motion } from 'framer-motion'
import { Thermometer, Drop, Lightning, Gauge } from '@phosphor-icons/react'
import type { SensorEntity } from '@/lib/types'

interface SensorWidgetProps {
  entity: SensorEntity
  onUpdate?: () => void
}

export function SensorWidget({ entity }: SensorWidgetProps) {
  const name = entity.attributes.friendly_name || entity.entity_id
  const value = entity.state
  const unit = entity.attributes.unit_of_measurement || ''
  const deviceClass = entity.attributes.device_class

  const getIcon = () => {
    switch (deviceClass) {
      case 'temperature':
        return <Thermometer size={20} weight="fill" />
      case 'humidity':
        return <Drop size={20} weight="fill" />
      case 'power':
      case 'energy':
        return <Lightning size={20} weight="fill" />
      default:
        return <Gauge size={20} weight="fill" />
    }
  }

  const getColor = () => {
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

  const color = getColor()

  return (
    <motion.div
      className="glass-card rounded-2xl theme-transition relative overflow-hidden"
      whileHover={{ scale: 1.02 }}
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
              className={`p-2.5 rounded-xl transition-all duration-300`}
              style={{
                backgroundColor: `color-mix(in oklch, ${color} 30%, transparent)`,
                color: color,
                boxShadow: `0 4px 20px color-mix(in oklch, ${color} 15%, transparent)`,
              }}
            >
              {getIcon()}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-medium text-sm truncate">{name}</h3>
              <p className="text-xs text-muted-foreground">Sensor</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-semibold font-mono" style={{ color }}>
              {value}
            </div>
            <div className="text-xs text-muted-foreground font-mono">{unit}</div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
