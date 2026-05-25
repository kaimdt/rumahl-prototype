import { useState, useEffect } from 'react'
import { ChartLine } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'

interface EntityHistoryWidgetProps {
  entityId?: string
  config?: Record<string, unknown>
}

interface HistoryPoint {
  state: string
  recorded_at: string
}

export default function EntityHistoryWidget({ entityId, config }: EntityHistoryWidgetProps) {
  const { getEntity } = useEntityStore()
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  // ⚡ Bolt Optimization: Use O(1) getEntity instead of O(N) entities.find()
  const entity = entityId ? getEntity(entityId) : undefined
  const variant = (config?.variant as string) || 'line'

  useEffect(() => {
    if (!entityId) return

    const fetchHistory = async () => {
      try {
        const end = new Date().toISOString()
        const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        const response = await fetch(
          `/api/local-history/${entityId}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        )
        if (response.ok) {
          const data = await response.json()
          setHistory(data)
        }
      } catch {
        // Silently fail for history charts
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
    const interval = setInterval(fetchHistory, 60000) // Refresh every minute
    return () => clearInterval(interval)
  }, [entityId])

  const friendlyName = (entity?.attributes?.friendly_name as string) || entityId || 'Unbekannt'
  const numericHistory = history
    .map(h => ({
      value: parseFloat(h.state),
      time: new Date(h.recorded_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    }))
    .filter(h => !isNaN(h.value))

  // Calculate min/max for scaling
  const values = numericHistory.map(h => h.value)
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 100
  const range = max - min || 1

  // Create SVG path for sparkline
  const width = 280
  const height = 60
  const points = numericHistory.map((h, i) => {
    const x = (i / Math.max(numericHistory.length - 1, 1)) * width
    const y = height - ((h.value - min) / range) * height
    return `${x},${y}`
  })

  const linePath = points.length > 1 ? `M ${points.join(' L ')}` : ''
  const areaPath = linePath ? `${linePath} L ${width},${height} L 0,${height} Z` : ''

  return (
    <div className="flex flex-col gap-1 p-3 h-full">
      <div className="flex items-center gap-2 text-xs text-white/70">
        <ChartLine size={14} />
        <span className="truncate">{friendlyName}</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Lade Verlauf...
        </div>
      ) : numericHistory.length < 2 ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Nicht genug Daten
        </div>
      ) : (
        <div className="flex-1 relative">
          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full" preserveAspectRatio="none">
            {(variant === 'area') && (
              <path d={areaPath} fill="rgba(59, 130, 246, 0.2)" />
            )}
            {(variant === 'bar') ? (
              numericHistory.map((h, i) => {
                const barW = width / numericHistory.length * 0.7
                const barH = ((h.value - min) / range) * height
                const x = (i / numericHistory.length) * width + barW * 0.15
                return (
                  <rect
                    key={i}
                    x={x}
                    y={height - barH}
                    width={barW}
                    height={barH}
                    fill="rgba(59, 130, 246, 0.6)"
                    rx={1}
                  />
                )
              })
            ) : (
              <path
                d={linePath}
                fill="none"
                stroke="rgba(59, 130, 246, 0.8)"
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <div className="absolute bottom-0 left-0 right-0 flex justify-between text-[9px] text-white/40">
            <span>{numericHistory[0]?.time}</span>
            <span>{numericHistory[numericHistory.length - 1]?.time}</span>
          </div>
        </div>
      )}

      {(config?.showCurrentValue !== false) && entity && (
        <div className="text-right text-sm font-medium text-white/90">
          {entity.state} {(entity.attributes?.unit_of_measurement as string) || ''}
        </div>
      )}
    </div>
  )
}
