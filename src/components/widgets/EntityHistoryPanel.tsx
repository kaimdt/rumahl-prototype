import { useState, useEffect, useCallback } from 'react'
import { haService, type HistoryEntry } from '@/lib/homeAssistant'
import { MiniChart, StateTimeline, getStateColor } from '@/components/ui/mini-chart'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ArrowsOut, CalendarBlank } from '@phosphor-icons/react'

interface EntityHistoryPanelProps {
  entityId: string
  entityState: string
  unit?: string
  color?: string
}

// ---- In-memory history cache ----
interface CacheEntry {
  data: HistoryEntry[]
  fetchedAt: number
  startTime: string
}

const historyCache = new Map<string, CacheEntry>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

function getCacheKey(entityId: string, startTime: string): string {
  return `${entityId}::${startTime}`
}

function getCached(entityId: string, startTime: string): HistoryEntry[] | null {
  const key = getCacheKey(entityId, startTime)
  const entry = historyCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    historyCache.delete(key)
    return null
  }
  return entry.data
}

function setCache(entityId: string, startTime: string, data: HistoryEntry[]) {
  const key = getCacheKey(entityId, startTime)
  historyCache.set(key, { data, fetchedAt: Date.now(), startTime })
}

// ---- Helpers ----

function formatDateTimeFull(dateString: string): string {
  const d = new Date(dateString)
  const date = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return `${date}, ${time}`
}

function formatRelativeShort(dateString: string): string {
  const now = Date.now()
  const then = new Date(dateString).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffH / 24)

  if (diffMin < 1) return 'vor <1 min'
  if (diffMin < 60) return `vor ${diffMin} min`
  if (diffH < 24) return `vor ${diffH} h ${diffMin % 60} min`
  return `vor ${diffDays} T ${diffH % 24} h`
}

function formatState(state: string): string {
  return state.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

function getDotColor(state: string, accentColor?: string): string {
  const lower = state.toLowerCase()
  if (lower === 'on') return 'oklch(0.65 0.20 145)'
  if (lower === 'off') return 'oklch(0.55 0.22 25)'
  const numeric = parseFloat(state)
  if (!isNaN(numeric)) return accentColor || 'oklch(0.65 0.18 250)'
  return 'oklch(from var(--foreground) l c h / 0.25)'
}

function deduplicateEntries(entries: HistoryEntry[]): HistoryEntry[] {
  if (entries.length === 0) return []
  const result: HistoryEntry[] = [entries[0]]
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].state !== entries[i - 1].state) {
      result.push(entries[i])
    }
  }
  return result
}

// ---- Shared data parsing ----

function parseChartData(history: HistoryEntry[]) {
  const chartData = history
    .map((entry) => {
      const val = parseFloat(entry.state)
      if (isNaN(val)) return null
      return { time: new Date(entry.last_changed).getTime(), value: val }
    })
    .filter((d): d is { time: number; value: number } => d !== null)

  return chartData
}

function parseStateTimeline(history: HistoryEntry[]) {
  return history
    .filter(e => e.state !== 'unavailable' && e.state !== 'unknown')
    .map(e => ({ time: new Date(e.last_changed).getTime(), state: e.state }))
}

// ====== Fullscreen History Dialog ======

interface HistoryFullDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entityId: string
  entityName: string
  unit?: string
  color?: string
}

function HistoryFullDialog({
  open,
  onOpenChange,
  entityId,
  entityName,
  unit,
  color,
}: HistoryFullDialogProps) {
  const accentColor = color || 'oklch(0.65 0.18 250)'

  // Date range state
  const now = new Date()
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(now.getTime() - 24 * 3600 * 1000)
    return d.toISOString().slice(0, 16) // datetime-local format
  })
  const [endDate, setEndDate] = useState(() => {
    return now.toISOString().slice(0, 16)
  })

  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const fetchData = useCallback(async () => {
    const startISO = new Date(startDate).toISOString()
    const endISO = new Date(endDate).toISOString()

    // Check cache
    const cached = getCached(entityId, startISO)
    if (cached) {
      setHistory(cached)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(false)
    try {
      const data = await haService.getHistory(entityId, startISO, endISO)
      const entries = data?.[0] || []
      setCache(entityId, startISO, entries)
      setHistory(entries)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [entityId, startDate, endDate])

  useEffect(() => {
    if (open) fetchData()
  }, [open, fetchData])

  const chartData = parseChartData(history)
  const hasNumericData = chartData.length >= 2
  const stateTimelineData = !hasNumericData ? parseStateTimeline(history) : []
  const hasStateTimeline = stateTimelineData.length >= 1

  const deduplicated = deduplicateEntries(history)
  const recentChanges = [...deduplicated].reverse()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[600px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-y-auto overflow-x-hidden max-h-[92vh]"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{entityName} Verlauf</DialogTitle>
        </DialogHeader>
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-base font-semibold text-foreground">
            Verlauf — {entityName}
          </h2>
          <p className="text-[11px] text-foreground/40 mt-0.5">{entityId}</p>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Date range picker */}
          <div
            className="rounded-xl p-3"
            style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
          >
            <div className="flex items-center gap-1.5 mb-2.5">
              <CalendarBlank size={14} weight="bold" className="text-foreground/40" />
              <span className="text-xs font-semibold text-foreground/60">Zeitraum</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <label className="text-[10px] text-foreground/40 block mb-1">Von</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs text-foreground/80 border-none outline-none"
                  style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}
                />
              </div>
              <div className="flex-1">
                <label className="text-[10px] text-foreground/40 block mb-1">Bis</label>
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg px-2.5 py-1.5 text-xs text-foreground/80 border-none outline-none"
                  style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}
                />
              </div>
            </div>
            {/* Quick range buttons */}
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {[
                { label: '1 Std', hours: 1 },
                { label: '6 Std', hours: 6 },
                { label: '24 Std', hours: 24 },
                { label: '3 Tage', hours: 72 },
                { label: '7 Tage', hours: 168 },
              ].map(({ label, hours }) => (
                <button
                  key={hours}
                  onClick={() => {
                    const n = new Date()
                    setEndDate(n.toISOString().slice(0, 16))
                    setStartDate(new Date(n.getTime() - hours * 3600 * 1000).toISOString().slice(0, 16))
                  }}
                  className="px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors"
                  style={{
                    background: 'oklch(from var(--foreground) l c h / 0.06)',
                    color: 'oklch(from var(--foreground) l c h / 0.6)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Loading */}
          {loading && (
            <div
              className="rounded-xl p-4 animate-pulse"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <div
                className="h-40 rounded-lg"
                style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}
              />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div
              className="rounded-xl p-4 text-center py-8"
              style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
            >
              <p className="text-xs text-foreground/40">Verlauf konnte nicht geladen werden</p>
            </div>
          )}

          {/* Charts */}
          {!loading && !error && (
            <>
              {/* Numeric chart — taller in full dialog */}
              {hasNumericData && (
                <div
                  className="rounded-xl p-4"
                  style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                >
                  <MiniChart
                    data={chartData}
                    color={accentColor}
                    height={200}
                    unit={unit}
                  />
                </div>
              )}

              {/* State timeline */}
              {hasStateTimeline && !hasNumericData && (
                <div
                  className="rounded-xl p-4"
                  style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                >
                  <StateTimeline data={stateTimelineData} />
                </div>
              )}

              {/* No data */}
              {!hasNumericData && !hasStateTimeline && history.length === 0 && (
                <div
                  className="rounded-xl p-4 text-center py-8"
                  style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
                >
                  <p className="text-xs text-foreground/40">Keine Daten im gewählten Zeitraum</p>
                </div>
              )}

              {/* All state changes — no limit, no animation */}
              <div
                className="rounded-xl p-3"
                style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
              >
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-semibold text-foreground/60">
                    Alle Änderungen
                  </span>
                  <span className="text-[10px] text-foreground/30">
                    {recentChanges.length} Einträge
                  </span>
                </div>

                {recentChanges.length === 0 ? (
                  <p className="text-[11px] text-foreground/30 text-center py-3">
                    Keine Änderungen im gewählten Zeitraum
                  </p>
                ) : (
                  <div className="max-h-80 overflow-y-auto space-y-0.5" style={{ willChange: 'scroll-position' }}>
                    {recentChanges.map((entry, index) => (
                      <div
                        key={`${entry.last_changed}-${index}`}
                        className="flex items-center gap-2.5 py-1.5 px-1"
                      >
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: getDotColor(entry.state, accentColor) }}
                        />
                        <span className="text-[11px] text-foreground/60 font-medium truncate" style={{ minWidth: 0, flex: '1 1 0%' }}>
                          {formatState(entry.state)}
                          {unit && !isNaN(parseFloat(entry.state)) ? ` ${unit}` : ''}
                        </span>
                        <div className="shrink-0 text-right">
                          <span className="text-[11px] text-foreground/50 block">
                            {formatDateTimeFull(entry.last_changed)}
                          </span>
                          <span className="text-[10px] text-foreground/30 block">
                            ({formatRelativeShort(entry.last_changed)})
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ====== Main Panel ======

export function EntityHistoryPanel({
  entityId,
  entityState,
  unit,
  color,
}: EntityHistoryPanelProps) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [fullDialogOpen, setFullDialogOpen] = useState(false)

  const fetchHistory = useCallback(async () => {
    const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Check cache first
    const cached = getCached(entityId, startTime)
    if (cached) {
      setHistory(cached)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(false)
    try {
      const data = await haService.getHistory(entityId, startTime)
      const entries = data?.[0] || []
      setCache(entityId, startTime, entries)
      setHistory(entries)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [entityId])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const chartData = parseChartData(history)
  const hasNumericData = chartData.length >= 2

  const stateTimelineData = !hasNumericData ? parseStateTimeline(history) : []
  const hasStateTimeline = stateTimelineData.length >= 1

  const deduplicated = deduplicateEntries(history)
  const recentChanges = [...deduplicated].reverse().slice(0, 10)

  const accentColor = color || 'oklch(0.65 0.18 250)'

  // Derive friendly name from entityId for fullscreen dialog header
  const entityName = entityId.split('.').slice(1).join('.').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())

  if (loading) {
    return (
      <div className="space-y-4 py-4">
        <div
          className="rounded-xl p-4 animate-pulse"
          style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
        >
          <div
            className="h-36 rounded-lg"
            style={{ background: 'oklch(from var(--foreground) l c h / 0.06)' }}
          />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="rounded-xl p-4 text-center py-8"
        style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
      >
        <p className="text-xs text-foreground/40">
          Verlauf konnte nicht geladen werden
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Numeric area chart */}
      {hasNumericData && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-foreground/40">
              Letzte 24 Stunden
            </span>
            <span className="text-xs font-medium text-foreground/60">
              {entityState}{unit ? ` ${unit}` : ''}
            </span>
          </div>
          <MiniChart
            data={chartData}
            color={accentColor}
            height={150}
            unit={unit}
          />
        </div>
      )}

      {/* State timeline bar */}
      {hasStateTimeline && !hasNumericData && (
        <div
          className="rounded-xl p-4"
          style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-foreground/40">
              Letzte 24 Stunden
            </span>
            <span className="text-xs font-medium text-foreground/60 capitalize">
              {formatState(entityState)}
            </span>
          </div>
          <StateTimeline data={stateTimelineData} />
        </div>
      )}

      {/* Recent State Changes — no framer-motion per item to avoid lag */}
      <div
        className="rounded-xl p-3"
        style={{ background: 'oklch(from var(--foreground) l c h / 0.04)' }}
      >
        <span className="text-xs font-medium text-foreground/40 block mb-2.5">
          Letzte Änderungen
        </span>

        {recentChanges.length === 0 ? (
          <p className="text-[11px] text-foreground/30 text-center py-3">
            Keine Änderungen in den letzten 24 Stunden
          </p>
        ) : (
          <div className="max-h-52 overflow-y-auto space-y-0.5" style={{ willChange: 'scroll-position' }}>
            {recentChanges.map((entry, index) => (
              <div
                key={`${entry.last_changed}-${index}`}
                className="flex items-center gap-2.5 py-1.5 px-1"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getDotColor(entry.state, accentColor) }}
                />
                <span className="text-[11px] text-foreground/60 font-medium truncate" style={{ minWidth: 0, flex: '1 1 0%' }}>
                  {formatState(entry.state)}
                  {unit && !isNaN(parseFloat(entry.state)) ? ` ${unit}` : ''}
                </span>
                <div className="shrink-0 text-right">
                  <span className="text-[11px] text-foreground/50">
                    {formatDateTimeFull(entry.last_changed)}
                  </span>
                  <span className="text-[10px] text-foreground/30 ml-1">
                    ({formatRelativeShort(entry.last_changed)})
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* "Mehr anzeigen" button */}
      <button
        onClick={() => setFullDialogOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-medium transition-colors"
        style={{
          background: 'oklch(from var(--foreground) l c h / 0.04)',
          color: 'oklch(from var(--foreground) l c h / 0.5)',
        }}
      >
        <ArrowsOut size={14} weight="bold" />
        Mehr anzeigen
      </button>

      {/* Fullscreen Dialog */}
      <HistoryFullDialog
        open={fullDialogOpen}
        onOpenChange={setFullDialogOpen}
        entityId={entityId}
        entityName={entityName}
        unit={unit}
        color={color}
      />
    </div>
  )
}
