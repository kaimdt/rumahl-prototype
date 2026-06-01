import { useState, useEffect, useMemo } from 'react'
import { ChartLine, ChartBar, TrendUp, TrendDown, Minus } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  BarChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { getBackendUrl } from '@/lib/config'

const apiBase = () => getBackendUrl() || ''

interface StatisticsChartWidgetProps {
  entityId?: string
  config?: Record<string, unknown>
}

interface HistoryPoint {
  state: string
  recorded_at: string
}

type ChartVariant = 'line' | 'area' | 'bar'
type TimeRange = '1h' | '6h' | '12h' | '24h' | '48h' | '7d'

const TIME_RANGES: { value: TimeRange; label: string; ms: number }[] = [
  { value: '1h', label: '1h', ms: 3600000 },
  { value: '6h', label: '6h', ms: 21600000 },
  { value: '12h', label: '12h', ms: 43200000 },
  { value: '24h', label: '24h', ms: 86400000 },
  { value: '48h', label: '48h', ms: 172800000 },
  { value: '7d', label: '7T', ms: 604800000 },
]

export default function StatisticsChartWidget({ entityId, config }: StatisticsChartWidgetProps) {
  const { entities } = useEntityStore()
  const [history, setHistory] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const entity = entityId ? entities.find(e => e.entity_id === entityId) : undefined
  
  const variant = (config?.chartVariant as ChartVariant) || (config?.variant as ChartVariant) || 'area'
  const defaultRange = (config?.timeRange as TimeRange) || '24h'
  const showGrid = config?.showGrid !== false
  const showAxis = config?.showAxis !== false
  const showStats = config?.showStats !== false
  const chartColor = (config?.chartColor as string) || '#3b82f6'

  const [timeRange, setTimeRange] = useState<TimeRange>(defaultRange)

  const rangeMs = TIME_RANGES.find(r => r.value === timeRange)?.ms ?? 86400000

  useEffect(() => {
    if (!entityId) return

    const fetchHistory = async () => {
      setLoading(true)
      try {
        const end = new Date().toISOString()
        const start = new Date(Date.now() - rangeMs).toISOString()
        const response = await fetch(
          `${apiBase()}/api/local-history/${entityId}?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
        )
        if (response.ok) {
          setHistory(await response.json())
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
    const interval = setInterval(fetchHistory, 60000)
    return () => clearInterval(interval)
  }, [entityId, rangeMs])

  const friendlyName = (entity?.attributes?.friendly_name as string) || entityId || 'Unbekannt'
  const unit = (entity?.attributes?.unit_of_measurement as string) || ''

  const chartData = useMemo(() => {
    return history
      .map(h => {
        const value = parseFloat(h.state)
        if (isNaN(value)) return null
        return {
          value,
          time: new Date(h.recorded_at).getTime(),
          label: new Date(h.recorded_at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
        }
      })
      .filter(Boolean) as { value: number; time: number; label: string }[]
  }, [history])

  // Downsample if too many points for smooth rendering
  const displayData = useMemo(() => {
    const maxPoints = 150
    if (chartData.length <= maxPoints) return chartData
    const step = Math.ceil(chartData.length / maxPoints)
    return chartData.filter((_, i) => i % step === 0 || i === chartData.length - 1)
  }, [chartData])

  // Statistics
  const stats = useMemo(() => {
    if (chartData.length === 0) return null
    const values = chartData.map(d => d.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const avg = values.reduce((a, b) => a + b, 0) / values.length
    const current = values[values.length - 1]
    const first = values[0]
    const trend = current - first
    return { min, max, avg, current, trend, count: values.length }
  }, [chartData])

  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ value: number; payload: { label: string } }> }) => {
    if (!active || !payload?.length) return null
    return (
      <div className="px-2.5 py-1.5 rounded-lg bg-black/80 backdrop-blur-sm border border-white/10 text-[11px]">
        <p className="text-white/60">{payload[0].payload.label}</p>
        <p className="font-semibold text-white">{payload[0].value.toFixed(1)} {unit}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 h-full min-h-[180px]">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-white/70">
          <ChartLine size={14} />
          <span className="truncate">{friendlyName}</span>
        </div>
        {stats && (
          <div className="flex items-center gap-1 text-xs">
            {stats.trend > 0 ? (
              <TrendUp size={12} className="text-emerald-400" />
            ) : stats.trend < 0 ? (
              <TrendDown size={12} className="text-red-400" />
            ) : (
              <Minus size={12} className="text-white/40" />
            )}
            <span className={`font-medium ${stats.trend > 0 ? 'text-emerald-400' : stats.trend < 0 ? 'text-red-400' : 'text-white/40'}`}>
              {stats.trend > 0 ? '+' : ''}{stats.trend.toFixed(1)}
            </span>
          </div>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-1">
        {TIME_RANGES.map(r => (
          <button
            key={r.value}
            onClick={() => setTimeRange(r.value)}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-all ${
              timeRange === r.value
                ? 'bg-white/15 text-white'
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Chart */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Lade Verlauf...
        </div>
      ) : displayData.length < 2 ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Nicht genug Daten
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            {variant === 'bar' ? (
              <BarChart data={displayData} margin={{ top: 4, right: 4, bottom: 0, left: showAxis ? 0 : -20 }}>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />}
                {showAxis && <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />}
                {showAxis && <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} width={35} />}
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.05)' }} />
                <Bar dataKey="value" fill={chartColor} radius={[2, 2, 0, 0]} opacity={0.7} />
              </BarChart>
            ) : variant === 'line' ? (
              <LineChart data={displayData} margin={{ top: 4, right: 4, bottom: 0, left: showAxis ? 0 : -20 }}>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />}
                {showAxis && <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />}
                {showAxis && <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} width={35} />}
                <Tooltip content={<CustomTooltip />} />
                <Line type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} dot={false} />
              </LineChart>
            ) : (
              <AreaChart data={displayData} margin={{ top: 4, right: 4, bottom: 0, left: showAxis ? 0 : -20 }}>
                <defs>
                  <linearGradient id={`gradient-${entityId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={chartColor} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />}
                {showAxis && <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />}
                {showAxis && <YAxis tick={{ fontSize: 9, fill: 'rgba(255,255,255,0.3)' }} tickLine={false} axisLine={false} width={35} />}
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="value" stroke={chartColor} strokeWidth={2} fill={`url(#gradient-${entityId})`} />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {/* Statistics Footer */}
      {showStats && stats && (
        <div className="grid grid-cols-4 gap-1 text-center">
          <div>
            <p className="text-[8px] text-white/30 uppercase">Min</p>
            <p className="text-[10px] font-semibold text-white/70 tabular-nums">{stats.min.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-[8px] text-white/30 uppercase">Max</p>
            <p className="text-[10px] font-semibold text-white/70 tabular-nums">{stats.max.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-[8px] text-white/30 uppercase">Ø</p>
            <p className="text-[10px] font-semibold text-white/70 tabular-nums">{stats.avg.toFixed(1)}</p>
          </div>
          <div>
            <p className="text-[8px] text-white/30 uppercase">Aktuell</p>
            <p className="text-[10px] font-semibold text-white tabular-nums">{stats.current.toFixed(1)}{unit && <span className="text-white/40 ml-0.5">{unit}</span>}</p>
          </div>
        </div>
      )}
    </div>
  )
}
