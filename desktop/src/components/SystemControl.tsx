import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Pause, Play, Stop, Shield, Warning, Robot, Heartbeat,
  X, CaretRight, CaretDown, ToggleRight, ToggleLeft,
  Clock, ArrowCounterClockwise, Info,
} from '@phosphor-icons/react'
import { getAssistUrl, getBackendUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || getBackendUrl() || ''

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SystemControl({ isOpen, onClose }: Props) {
  const [systemState, setSystemState] = useState<string>('Running')
  const [uptime, setUptime] = useState(0)
  const [agentActivities, setAgentActivities] = useState<any[]>([])
  const [rules, setRules] = useState<any[]>([])
  const [loopDetections, setLoopDetections] = useState<any[]>([])
  const [recoveryCount, setRecoveryCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval>>()

  useEffect(() => {
    if (!isOpen) {
      clearInterval(pollRef.current)
      return
    }
    refreshState()
    pollRef.current = setInterval(refreshState, 3000)
    return () => clearInterval(pollRef.current)
  }, [isOpen])

  const refreshState = async () => {
    try {
      const r = await fetch(`${assistBase()}/api/assist/system/state`)
      if (r.ok) {
        const data = await r.json()
        setSystemState(data.state || 'Running')
        setUptime(data.uptime_secs || 0)
        setRecoveryCount(data.recovery_pending || 0)
      }
      const ar = await fetch(`${assistBase()}/api/assist/system/rules`)
      if (ar.ok) setRules(await ar.json())
      const lr = await fetch(`${assistBase()}/api/assist/system/loops`)
      if (lr.ok) setLoopDetections(await lr.json())
    } catch {}
  }

  const call = async (endpoint: string, method = 'POST') => {
    setLoading(true)
    try { await fetch(`${assistBase()}${endpoint}`, { method }) } catch {}
    setLoading(false)
    refreshState()
  }

  const toggleRule = async (ruleId: string, enabled: boolean) => {
    try {
      await fetch(`${assistBase()}/api/assist/system/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_id: ruleId, enabled, threshold: null }),
      })
      refreshState()
    } catch {}
  }

  const isPaused = systemState.includes('Paused') || systemState.includes('paused')
  const isEmergency = systemState.includes('EmergencyStop') || systemState.includes('emergency')
  const uptimeStr = `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[80vh] rounded-2xl bg-card/98 backdrop-blur-2xl border border-foreground/10 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className={`px-5 py-4 border-b border-foreground/10 flex items-center gap-3 ${
              isEmergency ? 'bg-red-500/10' : isPaused ? 'bg-amber-500/10' : 'bg-green-500/10'
            }`}>
              <Shield size={22} weight="fill" className={isEmergency ? 'text-red-400' : isPaused ? 'text-amber-400' : 'text-green-400'} />
              <div>
                <h2 className="text-sm font-semibold text-foreground">System Guard</h2>
                <p className="text-[10px] text-foreground/40">
                  {isEmergency ? '⚠ NOTFALL-STOPP' : isPaused ? '⏸ Pausiert' : '🟢 Aktiv'} · Uptime {uptimeStr}
                </p>
              </div>
              <div className="flex-1" />
              <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-foreground/10"><X size={16} /></button>
            </div>

            {/* Global Controls */}
            <div className="px-5 py-4 border-b border-foreground/8 grid grid-cols-3 gap-3">
              <button
                onClick={() => call('/api/assist/system/pause')}
                disabled={isPaused || isEmergency}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-400 text-xs font-medium hover:bg-amber-500/20 transition-all disabled:opacity-30"
              >
                <Pause size={16} weight="fill" /> Alles pausieren
              </button>
              <button
                onClick={() => call('/api/assist/system/resume')}
                disabled={!isPaused || isEmergency}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-green-500/20 bg-green-500/10 text-green-400 text-xs font-medium hover:bg-green-500/20 transition-all disabled:opacity-30"
              >
                <Play size={16} weight="fill" /> Fortsetzen
              </button>
              <button
                onClick={() => { if (confirm('⚠ NOTFALL-STOPP? Alle Agents werden sofort gestoppt!')) call('/api/assist/system/emergency-stop') }}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-all"
              >
                <Stop size={16} weight="fill" /> Not-Stopp
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Protection Rules */}
              <div>
                <h3 className="text-[11px] font-semibold text-foreground/40 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Shield size={13} /> Protection Rules
                </h3>
                <div className="space-y-1.5">
                  {rules.map(rule => (
                    <div key={rule.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-foreground/[0.03] border border-foreground/8">
                      <button onClick={() => toggleRule(rule.id, !rule.enabled)} className="shrink-0">
                        {rule.enabled
                          ? <ToggleRight size={20} weight="fill" className="text-green-400" />
                          : <ToggleLeft size={20} className="text-foreground/20" />
                        }
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-foreground/70">{rule.name}</p>
                        <p className="text-[9px] text-foreground/30">
                          Threshold: {rule.threshold} · Action: {rule.action}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Loop Detections */}
              {loopDetections.length > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-red-400/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Warning size={13} /> Loop Detections ({loopDetections.length})
                  </h3>
                  <div className="space-y-1.5">
                    {loopDetections.slice(-10).map((d, i) => (
                      <div key={i} className="px-3 py-2 rounded-lg bg-red-500/[0.06] border border-red-500/15">
                        <p className="text-[11px] text-red-400/80 flex items-center gap-1.5">
                          <Heartbeat size={11} /> Agent {d.agent_id?.slice(0, 8)}…
                        </p>
                        <p className="text-[10px] text-red-400/40 mt-0.5">
                          Pattern: {d.pattern?.join(' → ')} ({d.repetitions}x)
                        </p>
                        {d.suggestion && (
                          <p className="text-[10px] text-amber-400/60 mt-1 italic">{d.suggestion.slice(0, 200)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recovery Queue */}
              {recoveryCount > 0 && (
                <div>
                  <h3 className="text-[11px] font-semibold text-amber-400/70 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <ArrowCounterClockwise size={13} /> Recovery Queue ({recoveryCount})
                  </h3>
                  <button
                    onClick={() => call('/api/assist/system/recovery')}
                    className="w-full py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] hover:bg-amber-500/20 transition-all"
                  >
                    Nächste Recovery anwenden
                  </button>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-2.5 border-t border-foreground/8 flex items-center gap-3 text-[10px] text-foreground/25">
              <Clock size={11} /> Uptime: {uptimeStr}
              <span>·</span>
              <Heartbeat size={11} /> Rules: {rules.filter(r => r.enabled).length}/{rules.length} aktiv
              <span className="ml-auto">IORA System Guard v1.0</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
