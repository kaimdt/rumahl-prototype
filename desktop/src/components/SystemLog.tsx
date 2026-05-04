import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Terminal, X, Download, Pause, Play, Funnel, Trash,
  Robot, Shield, GitBranch, Clock, Wrench, Brain, Warning, Info,
  CheckCircle, XCircle,
} from '@phosphor-icons/react'
import { getAssistUrl } from '@/lib/config'

const assistBase = () => getAssistUrl() || ''

// ─── Types ─────────────────────────────────────────────────────────────────

interface SystemLogEntry {
  id: string
  category: string
  source: string
  event_type: string
  summary: string
  detail?: string
  severity: 'info' | 'success' | 'warn' | 'error'
  progress?: number
  timestamp: string
}

type CategoryFilter = 'all' | 'agent' | 'pidev' | 'subagent' | 'security' | 'task' | 'system' | 'github' | 'evolution' | 'tool'

const CATEGORY_ICONS: Record<string, typeof Robot> = {
  agent: Robot, pidev: Robot, subagent: Robot,
  security: Shield, task: Clock, system: Info,
  github: GitBranch, evolution: Brain, tool: Wrench,
}

const CATEGORY_LABELS: Record<string, string> = {
  agent: 'Agent', pidev: 'Pi.dev', subagent: 'Subagent',
  security: 'Security', task: 'Task', system: 'System',
  github: 'GitHub', evolution: 'Evolution', tool: 'Tool',
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-foreground/50',
  success: 'text-green-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
}

// ─── Component ─────────────────────────────────────────────────────────────

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function SystemLog({ isOpen, onClose }: Props) {
  const [entries, setEntries] = useState<SystemLogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<CategoryFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const eventSourceRef = useRef<EventSource | null>(null)
  const pausedBufferRef = useRef<SystemLogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ─── Connect to system event stream ───────────────────────────────────
  useEffect(() => {
    if (!isOpen) {
      eventSourceRef.current?.close()
      return
    }

    const es = new EventSource(`${assistBase()}/api/assist/system/events`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const entry: SystemLogEntry = {
          id: data.id || crypto.randomUUID(),
          category: data.category || 'system',
          source: data.source || '',
          event_type: data.event_type || 'unknown',
          summary: data.summary || '',
          detail: data.detail,
          severity: data.severity || 'info',
          progress: data.progress,
          timestamp: data.timestamp || new Date().toISOString(),
        }

        if (pausedRef.current) {
          pausedBufferRef.current.push(entry)
        } else {
          setEntries(prev => [...prev.slice(-2000), entry])
        }
      } catch { /* parse error – skip */ }
    }

    es.onerror = () => {
      // Reconnect after 3s
      setTimeout(() => {
        if (isOpen) {
          es.close()
          // The effect cleanup + re-run will reconnect
        }
      }, 3000)
    }

    return () => es.close()
  }, [isOpen])

  // Keep a ref to paused state for the SSE callback
  const pausedRef = useRef(paused)
  useEffect(() => { pausedRef.current = paused }, [paused])

  // When unpausing, flush the buffer
  useEffect(() => {
    if (!paused && pausedBufferRef.current.length > 0) {
      setEntries(prev => [...prev.slice(-2000), ...pausedBufferRef.current.splice(0)])
    }
  }, [paused])

  // ─── Auto-scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (autoScroll && !paused) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [entries, autoScroll, paused])

  // Detect manual scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40
    setAutoScroll(isAtBottom)
  }, [])

  // ─── Filtered entries ─────────────────────────────────────────────────
  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter(e => e.category === filter)

  // ─── Stats ────────────────────────────────────────────────────────────
  const stats = {
    total: filteredEntries.length,
    errors: filteredEntries.filter(e => e.severity === 'error').length,
    warnings: filteredEntries.filter(e => e.severity === 'warn').length,
  }

  // ─── Export ───────────────────────────────────────────────────────────
  const exportLog = () => {
    const text = filteredEntries
      .map(e => `[${e.timestamp}] [${e.category}/${e.event_type}] [${e.severity}] ${e.summary}${e.detail ? '\n  ' + e.detail : ''}`)
      .join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `iora-system-log-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const activeCategories = [...new Set(entries.map(e => e.category))]

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          className="fixed inset-4 z-[80] rounded-2xl bg-black/90 backdrop-blur-2xl border border-foreground/10 shadow-2xl flex flex-col overflow-hidden"
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-foreground/8 bg-foreground/[0.03] shrink-0">
            <Terminal size={16} weight="fill" className="text-emerald-400" />
            <h2 className="text-xs font-semibold text-foreground uppercase tracking-wider">
              System Live Log
            </h2>

            {/* Stats */}
            <div className="flex items-center gap-3 ml-4 text-[10px]">
              <span className="text-foreground/30">{stats.total.toLocaleString()} Einträge</span>
              {stats.errors > 0 && <span className="text-red-400 flex items-center gap-1"><XCircle size={10} /> {stats.errors}</span>}
              {stats.warnings > 0 && <span className="text-yellow-400 flex items-center gap-1"><Warning size={10} /> {stats.warnings}</span>}
            </div>

            <div className="flex-1" />

            {/* Category filter pills */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilter('all')}
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                  filter === 'all' ? 'bg-foreground/15 text-foreground' : 'text-foreground/30 hover:text-foreground/60'
                }`}
              >
                Alle
              </button>
              {activeCategories.map(cat => {
                const Icon = CATEGORY_ICONS[cat] || Info
                return (
                  <button
                    key={cat}
                    onClick={() => setFilter(cat as CategoryFilter)}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                      filter === cat ? 'bg-foreground/15 text-foreground' : 'text-foreground/30 hover:text-foreground/60'
                    }`}
                  >
                    <Icon size={10} />
                    {CATEGORY_LABELS[cat] || cat}
                  </button>
                )
              })}
            </div>

            {/* Controls */}
            <button onClick={() => setPaused(!paused)}
              className={`p-1.5 rounded-lg transition-all ${paused ? 'bg-yellow-500/15 text-yellow-400' : 'text-foreground/30 hover:text-foreground/60'}`}
              title={paused ? 'Fortsetzen' : 'Pausieren'}
            >
              {paused ? <Play size={14} weight="fill" /> : <Pause size={14} />}
            </button>
            <button onClick={() => setEntries([])}
              className="p-1.5 rounded-lg text-foreground/30 hover:text-red-400 transition-all" title="Leeren"
            >
              <Trash size={14} />
            </button>
            <button onClick={exportLog}
              className="p-1.5 rounded-lg text-foreground/30 hover:text-foreground/60 transition-all" title="Exportieren"
            >
              <Download size={14} />
            </button>
            <button onClick={onClose}
              className="p-1.5 rounded-lg text-foreground/30 hover:text-foreground/60 transition-all" title="Schließen"
            >
              <X size={14} />
            </button>
          </div>

          {/* ── Log entries ──────────────────────────────────────────────── */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto font-mono text-[12px] leading-relaxed"
          >
            {filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center h-full text-foreground/10">
                <div className="text-center">
                  <Terminal size={48} weight="duotone" className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Warte auf System-Events…</p>
                  <p className="text-[10px] mt-1">Die Live-Ansicht zeigt alle Hintergrund-Aktivitäten des IORA-Systems.</p>
                </div>
              </div>
            ) : (
              filteredEntries.map((entry, i) => {
                const Icon = CATEGORY_ICONS[entry.category] || Info
                const time = new Date(entry.timestamp).toLocaleTimeString('de-DE', {
                  hour: '2-digit', minute: '2-digit', second: '2-digit',
                })

                // Group consecutive entries from the same source
                const prevEntry = i > 0 ? filteredEntries[i - 1] : null
                const showSource = !prevEntry || prevEntry.source !== entry.source || prevEntry.category !== entry.category

                return (
                  <div
                    key={entry.id}
                    className={`flex gap-2 px-3 py-0.5 hover:bg-foreground/[0.03] transition-colors ${
                      entry.severity === 'error' ? 'bg-red-500/[0.04]' :
                      entry.severity === 'warn' ? 'bg-yellow-500/[0.02]' : ''
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="text-foreground/15 shrink-0 w-[70px]">{time}</span>

                    {/* Category icon + source */}
                    <span className="flex items-start gap-1 shrink-0 w-[140px] min-w-0">
                      {showSource && (
                        <>
                          <Icon size={11} className={`mt-0.5 ${entry.severity === 'error' ? 'text-red-400' : entry.severity === 'warn' ? 'text-yellow-400' : 'text-foreground/25'}`} />
                          <span className="text-foreground/25 truncate text-[10px]">{CATEGORY_LABELS[entry.category] || entry.category}</span>
                        </>
                      )}
                    </span>

                    {/* Event type badge */}
                    <span className={`shrink-0 px-1.5 py-px rounded text-[10px] font-medium ${
                      entry.event_type === 'completed' ? 'bg-green-500/10 text-green-400' :
                      entry.event_type === 'failed' || entry.event_type === 'error' ? 'bg-red-500/10 text-red-400' :
                      entry.event_type === 'started' || entry.event_type === 'running' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-foreground/5 text-foreground/30'
                    }`}>
                      {entry.event_type}
                    </span>

                    {/* Message */}
                    <span className={`flex-1 min-w-0 truncate ${SEVERITY_COLORS[entry.severity] || 'text-foreground/50'}`}>
                      {entry.summary}
                    </span>

                    {/* Detail tooltip on hover */}
                    {entry.detail && (
                      <span className="text-foreground/10 text-[10px] truncate max-w-[200px]" title={entry.detail}>
                        {entry.detail.slice(0, 80)}
                      </span>
                    )}
                  </div>
                )
              })
            )}
            <div ref={logEndRef} />
          </div>

          {/* ── Footer status bar ────────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 py-1.5 border-t border-foreground/8 bg-foreground/[0.02] text-[10px] text-foreground/25 shrink-0">
            <span className={`flex items-center gap-1 ${paused ? 'text-yellow-400' : 'text-green-400'}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${paused ? 'bg-yellow-400' : 'bg-green-400 animate-pulse'}`} />
              {paused ? 'Pausiert' : 'Live'}
            </span>
            <span>{entries.length.toLocaleString()} Events gesamt</span>
            <span className="ml-auto">IORA System Monitor</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
