import { useState, useEffect } from 'react'
import { BatteryCharging, Lightning, SunDim } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'

interface EnergyData {
  total_entities: number
  entities_by_domain: Record<string, number>
  history_entries_24h: number
  most_active_entities: Array<{ entity_id: string; change_count: number }>
}

export default function EnergyMonitorWidget({ config }: { config?: Record<string, unknown> }) {
  const { entities } = useEntityStore()
  const [stats, setStats] = useState<EnergyData | null>(null)
  const variant = (config?.variant as string) || 'overview'

  // Find energy-related sensors
  const energySensors = entities.filter(e => {
    const unit = e.attributes?.unit_of_measurement
    return unit === 'kWh' || unit === 'W' || unit === 'Wh'
  })

  const totalPowerW = energySensors
    .filter(e => e.attributes?.unit_of_measurement === 'W')
    .reduce((sum, e) => sum + (parseFloat(e.state) || 0), 0)

  const totalEnergyKwh = energySensors
    .filter(e => e.attributes?.unit_of_measurement === 'kWh')
    .reduce((sum, e) => sum + (parseFloat(e.state) || 0), 0)

  // Solar sensors (common naming patterns)
  const solarSensors = energySensors.filter(e =>
    e.entity_id.includes('solar') ||
    e.entity_id.includes('pv') ||
    e.entity_id.includes('photovoltaic') ||
    (e.attributes?.friendly_name as string)?.toLowerCase().includes('solar')
  )

  const solarPowerW = solarSensors
    .filter(e => e.attributes?.unit_of_measurement === 'W')
    .reduce((sum, e) => sum + (parseFloat(e.state) || 0), 0)

  useEffect(() => {
    fetch('/api/stats/dashboard')
      .then(r => r.ok ? r.json() : null)
      .then(data => data && setStats(data))
      .catch(() => {})
  }, [])

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <BatteryCharging size={16} weight="fill" className="text-green-400" />
        <span>Energie-Monitor</span>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* Current power consumption */}
        <div className="bg-white/5 rounded-lg p-2 flex flex-col justify-center">
          <div className="text-[10px] text-white/50 flex items-center gap-1">
            <Lightning size={10} />
            Aktueller Verbrauch
          </div>
          <div className="text-lg font-bold text-white/90">
            {totalPowerW.toFixed(0)}
            <span className="text-xs font-normal text-white/50 ml-1">W</span>
          </div>
        </div>

        {/* Total energy */}
        <div className="bg-white/5 rounded-lg p-2 flex flex-col justify-center">
          <div className="text-[10px] text-white/50 flex items-center gap-1">
            <BatteryCharging size={10} />
            Gesamt
          </div>
          <div className="text-lg font-bold text-white/90">
            {totalEnergyKwh.toFixed(1)}
            <span className="text-xs font-normal text-white/50 ml-1">kWh</span>
          </div>
        </div>

        {variant === 'detailed' && (
          <>
            {/* Solar production */}
            {config?.showSolar !== false && (
            <div className="bg-white/5 rounded-lg p-2 flex flex-col justify-center">
              <div className="text-[10px] text-white/50 flex items-center gap-1">
                <SunDim size={10} />
                Solar
              </div>
              <div className="text-lg font-bold text-yellow-400/90">
                {solarPowerW.toFixed(0)}
                <span className="text-xs font-normal text-white/50 ml-1">W</span>
              </div>
            </div>
            )}

            {/* Active sensors count */}
            <div className="bg-white/5 rounded-lg p-2 flex flex-col justify-center">
              <div className="text-[10px] text-white/50">Sensoren</div>
              <div className="text-lg font-bold text-white/90">
                {energySensors.length}
              </div>
            </div>
          </>
        )}
      </div>

      {stats && variant === 'detailed' && stats.most_active_entities.length > 0 && (
        <div className="text-[10px] text-white/40">
          Aktivste: {stats.most_active_entities[0]?.entity_id.split('.')[1]?.replace(/_/g, ' ')}
          {' '}({stats.most_active_entities[0]?.change_count} Änderungen/24h)
        </div>
      )}
    </div>
  )
}
