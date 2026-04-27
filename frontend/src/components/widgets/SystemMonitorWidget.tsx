import { useState, useEffect, useCallback } from 'react'
import { Cpu, WifiHigh, Memory, HardDrive } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'

interface SystemHealth {
  status: string
  ha_connected: boolean
  ha_ws_connected: boolean
  connected_clients: number
  entity_count: number
  cache_metrics: {
    update_count: number
    last_update_ms: number
    cache_hits: number
    cache_misses: number
  }
  version: string
}

export default function SystemMonitorWidget({ config }: { config?: Record<string, unknown> }) {
  const { entities } = useEntityStore()
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const showCpu = (config?.showCpu ?? true) as boolean
  const showMemory = (config?.showMemory ?? true) as boolean
  const showDisk = (config?.showDisk ?? true) as boolean
  const showCache = (config?.showCache ?? true) as boolean
  const refreshInterval = ((config?.refreshInterval as number) || 15) * 1000

  const fetchHealth = useCallback(async () => {
    try {
      const r = await fetch('/health')
      if (r.ok) setHealth(await r.json())
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    fetchHealth()
    const interval = setInterval(fetchHealth, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchHealth, refreshInterval])

  // Find system-related sensors (CPU, memory, disk)
  const cpuSensor = entities.find(
    e => e.entity_id.includes('processor') || e.entity_id.includes('cpu')
  )
  const memorySensor = entities.find(
    e => e.entity_id.includes('memory') && e.attributes?.unit_of_measurement === '%'
  )
  const diskSensor = entities.find(
    e => e.entity_id.includes('disk') && e.attributes?.unit_of_measurement === '%'
  )

  const cacheHitRate = health?.cache_metrics
    ? (
        (health.cache_metrics.cache_hits /
          Math.max(health.cache_metrics.cache_hits + health.cache_metrics.cache_misses, 1)) *
        100
      ).toFixed(1)
    : '0'

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-white/80">
          <Cpu size={16} className="text-purple-400" />
          <span>Systemmonitor</span>
        </div>
        <div
          className={`w-2 h-2 rounded-full ${
            health?.ha_ws_connected ? 'bg-green-400' : 'bg-red-400'
          }`}
          title={health?.ha_ws_connected ? 'WebSocket verbunden' : 'WebSocket getrennt'}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {/* HA Connection */}
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-[10px] text-white/50 flex items-center gap-1">
            <WifiHigh size={10} />
            HA Status
          </div>
          <div className={`text-sm font-bold ${health?.ha_connected ? 'text-green-400' : 'text-red-400'}`}>
            {health?.ha_connected ? 'Verbunden' : 'Getrennt'}
          </div>
        </div>

        {/* Clients */}
        <div className="bg-white/5 rounded-lg p-2">
          <div className="text-[10px] text-white/50">Clients</div>
          <div className="text-sm font-bold text-white/90">{health?.connected_clients ?? 0}</div>
        </div>

        {/* CPU */}
        {showCpu && (
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-[10px] text-white/50 flex items-center gap-1">
              <Cpu size={10} />
              CPU
            </div>
            <div className="text-sm font-bold text-white/90">
              {cpuSensor ? `${parseFloat(cpuSensor.state).toFixed(0)}%` : '–'}
            </div>
          </div>
        )}

        {/* Memory */}
        {showMemory && (
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-[10px] text-white/50 flex items-center gap-1">
              <Memory size={10} />
              RAM
            </div>
            <div className="text-sm font-bold text-white/90">
              {memorySensor ? `${parseFloat(memorySensor.state).toFixed(0)}%` : '–'}
            </div>
          </div>
        )}

        {/* Disk */}
        {showDisk && (
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-[10px] text-white/50 flex items-center gap-1">
              <HardDrive size={10} />
              Disk
            </div>
            <div className="text-sm font-bold text-white/90">
              {diskSensor ? `${parseFloat(diskSensor.state).toFixed(0)}%` : '–'}
            </div>
          </div>
        )}

        {/* Cache */}
        {showCache && (
          <div className="bg-white/5 rounded-lg p-2">
            <div className="text-[10px] text-white/50">Cache Hit</div>
            <div className="text-sm font-bold text-white/90">{cacheHitRate}%</div>
          </div>
        )}
      </div>

      <div className="flex justify-between text-[9px] text-white/30">
        <span>Entities: {health?.entity_count ?? 0}</span>
        <span>v{health?.version ?? '?'}</span>
        <span>Latenz: {health?.cache_metrics?.last_update_ms ?? 0}ms</span>
      </div>
    </div>
  )
}
