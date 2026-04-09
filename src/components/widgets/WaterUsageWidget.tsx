import { WaveSawtooth, Drop, TrendUp, TrendDown } from '@phosphor-icons/react'
import { useState, useEffect } from 'react'
import { useEntityStore } from '@/hooks/useEntityStore'

export default function WaterUsageWidget() {
  const { entities } = useEntityStore()
  const [history, setHistory] = useState<{ time: string; value: number }[]>([])

  // Find water-related sensors
  const waterEntities = entities.filter(e => {
    const unit = ((e.attributes?.unit_of_measurement as string) || '').toLowerCase()
    const id = e.entity_id.toLowerCase()
    const name = ((e.attributes?.friendly_name as string) || '').toLowerCase()
    return (
      unit.includes('l') ||
      unit.includes('gal') ||
      unit.includes('m³') ||
      id.includes('water') ||
      name.includes('wasser') ||
      name.includes('water')
    )
  })

  const totalSensor = waterEntities.find(e => {
    const cls = (e.attributes?.device_class as string) || ''
    return cls === 'water' || e.attributes?.state_class === 'total_increasing'
  })

  const flowSensors = waterEntities.filter(e => {
    const unit = ((e.attributes?.unit_of_measurement as string) || '').toLowerCase()
    return unit.includes('l/min') || unit.includes('gpm')
  })

  const currentFlow = flowSensors.length > 0
    ? flowSensors.reduce((sum, e) => sum + (parseFloat(e.state) || 0), 0)
    : null

  const totalUsage = totalSensor ? parseFloat(totalSensor.state) || 0 : null
  const totalUnit = (totalSensor?.attributes?.unit_of_measurement as string) || 'L'

  // Fetch history for trend
  useEffect(() => {
    if (!totalSensor) return
    
    const fetchHistory = async () => {
      try {
        const response = await fetch(`/api/local-history/${encodeURIComponent(totalSensor.entity_id)}`)
        if (response.ok) {
          const data = await response.json()
          if (Array.isArray(data)) {
            setHistory(data.slice(-24).map((d: { timestamp: string; state: string }) => ({
              time: new Date(d.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
              value: parseFloat(d.state) || 0,
            })))
          }
        }
      } catch {
        // Silently fail
      }
    }

    fetchHistory()
    const interval = setInterval(fetchHistory, 300_000)
    return () => clearInterval(interval)
  }, [totalSensor?.entity_id])

  const trend = history.length >= 2
    ? history[history.length - 1].value - history[history.length - 2].value
    : null

  // Simple bar chart
  const maxVal = history.length > 0 ? Math.max(...history.map(h => h.value), 1) : 1
  const minVal = history.length > 0 ? Math.min(...history.map(h => h.value)) : 0
  const range = maxVal - minVal || 1

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
        <WaveSawtooth size={16} className="text-cyan-400" />
        <span>Wasserverbrauch</span>
      </div>

      <div className="flex items-end gap-3">
        {totalUsage !== null && (
          <div>
            <div className="text-2xl font-bold text-white/90">{totalUsage.toFixed(1)}</div>
            <div className="text-[10px] text-white/40">{totalUnit} gesamt</div>
          </div>
        )}

        {currentFlow !== null && (
          <div>
            <div className="text-lg font-semibold text-cyan-400">{currentFlow.toFixed(1)}</div>
            <div className="text-[10px] text-white/40">L/min aktuell</div>
          </div>
        )}

        {trend !== null && (
          <div className="flex items-center gap-0.5 ml-auto">
            {trend > 0 ? (
              <TrendUp size={14} className="text-red-400" />
            ) : (
              <TrendDown size={14} className="text-green-400" />
            )}
            <span className={`text-[10px] ${trend > 0 ? 'text-red-400' : 'text-green-400'}`}>
              {Math.abs(trend).toFixed(1)} {totalUnit}
            </span>
          </div>
        )}
      </div>

      {/* Mini bar chart */}
      {history.length > 0 && (
        <div className="flex-1 flex items-end gap-px min-h-[40px]">
          {history.map((h, i) => (
            <div
              key={i}
              className="flex-1 bg-cyan-400/30 rounded-t-sm hover:bg-cyan-400/50 transition-colors"
              style={{ height: `${Math.max(4, ((h.value - minVal) / range) * 100)}%` }}
              title={`${h.time}: ${h.value.toFixed(1)} ${totalUnit}`}
            />
          ))}
        </div>
      )}

      {/* Individual sensors */}
      {waterEntities.length > 1 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {waterEntities.slice(0, 6).map(entity => (
            <div key={entity.entity_id} className="flex items-center gap-1 px-1.5 py-0.5 bg-white/5 rounded text-[10px]">
              <Drop size={10} className="text-cyan-400" />
              <span className="text-white/60 truncate max-w-[70px]">
                {((entity.attributes?.friendly_name as string) || '').replace(/wasser|water/gi, '').trim() || entity.entity_id.split('.')[1]}
              </span>
              <span className="text-white/40">{entity.state}{(entity.attributes?.unit_of_measurement as string) || ''}</span>
            </div>
          ))}
        </div>
      )}

      {waterEntities.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center text-white/40 text-xs gap-1">
          <Drop size={24} className="text-white/20" />
          <span>Keine Wassersensoren gefunden</span>
        </div>
      )}
    </div>
  )
}
