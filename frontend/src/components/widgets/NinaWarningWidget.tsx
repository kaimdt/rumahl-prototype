import { useState, useEffect, useCallback, useRef } from 'react'
import { motion } from 'motion/react'
import { Warning, MapPin, CaretRight, Circle, ShieldWarning, Info, ArrowsOutSimple } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useLongPressDialog } from '@/hooks/useLongPressDialog'

interface NinaWarning {
  id: string
  headline: string
  description?: string
  severity: string
  level: string
  region: string
  source: string
  event?: string
  sender_name?: string
  effective?: string
  expires?: string
  area_desc?: string
  geocode?: { value: string; name: string }[]
}

interface NinaWarningWidgetConfig {
  title?: string
  showMap?: boolean
  variant?: 'compact' | 'detailed'
  cardVariant?: string
  maxWarnings?: number
  autoRefreshSeconds?: number
  showRegion?: boolean
  showSeverityBadge?: boolean
  [key: string]: unknown
}

interface NinaWarningWidgetProps {
  config?: NinaWarningWidgetConfig
}

const LEVEL_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  critical: { bg: 'bg-red-500/12', border: 'border-red-500/25', text: 'text-red-400', icon: 'text-red-500' },
  emergency: { bg: 'bg-red-600/15', border: 'border-red-600/30', text: 'text-red-400', icon: 'text-red-600' },
  warning: { bg: 'bg-orange-500/12', border: 'border-orange-500/25', text: 'text-orange-400', icon: 'text-orange-500' },
  info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', icon: 'text-blue-500' },
}

const LEVEL_LABELS: Record<string, string> = {
  critical: 'Extreme Gefahr',
  emergency: 'Notfall',
  warning: 'Warnung',
  info: 'Information',
}

export default function NinaWarningWidget({ config }: NinaWarningWidgetProps) {
  const [warnings, setWarnings] = useState<NinaWarning[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedWarning, setSelectedWarning] = useState<NinaWarning | null>(null)
  const showMap = config?.showMap !== false
  const variant = (config?.variant || config?.cardVariant || 'detailed') as 'compact' | 'detailed'
  const maxWarnings = config?.maxWarnings ?? 10
  const refreshInterval = (config?.autoRefreshSeconds ?? 60) * 1000
  const showRegion = config?.showRegion !== false
  const showSeverityBadge = config?.showSeverityBadge !== false

  const fetchWarnings = useCallback(async () => {
    try {
      const res = await authFetch('/api/nina/warnings')
      if (res.ok) {
        const data = await res.json()
        setWarnings(data.warnings || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchWarnings()
    const interval = setInterval(fetchWarnings, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchWarnings, refreshInterval])

  // Listen for test warnings via WebSocket
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'warning_entity_update' && data.source === 'NINA-TEST') {
          if (data.active) {
            const testWarning: NinaWarning = {
              id: data.entity_id || `test-${Date.now()}`,
              headline: data.title || 'Test-Warnung',
              description: data.message,
              severity: data.attributes?.severity || 'Moderate',
              level: data.level || 'warning',
              region: data.attributes?.region || 'Test',
              source: 'NINA-TEST',
              sender_name: 'NINA-TEST',
            }
            setWarnings(prev => [testWarning, ...prev.filter(w => w.id !== testWarning.id)])
          } else {
            // Test warning cleared
            setWarnings(prev => prev.filter(w => w.id !== data.entity_id))
          }
        }
      } catch { /* ignore non-JSON */ }
    }

    // Find WebSocket connections
    const ws = (window as any).__ha_dashboard_ws as WebSocket | undefined
    if (ws) {
      ws.addEventListener('message', handler)
      return () => ws.removeEventListener('message', handler)
    }
  }, [])

  const noWarnings = warnings.length === 0
  const displayWarnings = warnings.slice(0, maxWarnings)
  const { dialogOpen: overviewOpen, setDialogOpen: setOverviewOpen, longPressHandlers } = useLongPressDialog()

  return (
    <>
      <motion.div
        {...longPressHandlers}
        className="glass-card rounded-2xl p-4 sm:p-5 h-full flex flex-col"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldWarning size={20} weight="fill" className={noWarnings ? 'text-green-500' : 'text-orange-500'} />
            <h3 className="text-sm font-semibold text-foreground">
              {config?.title || 'NINA Warnungen'}
            </h3>
            {loading && <div className="w-3 h-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin" />}
          </div>
          {!noWarnings && (
            <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-bold tabular-nums">
              {warnings.length}
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {noWarnings ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[80px] gap-2">
              <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                <ShieldWarning size={20} weight="fill" className="text-green-500" />
              </div>
              <p className="text-xs text-foreground/50 font-medium">Keine aktiven Warnungen</p>
              <p className="text-[10px] text-foreground/30">Alles sicher in deiner Region</p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayWarnings.map(w => {
                const style = LEVEL_STYLES[w.level] || LEVEL_STYLES.info
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelectedWarning(w)}
                    className={`w-full text-left p-3 rounded-xl ${style.bg} border ${style.border} transition-all hover:scale-[1.01] active:scale-[0.99]`}
                  >
                    <div className="flex items-start gap-2.5">
                      <Warning size={16} weight="fill" className={`${style.icon} shrink-0 mt-0.5`} />
                      <div className="min-w-0 flex-1">
                        {showSeverityBadge && (
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
                              {LEVEL_LABELS[w.level] || w.severity}
                            </span>
                          </div>
                        )}
                        <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2">
                          {w.headline}
                        </p>
                        {variant === 'detailed' && showRegion && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <MapPin size={10} className="text-foreground/40 shrink-0" />
                            <p className="text-[10px] text-foreground/50 truncate">{w.region || w.area_desc || 'Unbekannte Region'}</p>
                          </div>
                        )}
                      </div>
                      <CaretRight size={14} className="text-foreground/30 shrink-0 mt-1" />
                    </div>
                  </button>
                )
              })}
              {warnings.length > maxWarnings && (
                <p className="text-[10px] text-foreground/40 text-center pt-1">
                  +{warnings.length - maxWarnings} weitere Warnungen
                </p>
              )}
            </div>
          )}
        </div>

        {/* Map preview */}
        {showMap && !noWarnings && (
          <div className="mt-3 pt-3 border-t border-foreground/8">
            <div className="rounded-xl overflow-hidden h-[120px] bg-foreground/[0.04] border border-foreground/6">
              <iframe
                src={`https://nina.api.bund.dev/`}
                className="w-full h-full border-0 opacity-80"
                title="NINA Warnkarte"
                loading="lazy"
                sandbox="allow-scripts allow-same-origin"
              />
            </div>
            <p className="text-[9px] text-foreground/30 text-center mt-1">NINA Warnkarte · BBK</p>
          </div>
        )}
      </motion.div>

      {/* Warning detail dialog */}
      <Dialog open={!!selectedWarning} onOpenChange={(o) => { if (!o) setSelectedWarning(null) }}>
        <DialogContent className="sm:max-w-[520px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl">
          <DialogTitle className="px-5 pt-5 pb-3 border-b border-foreground/8">
            <div className="flex items-center gap-2">
              <Warning size={18} weight="fill" className={(LEVEL_STYLES[selectedWarning?.level || 'info'] || LEVEL_STYLES.info).icon} />
              <span className="text-sm font-semibold text-foreground">{selectedWarning?.headline}</span>
            </div>
          </DialogTitle>
          {selectedWarning && (
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase ${(LEVEL_STYLES[selectedWarning.level] || LEVEL_STYLES.info).bg} ${(LEVEL_STYLES[selectedWarning.level] || LEVEL_STYLES.info).text} border ${(LEVEL_STYLES[selectedWarning.level] || LEVEL_STYLES.info).border}`}>
                  {LEVEL_LABELS[selectedWarning.level] || selectedWarning.severity}
                </span>
                {selectedWarning.sender_name && (
                  <span className="text-[10px] text-foreground/50">von {selectedWarning.sender_name}</span>
                )}
              </div>

              {selectedWarning.region && (
                <div className="flex items-center gap-2.5">
                  <MapPin size={16} className="text-foreground/50 shrink-0" />
                  <p className="text-xs text-foreground/80">{selectedWarning.region}</p>
                </div>
              )}

              {selectedWarning.area_desc && selectedWarning.area_desc !== selectedWarning.region && (
                <div className="flex items-center gap-2.5">
                  <MapPin size={16} className="text-foreground/50 shrink-0" />
                  <p className="text-xs text-foreground/70">{selectedWarning.area_desc}</p>
                </div>
              )}

              {(selectedWarning.effective || selectedWarning.expires) && (
                <div className="flex items-center gap-4 text-[10px] text-foreground/50">
                  {selectedWarning.effective && <span>Gültig ab: {new Date(selectedWarning.effective).toLocaleString('de-DE')}</span>}
                  {selectedWarning.expires && <span>Endet: {new Date(selectedWarning.expires).toLocaleString('de-DE')}</span>}
                </div>
              )}

              {selectedWarning.description && (
                <div className="p-4 rounded-xl bg-foreground/[0.04] border border-foreground/6">
                  <p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed">
                    {selectedWarning.description}
                  </p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Long-press overview modal */}
      <Dialog open={overviewOpen} onOpenChange={setOverviewOpen}>
        <DialogContent className="sm:max-w-[560px] glass-card border-foreground/10 p-0 gap-0 bg-card/95 backdrop-blur-2xl overflow-hidden">
          <DialogTitle className="px-5 pt-5 pb-3 border-b border-foreground/8">
            <div className="flex items-center gap-2">
              <ShieldWarning size={20} weight="fill" className={noWarnings ? 'text-green-500' : 'text-orange-500'} />
              <span className="text-sm font-semibold text-foreground">{config?.title || 'NINA Warnungen'}</span>
              {!noWarnings && (
                <span className="px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-400 text-[10px] font-bold tabular-nums ml-auto">
                  {warnings.length} {warnings.length === 1 ? 'Warnung' : 'Warnungen'}
                </span>
              )}
            </div>
          </DialogTitle>
          <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
            {noWarnings ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <div className="w-14 h-14 rounded-full bg-green-500/10 flex items-center justify-center">
                  <ShieldWarning size={28} weight="fill" className="text-green-500" />
                </div>
                <p className="text-sm text-foreground/60 font-medium">Keine aktiven Warnungen</p>
                <p className="text-xs text-foreground/30">Alles sicher in deiner Region</p>
              </div>
            ) : (
              warnings.map(w => {
                const style = LEVEL_STYLES[w.level] || LEVEL_STYLES.info
                return (
                  <button
                    key={w.id}
                    onClick={() => { setOverviewOpen(false); setSelectedWarning(w) }}
                    className={`w-full text-left p-4 rounded-xl ${style.bg} border ${style.border} transition-all hover:scale-[1.005] active:scale-[0.995]`}
                  >
                    <div className="flex items-start gap-3">
                      <Warning size={18} weight="fill" className={`${style.icon} shrink-0 mt-0.5`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>
                            {LEVEL_LABELS[w.level] || w.severity}
                          </span>
                          {w.sender_name && (
                            <span className="text-[9px] text-foreground/40">· {w.sender_name}</span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-foreground leading-snug">{w.headline}</p>
                        {w.region && (
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <MapPin size={11} className="text-foreground/40 shrink-0" />
                            <p className="text-[10px] text-foreground/50">{w.region}</p>
                          </div>
                        )}
                        {(w.effective || w.expires) && (
                          <div className="flex items-center gap-3 mt-1 text-[9px] text-foreground/40">
                            {w.effective && <span>Ab: {new Date(w.effective).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                            {w.expires && <span>Bis: {new Date(w.expires).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>}
                          </div>
                        )}
                      </div>
                      <CaretRight size={14} className="text-foreground/30 shrink-0 mt-1" />
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
