import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, FileText, ListBullets, Play, Square, Terminal, Triangle } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { OsAppNavbar } from '@/components/OsAppNavbar'

interface LogSource {
  id: string
  kind: string
  transport: string
  name: string
  running?: boolean
  description?: string
}

interface LogLine {
  level?: string
  timestamp?: string
  message?: string
  raw?: string
}

export function OsLogsApp() {
  const { t } = useTranslation()
  const [sources, setSources] = useState<LogSource[]>([])
  const [activeSource, setActiveSource] = useState<string | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingLines, setLoadingLines] = useState(false)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const loadSources = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/os/logs/sources')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const list: LogSource[] = data.sources || data || []
      setSources(list)
      if (!activeSource && list.length > 0) setActiveSource(list[0].id)
    } catch {
      setError(t('logsApp.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [activeSource, t])

  const loadLines = useCallback(async (sourceId: string) => {
    setLoadingLines(true)
    try {
      const response = await authFetch(`/api/os/logs/source/${encodeURIComponent(sourceId)}?lines=300`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      const list: LogLine[] = data.lines || data.logs || data || []
      setLines(list)
    } catch {
      setLines([])
    } finally {
      setLoadingLines(false)
    }
  }, [])

  useEffect(() => {
    void loadSources()
  }, [loadSources])

  useEffect(() => {
    if (activeSource) void loadLines(activeSource)
  }, [activeSource, loadLines])

  // Poll log lines only while the tab is visible and auto-refresh is on.
  useVisibleInterval(() => {
    if (activeSource && autoRefresh) void loadLines(activeSource)
  }, activeSource && autoRefresh ? 4000 : null)

  const selectSource = (sourceId: string) => {
    setActiveSource(sourceId)
    void loadLines(sourceId)
  }

  const active = sources.find((source) => source.id === activeSource)

  return (
    <section className="rumahl-app-frame mx-auto max-w-7xl overflow-hidden">
      <OsAppNavbar
        pageId="os-logs"
        title={t('os.apps.logs.name')}
        description={t('os.apps.logs.description')}
        icon={<Terminal size={24} weight="duotone" />}
        accent="oklch(0.6 0.14 40)"
        trailing={
          <>
            <label className="flex items-center gap-2 text-xs text-foreground/55">
              <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
              {t('logsApp.autoRefresh')}
            </label>
            <button type="button" onClick={() => { void loadSources(); if (activeSource) void loadLines(activeSource) }} disabled={loading} className="rumahl-icon-button" title={t('logsApp.refresh')}>
              <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </>
        }
      />

      <div className="p-4 pb-10 sm:p-6">
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        {/* Source list */}
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">{t('logsApp.sources')}</h2>
          {sources.map((source) => (
            <button
              key={source.id}
              type="button"
              onClick={() => selectSource(source.id)}
              className={`w-full rounded-2xl border p-4 text-left transition-colors ${activeSource === source.id ? 'border-accent/40 bg-accent/10' : 'border-white/8 bg-foreground/4 hover:bg-foreground/7'}`}
            >
              <div className="flex items-center gap-2">
                {source.kind === 'service' ? <Square size={14} className="text-cyan-300" /> : source.kind === 'file' ? <FileText size={14} className="text-amber-300" /> : <ListBullets size={14} className="text-foreground/50" />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{source.name}</span>
                {source.running && <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />}
              </div>
              {source.description && <p className="mt-1 line-clamp-2 text-[11px] text-foreground/45">{source.description}</p>}
            </button>
          ))}
          {!loading && sources.length === 0 && <p className="text-sm text-foreground/40">{t('logsApp.noSources')}</p>}
        </div>

        {/* Log viewer */}
        <div className="min-w-0">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Terminal size={16} className="text-cyan-300" />
            <span className="truncate">{active ? active.name : t('logsApp.selectSource')}</span>
            {loadingLines && <Triangle size={12} className="animate-spin text-foreground/40" />}
          </h2>
          <div className="h-[min(60vh,calc(100vh-16rem))] overflow-y-auto rounded-2xl border border-white/8 bg-black/35 p-4 font-mono text-[11px] leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-foreground/40">{t('logsApp.empty')}</p>
            ) : (
              lines.map((line, index) => {
                const text = line.raw || (line.message || '')
                const level = (line.level || '').toLowerCase()
                const timestamp = line.timestamp || ''
                const color = level.includes('error') ? 'text-red-300' : level.includes('warn') ? 'text-amber-300' : level.includes('info') ? 'text-cyan-200' : 'text-foreground/75'
                return (
                  <div key={index} className="whitespace-pre-wrap break-words">
                    {timestamp && <span className="text-foreground/35">{timestamp} </span>}
                    <span className={color}>{text}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
      </div>
    </section>
  )
}
