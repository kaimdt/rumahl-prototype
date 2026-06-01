import { useState, useEffect } from 'react'
import { ChartBar } from '@phosphor-icons/react'
import { useEntityStore } from '@/hooks/useEntityStore'

interface StatData {
  entity_id: string
  total_changes: number
  first_seen: string | null
  last_seen: string | null
  state_distribution: Array<{ state: string; count: number }>
  avg_changes_per_hour: number
}

export default function EntityStatisticsWidget({
  entityId,
}: {
  entityId?: string
  config?: Record<string, unknown>
}) {
  const { getEntity } = useEntityStore()
  const [stats, setStats] = useState<StatData | null>(null)
  const [loading, setLoading] = useState(true)
  const entity = entityId ? getEntity(entityId) : undefined
  const friendlyName = (entity?.attributes?.friendly_name as string) || entityId || 'Unbekannt'

  useEffect(() => {
    if (!entityId) return

    fetch(`/api/stats/entity-history/${entityId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => data && setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [entityId])

  const maxCount = stats
    ? Math.max(...stats.state_distribution.map(s => s.count), 1)
    : 1

  return (
    <div className="flex flex-col gap-2 p-3 h-full">
      <div className="flex items-center gap-2 text-xs text-white/70">
        <ChartBar size={14} />
        <span className="truncate">{friendlyName}</span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Lade Statistiken...
        </div>
      ) : !stats ? (
        <div className="flex-1 flex items-center justify-center text-white/40 text-xs">
          Keine Daten verfügbar
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-[10px] text-white/50">Änderungen</div>
              <div className="text-sm font-bold text-white/90">{stats.total_changes}</div>
            </div>
            <div className="bg-white/5 rounded-lg p-2">
              <div className="text-[10px] text-white/50">Ø/Stunde</div>
              <div className="text-sm font-bold text-white/90">
                {stats.avg_changes_per_hour.toFixed(1)}
              </div>
            </div>
          </div>

          {/* State distribution bars */}
          <div className="flex-1 flex flex-col gap-1 overflow-auto">
            <div className="text-[10px] text-white/50 mb-0.5">Status-Verteilung</div>
            {stats.state_distribution.slice(0, 5).map(s => (
              <div key={s.state} className="flex items-center gap-2 text-[10px]">
                <span className="text-white/60 w-16 truncate">{s.state}</span>
                <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-400/60 rounded-full transition-all"
                    style={{ width: `${(s.count / maxCount) * 100}%` }}
                  />
                </div>
                <span className="text-white/40 w-8 text-right">{s.count}</span>
              </div>
            ))}
          </div>

          {stats.last_seen && (
            <div className="text-[9px] text-white/30">
              Letzte Änderung: {new Date(stats.last_seen).toLocaleString('de-DE')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
