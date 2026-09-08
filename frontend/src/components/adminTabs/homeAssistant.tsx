import { useCallback, useEffect, useState } from 'react'
import { AppleLogo, ArrowClockwise, Bluetooth, BookOpen, CalendarBlank, CaretDown, CaretUp, ChartLine, Clock, CloudArrowUp, Code, Cpu, Cube, Database, FilmSlate, Gear, HardDrive, LinkSimple, List, ListBullets, MagnifyingGlass, MapPin, PaperPlaneTilt, Play, Power, Pulse, Stack, Tree, WifiHigh } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { AdminCard, ErrorMessage, InlineSpinner, LoadingSpinner, StatItem, adminFetch, cachedFetch } from '../AdminPanel'
export function HaConfigTab({ token }: { token: string }) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null)
  const [supervisor, setSupervisor] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        const [c, s] = await Promise.all([
          cachedFetch('/api/admin/ha/config', token),
          cachedFetch('/api/admin/ha/supervisor', token).catch(() => null),
        ])
        setConfig(c as Record<string, unknown>)
        setSupervisor(s as Record<string, unknown> | null)
      } catch (e) { setError((e as Error).message) }
      setLoading(false)
    })()
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!config) return <ErrorMessage>HA Konfiguration konnte nicht geladen werden.</ErrorMessage>

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title="Home Assistant" icon={Gear}>
        <StatItem label="Version" value={config.version as string} />
        <StatItem label="Name" value={config.location_name as string} />
        <StatItem label="Zeitzone" value={config.time_zone as string} />
        <StatItem label="Höhe" value={`${config.elevation}m`} />
        <StatItem label="Einheitensystem" value={(config.unit_system as Record<string, string>)?.temperature ?? 'N/A'} />
        <StatItem label="Sprache" value={config.language as string} />
        <StatItem label="Externe URL" value={(config.external_url as string) ?? 'Nicht gesetzt'} />
        <StatItem label="Interne URL" value={(config.internal_url as string) ?? 'Nicht gesetzt'} />
      </AdminCard>

      {Array.isArray(config.components) && (
        <AdminCard title={`Komponenten (${(config.components as string[]).length})`} icon={Cube}>
          <div className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
            {(config.components as string[]).sort().map(c => (
              <div key={c} className="text-xs text-foreground/80 py-0.5">{c}</div>
            ))}
          </div>
        </AdminCard>
      )}

      {supervisor && (
        <AdminCard title="Supervisor" icon={CloudArrowUp}>
          {supervisor.supervisor_available ? (
            <>
              <StatItem label="Status" value="Verfügbar" />
              {supervisor.info && Object.entries(supervisor.info as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
                <StatItem key={k} label={k} value={String(v)} />
              ))}
            </>
          ) : (
            <div className="text-xs text-foreground/80">{(supervisor as Record<string, unknown>).note as string}</div>
          )}
        </AdminCard>
      )}

      <AdminCard title="Add-ons" icon={CloudArrowUp}>
        <AddonsContent token={token} />
      </AdminCard>
    </div>
  )
}


export function AddonsContent({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    cachedFetch('/api/admin/ha/addons', token).then(d => setData(d as Record<string, unknown>)).catch(() => {})
  }, [token])

  if (!data) return <div className="text-xs text-foreground/80">Laden...</div>

  if (data.addon_entities) {
    return (
      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {(data.addon_entities as Array<Record<string, unknown>>).map((a, i) => (
          <div key={i} className="flex justify-between items-center text-xs py-1">
            <span className="text-foreground/85 truncate">{a.friendly_name as string}</span>
            <span className="text-foreground/80">{a.installed_version as string}</span>
          </div>
        ))}
      </div>
    )
  }

  return <div className="text-xs text-foreground/80">Keine Add-on-Daten verfügbar.</div>
}

// ── Integrations Tab ──────────────────────────────────────────


export function IntegrationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/integrations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!data) return <ErrorMessage>Integrationen konnten nicht geladen werden.</ErrorMessage>

  const domains = data.entity_domains as Record<string, number> | undefined

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <AdminCard title={`Entity-Domänen (${data.total_entities})`} icon={Cube} className="md:col-span-2">
        {domains && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {Object.entries(domains).sort(([, a], [, b]) => b - a).map(([domain, count]) => (
              <div key={domain} className="flex justify-between items-center text-xs py-1.5 px-2.5 rounded bg-foreground/3">
                <span className="text-foreground/80">{domain}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {Array.isArray(data.components) && (
        <AdminCard title={`Geladene Komponenten (${(data.components as string[]).length})`} icon={Gear} className="md:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {(data.components as string[]).sort().map(c => (
              <span key={c} className="text-[10px] px-2 py-0.5 rounded-full bg-foreground/5 text-foreground/75">{c}</span>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Protocol Config Modal ─────────────────────────────────────


export function HaConnectionTab({ token }: { token: string }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const s = await adminFetch('/api/admin/ha/connection', token) as Record<string, unknown>
      setStatus(s)
    } catch { /* optional */ }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const integrations = (status?.integrations ?? []) as Array<Record<string, unknown>>
  const events = (status?.events ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-3">
      <AdminCard title="Home Assistant Verbindung" icon={Pulse}>
        <div className="space-y-1">
          <StatItem label="Status" value={status?.available ? 'Verbunden' : 'Getrennt'} />
          <StatItem label="HA URL" value={status?.ha_url as string} />
          {typeof status?.ha_version === 'string' && <StatItem label="HA Version" value={status.ha_version} />}
          <StatItem label="Fehler in Folge" value={String(status?.failure_count ?? 0)} />
        </div>
        <button onClick={refresh} className="mt-2 flex items-center gap-1 px-2 py-1 rounded bg-foreground/5 text-xs text-foreground/70 hover:bg-foreground/10 transition">
          <ArrowClockwise size={12} /> Aktualisieren
        </button>
      </AdminCard>

      <AdminCard title={`Erkannte Integrationen (${integrations.length})`} icon={Cube}>
        {integrations.length === 0 ? (
          <div className="text-xs text-foreground/50 py-2">Keine Integrationen erkannt</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {integrations.map(integ => (
              <span key={String(integ.domain)} className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                integ.available ? 'bg-accent/10 text-accent' : 'bg-foreground/10 text-foreground/50'
              }`}>{String(integ.title || integ.domain)}</span>
            ))}
          </div>
        )}
      </AdminCard>

      {events.length > 0 && (
        <AdminCard title="Verbindungs-Ereignisse" icon={ListBullets}>
          <div className="space-y-1 max-h-60 overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="flex items-center gap-2 text-[10px] py-1 border-b border-foreground/5 last:border-0">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${(ev.event_type as string)?.includes('onnected') ? 'bg-green-400' : 'bg-red-400'}`} />
                <span className="text-foreground/70">{ev.event_type as string}</span>
                <span className="text-foreground/40 ml-auto">{ev.timestamp as string}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}
    </div>
  )
}

// ── Zigbee Tab ────────────────────────────────────────────────


export function AutomationsTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/automations', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const automations = (data?.automations ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <Power size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{automations.length} Automationen</span>
        </div>
      </AdminCard>
      {automations.map((a, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(a.friendly_name as string) ?? a.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {a.entity_id as string}
                {typeof a.last_triggered === 'string' && ` · Letzt. Ausl.: ${new Date(a.last_triggered).toLocaleString('de-DE')}`}
              </div>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              a.state === 'on' ? 'bg-green-500/10 text-green-400' : 'bg-foreground/5 text-foreground/80'
            }`}>
              {a.state === 'on' ? 'Aktiv' : 'Aus'}
            </span>
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Scenes Tab ────────────────────────────────────────────────


export function ScenesTab({ token }: { token: string }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    cachedFetch('/api/admin/ha/scenes', token)
      .then(d => setData(d as Record<string, unknown>))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const scenes = (data?.scenes ?? []) as Array<Record<string, unknown>>

  return (
    <div className="space-y-2">
      <AdminCard>
        <div className="flex items-center gap-2">
          <FilmSlate size={16} className="text-accent" />
          <span className="text-sm font-medium text-foreground">{scenes.length} Szenen</span>
        </div>
      </AdminCard>
      {scenes.length === 0 ? (
        <AdminCard>
          <div className="text-sm text-foreground/80 text-center py-4">Keine Szenen in Home Assistant konfiguriert.</div>
        </AdminCard>
      ) : scenes.map((s, i) => (
        <AdminCard key={i}>
          <div className="flex items-center justify-between">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{(s.friendly_name as string) ?? s.entity_id}</div>
              <div className="text-[10px] text-foreground/80 mt-0.5">
                {s.entity_id as string}
                {typeof s.last_activated === 'string' && ` · Letzt. Aktivierung: ${new Date(s.last_activated).toLocaleString('de-DE')}`}
              </div>
            </div>
            <Play size={16} className="text-accent/80 flex-shrink-0" />
          </div>
        </AdminCard>
      ))}
    </div>
  )
}

// ── Backups Tab ────────────────────────────────────────────────


export function EntitiesTab({ token }: { token: string }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [entities, setEntities] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([])
  const [searching, setSearching] = useState(false)
  const [historyEntity, setHistoryEntity] = useState('')
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedEntity, setExpandedEntity] = useState<string | null>(null)
  const [domainLoading, setDomainLoading] = useState(false)

  const loadCounts = useCallback(async () => {
    try {
      setLoading(true)
      const raw = await cachedFetch('/api/entities/count', token) as Record<string, unknown>
      // API returns {total, domains: [{domain, count}, ...]}
      const mapped: Record<string, number> = {}
      const domains = Array.isArray(raw) ? raw : Array.isArray((raw as Record<string, unknown>)?.domains) ? (raw as Record<string, unknown>).domains as Record<string, unknown>[] : []
      for (const item of domains as Record<string, unknown>[]) {
        if (item && typeof item === 'object' && 'domain' in item && 'count' in item) {
          mapped[String(item.domain)] = Number(item.count)
        }
      }
      setCounts(mapped)
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { loadCounts() }, [loadCounts])

  const loadDomain = async (domain: string) => {
    setSelectedDomain(domain)
    setEntities([])
    setDomainLoading(true)
    try {
      const data = await adminFetch(`/api/entities/domain/${domain}`, token) as Record<string, unknown>[]
      setEntities(Array.isArray(data) ? data : [])
    } catch {}
    finally { setDomainLoading(false) }
  }

  const doSearch = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const data = await adminFetch(`/api/entities/search?q=${encodeURIComponent(searchQuery)}`, token) as Record<string, unknown>[]
      setSearchResults(Array.isArray(data) ? data : [])
    } catch {}
    finally { setSearching(false) }
  }

  const loadHistory = async (entityId: string) => {
    if (historyEntity === entityId) { setHistoryEntity(''); setHistory([]); return }
    setHistoryEntity(entityId)
    setHistoryLoading(true)
    try {
      const data = await adminFetch(`/api/stats/entity-history/${encodeURIComponent(entityId)}`, token) as Record<string, unknown>[]
      setHistory(Array.isArray(data) ? data : [])
    } catch { setHistory([]) }
    finally { setHistoryLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Search */}
      <AdminCard title="Entity-Suche" icon={MagnifyingGlass}>
        <div className="flex gap-2">
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doSearch()}
            placeholder="Entity-ID oder Name suchen..."
            className="rumahl-field-sm flex-1 text-xs" />
          <button onClick={doSearch} disabled={searching}
            className="px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/85 transition-colors disabled:opacity-50">
            {searching ? '...' : 'Suchen'}
          </button>
        </div>
        {searchResults.length > 0 && (
          <div className="mt-3 space-y-1 max-h-60 overflow-y-auto">
            {searchResults.map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-accent">{String(e.entity_id ?? '')}</span>
                  <span className="text-xs text-foreground/50 ml-2">{String(e.state ?? '')}</span>
                </div>
                <button onClick={() => loadHistory(String(e.entity_id ?? ''))}
                  className="text-[10px] text-foreground/40 hover:text-accent transition-colors shrink-0 ml-2">
                  <ChartLine size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Domain Counts */}
      {counts && (
        <AdminCard title="Domains" icon={Cube}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5">
            {Object.entries(counts).sort(([,a],[,b]) => b - a).map(([domain, count]) => (
              <button key={domain} onClick={() => loadDomain(domain)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all ${
                  selectedDomain === domain ? 'bg-accent/15 text-accent border border-accent/30' : 'bg-foreground/5 text-foreground/70 hover:bg-foreground/8 border border-transparent'
                }`}>
                <span className="truncate font-mono">{domain}</span>
                <span className="font-semibold ml-1.5 shrink-0">{count}</span>
              </button>
            ))}
          </div>
        </AdminCard>
      )}

      {/* Domain Entities */}
      {selectedDomain && domainLoading && (
        <AdminCard>
          <div className="flex items-center justify-center gap-2 py-4">
            <InlineSpinner size={16} className="text-accent" />
            <span className="text-xs text-foreground/50">Lade {selectedDomain}-Entities...</span>
          </div>
        </AdminCard>
      )}
      {selectedDomain && !domainLoading && entities.length > 0 && (
        <AdminCard title={`${selectedDomain} (${entities.length})`} icon={ListBullets}>
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {entities.map((e, i) => {
              const eid = String(e.entity_id ?? '')
              const isExpanded = expandedEntity === eid
              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                  <div className="flex items-center justify-between py-1.5 px-2 cursor-pointer" onClick={() => setExpandedEntity(isExpanded ? null : eid)}>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-xs font-mono text-foreground/80 truncate">{eid}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                        String(e.state) === 'on' || String(e.state) === 'home' ? 'bg-green-500/15 text-green-400' :
                        String(e.state) === 'off' || String(e.state) === 'not_home' ? 'bg-foreground/10 text-foreground/40' :
                        String(e.state) === 'unavailable' ? 'bg-red-500/15 text-red-400' :
                        'bg-blue-500/15 text-blue-400'
                      }`}>{String(e.state ?? '–')}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={ev => { ev.stopPropagation(); loadHistory(eid) }}
                        className="text-foreground/30 hover:text-accent transition-colors p-0.5"><ChartLine size={14} /></button>
                      {isExpanded ? <CaretUp size={12} className="text-foreground/30" /> : <CaretDown size={12} className="text-foreground/30" />}
                    </div>
                  </div>
                  {isExpanded && e.attributes ? (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5">
                        {Object.entries(e.attributes as Record<string, unknown>).map(([k, v]) => (
                          <div key={k} className="flex justify-between text-[10px] py-0.5">
                            <span className="text-foreground/50">{k}</span>
                            <span className="text-foreground/70 font-mono truncate ml-2 max-w-[200px]">{JSON.stringify(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </AdminCard>
      )}

      {/* History */}
      {historyEntity && (
        <AdminCard title={`Verlauf: ${historyEntity}`} icon={ChartLine}>
          {historyLoading ? <LoadingSpinner /> : history.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine Verlaufsdaten verfügbar.</p>
          ) : (
            <div className="space-y-0.5 max-h-60 overflow-y-auto">
              {history.slice(0, 50).map((h, i) => (
                <div key={i} className="flex items-center gap-3 py-1 px-2 rounded bg-foreground/3 text-[10px]">
                  <span className="text-foreground/40 font-mono shrink-0">{String(h.timestamp ?? h.last_changed ?? '').slice(0, 19)}</span>
                  <span className="font-semibold text-foreground/70">{String(h.state ?? '–')}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}
    </div>
  )
}

// ── Scheduler Tab ──────────────────────────────────────────────────


export function LogbookTab({ token }: { token: string }) {
  const [entries, setEntries] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [entityFilter, setEntityFilter] = useState('')
  const [expandedEntry, setExpandedEntry] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/logbook', token) as Record<string, unknown>[]
      setEntries(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const filtered = entityFilter
    ? entries.filter(e => String(e.entity_id ?? '').includes(entityFilter) || String(e.name ?? '').toLowerCase().includes(entityFilter.toLowerCase()))
    : entries

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Filter */}
      <AdminCard>
        <div className="flex items-center gap-2">
          <MagnifyingGlass size={14} className="text-foreground/40" />
          <input value={entityFilter} onChange={e => setEntityFilter(e.target.value)}
            placeholder="Entity oder Name filtern..."
            className="rumahl-field-sm flex-1 text-xs" />
          <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
            className="text-foreground/40 hover:text-accent transition-colors p-1 disabled:opacity-40">
            {refreshing ? <InlineSpinner size={16} /> : <ArrowClockwise size={16} />}
          </button>
          <span className="text-[10px] text-foreground/40">{filtered.length} Einträge</span>
        </div>
      </AdminCard>

      {/* Entries */}
      <AdminCard title="Logbuch-Einträge" icon={BookOpen}>
        {filtered.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Logbuch-Einträge gefunden.</p>
        ) : (
          <div className="space-y-0.5 max-h-[500px] overflow-y-auto">
            {filtered.slice(0, 200).map((entry, i) => {
              const timestamp = String(entry.when ?? entry.last_changed ?? entry.timestamp ?? '').slice(0, 19)
              const entityId = String(entry.entity_id ?? '')
              const name = String(entry.name ?? entityId.split('.').pop() ?? '')
              const message = String(entry.message ?? entry.state ?? '')
              const domain = entityId.split('.')[0] || 'unknown'
              const isExpanded = expandedEntry === i

              return (
                <div key={i} className="rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors cursor-pointer"
                  onClick={() => setExpandedEntry(isExpanded ? null : i)}>
                  <div className="flex items-center gap-2 py-1.5 px-2">
                    <span className="text-[10px] text-foreground/40 font-mono shrink-0 w-32">{timestamp}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                      domain === 'light' ? 'bg-yellow-500/15 text-yellow-400' :
                      domain === 'switch' ? 'bg-blue-500/15 text-blue-400' :
                      domain === 'sensor' ? 'bg-green-500/15 text-green-400' :
                      domain === 'automation' ? 'bg-purple-500/15 text-purple-400' :
                      domain === 'climate' ? 'bg-orange-500/15 text-orange-400' :
                      'bg-foreground/10 text-foreground/50'
                    }`}>{domain}</span>
                    <span className="text-xs text-foreground/80 font-semibold truncate">{name}</span>
                    <span className="text-xs text-foreground/50 truncate flex-1">{message}</span>
                    {isExpanded ? <CaretUp size={12} className="text-foreground/30 shrink-0" /> : <CaretDown size={12} className="text-foreground/30 shrink-0" />}
                  </div>
                  {isExpanded && (
                    <div className="px-3 pb-2 border-t border-foreground/5">
                      <div className="mt-1.5 space-y-0.5 text-[10px]">
                        <div className="flex justify-between"><span className="text-foreground/50">Entity ID</span><span className="text-foreground/70 font-mono">{entityId}</span></div>
                        {entry.context_user_id ? <div className="flex justify-between"><span className="text-foreground/50">Benutzer</span><span className="text-foreground/70">{String(entry.context_user_id)}</span></div> : null}
                        {entry.source ? <div className="flex justify-between"><span className="text-foreground/50">Quelle</span><span className="text-foreground/70">{String(entry.source)}</span></div> : null}
                        {entry.context_event_type ? <div className="flex justify-between"><span className="text-foreground/50">Event-Typ</span><span className="text-foreground/70">{String(entry.context_event_type)}</span></div> : null}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Info */}
      <AdminCard>
        <div className="text-xs text-foreground/50 text-center">
          <p>Das Logbuch zeigt den chronologischen Verlauf aller Zustandsänderungen und Aktionen aus Home Assistant.</p>
        </div>
      </AdminCard>
    </div>
  )
}

// ── Calendars Tab ──────────────────────────────────────────────────


export function CalendarsTab({ token }: { token: string }) {
  const [calendars, setCalendars] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedCalendar, setSelectedCalendar] = useState('')
  const [events, setEvents] = useState<Record<string, unknown>[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await adminFetch('/api/admin/ha/calendars', token) as Record<string, unknown>[]
      setCalendars(Array.isArray(data) ? data : [])
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }, [token])

  useEffect(() => { load() }, [load])

  const loadEvents = async (entityId: string) => {
    if (selectedCalendar === entityId) { setSelectedCalendar(''); setEvents([]); return }
    setSelectedCalendar(entityId)
    setEventsLoading(true)
    try {
      const data = await adminFetch(`/api/admin/ha/calendars/${encodeURIComponent(entityId)}/events`, token) as Record<string, unknown>[]
      setEvents(Array.isArray(data) ? data : [])
    } catch { setEvents([]) }
    finally { setEventsLoading(false) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Calendar List */}
      <AdminCard title={`Kalender (${calendars.length})`} icon={CalendarBlank}>
        {calendars.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Kalender-Entitäten in Home Assistant gefunden.</p>
        ) : (
          <div className="space-y-1">
            {calendars.map((cal, i) => {
              const entityId = String(cal.entity_id ?? '')
              const attrs = (cal.attributes ?? {}) as Record<string, unknown>
              const name = String(cal.name ?? attrs.friendly_name ?? entityId)
              const state = String(cal.state ?? '')
              const isSelected = selectedCalendar === entityId

              return (
                <button key={i} onClick={() => loadEvents(entityId)}
                  className={`w-full flex items-center justify-between py-2 px-3 rounded-lg text-left transition-all ${
                    isSelected ? 'bg-accent/15 border border-accent/30' : 'bg-foreground/3 hover:bg-foreground/5 border border-transparent'
                  }`}>
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <CalendarBlank size={16} className={isSelected ? 'text-accent' : 'text-foreground/40'} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{name}</div>
                      <div className="text-[10px] text-foreground/40 font-mono truncate">{entityId}</div>
                    </div>
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                    state === 'on' ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'
                  }`}>{state || '–'}</span>
                </button>
              )
            })}
          </div>
        )}
      </AdminCard>

      {/* Calendar Events */}
      {selectedCalendar && (
        <AdminCard title={`Termine — ${selectedCalendar}`} icon={Clock}>
          {eventsLoading ? <LoadingSpinner /> : events.length === 0 ? (
            <p className="text-xs text-foreground/50 text-center py-4">Keine anstehenden Termine.</p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {events.map((ev, i) => {
                const summary = String(ev.summary ?? ev.title ?? '–')
                const startVal = ev.start
                const endVal = ev.end
                const start = String(typeof startVal === 'object' && startVal !== null ? (startVal as Record<string, unknown>).dateTime ?? startVal : startVal ?? '').slice(0, 16)
                const end = String(typeof endVal === 'object' && endVal !== null ? (endVal as Record<string, unknown>).dateTime ?? endVal : endVal ?? '').slice(0, 16)
                const location = String(ev.location ?? '')
                const description = String(ev.description ?? '')

                return (
                  <div key={i} className="py-2 px-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-foreground">{summary}</div>
                        <div className="text-[10px] text-foreground/50 mt-0.5 flex items-center gap-2">
                          <span className="font-mono">{start}</span>
                          {end && <><span className="text-foreground/30">→</span> <span className="font-mono">{end}</span></>}
                        </div>
                        {location && <div className="text-[10px] text-foreground/40 mt-0.5 flex items-center gap-1"><MapPin size={10} /> {location}</div>}
                        {description && <div className="text-[10px] text-foreground/40 mt-0.5 truncate max-w-md">{description}</div>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </AdminCard>
      )}

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="rumahl-secondary-button-sm">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── Protocol Overview tab ──────────────────────────────────────────────
//
// Combined live snapshot of every IoT protocol the home is talking to.
// Single GET to /api/admin/protocols/overview returns counts and
// availability for HA, MQTT, Zigbee, Z-Wave, Matter, BLE and HomeKit so
// the user does not have to click through each protocol tab to see if
// something is offline.
export interface ProtocolsSnapshot {
  ha?: { available: boolean; version?: string; entity_count?: number }
  mqtt?: { connected: boolean; message_count: number; subscriptions: number }
  zigbee?: { enabled: boolean; device_count: number; mode?: string }
  zwave?: { enabled: boolean; node_count: number }
  matter?: { enabled: boolean; device_count: number }
  ble?: { enabled: boolean; device_count: number }
  homekit?: { enabled: boolean; accessory_count: number; bridge_available: boolean }
  integrations?: Array<{ domain: string; available: boolean }>
}


export function ProtocolsOverviewTab({ token }: { token: string }) {
  const [data, setData] = useState<ProtocolsSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await adminFetch('/api/admin/protocols/overview', token)
      setData(r as ProtocolsSnapshot)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const protocolCard = (
    label: string,
    icon: typeof Cpu,
    enabled: boolean | undefined,
    primary: string,
    secondary?: string,
  ) => {
    const Icon = icon
    return (
      <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4">
        <div className="flex items-center gap-2 mb-2">
          <Icon size={16} className={enabled ? 'text-green-400' : 'text-foreground/30'} />
          <span className="text-sm font-semibold text-foreground">{label}</span>
          <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${enabled ? 'bg-green-500/15 text-green-300' : 'bg-foreground/10 text-foreground/40'}`}>
            {enabled ? 'aktiv' : 'inaktiv'}
          </span>
        </div>
        <div className="text-xs font-medium text-foreground">{primary}</div>
        {secondary && <div className="text-[11px] text-foreground/50 mt-0.5">{secondary}</div>}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <AdminCard title="Protokoll-Übersicht" icon={Stack}>
        {loading && <p className="text-xs text-foreground/50">Lade Protokoll-Status…</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {protocolCard('Home Assistant', Pulse, data.ha?.available,
              data.ha?.available ? `v${data.ha.version ?? '?'}` : 'nicht erreichbar',
              `${data.ha?.entity_count ?? 0} Entitäten im Cache`)}
            {protocolCard('MQTT', WifiHigh, data.mqtt?.connected,
              data.mqtt?.connected ? `${data.mqtt.message_count} Nachrichten` : 'getrennt',
              `${data.mqtt?.subscriptions ?? 0} Abonnements`)}
            {protocolCard('Zigbee', Tree, data.zigbee?.enabled,
              `${data.zigbee?.device_count ?? 0} Geräte`,
              data.zigbee?.mode ? `Modus: ${data.zigbee.mode}` : undefined)}
            {protocolCard('Z-Wave', LinkSimple, data.zwave?.enabled,
              `${data.zwave?.node_count ?? 0} Nodes`)}
            {protocolCard('Matter', HardDrive, data.matter?.enabled,
              `${data.matter?.device_count ?? 0} Geräte`)}
            {protocolCard('Bluetooth', Bluetooth, data.ble?.enabled,
              `${data.ble?.device_count ?? 0} Geräte`)}
            {protocolCard('HomeKit', AppleLogo, data.homekit?.enabled,
              `${data.homekit?.accessory_count ?? 0} Accessoires`,
              data.homekit?.bridge_available ? 'Bridge online' : 'Bridge offline')}
          </div>
        )}
      </AdminCard>

      {data?.integrations && data.integrations.length > 0 && (
        <AdminCard title="HA-Integrationen" icon={Cube}>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
            {data.integrations.map((i) => (
              <div key={i.domain} className="flex items-center gap-1.5 px-2 py-1 rounded bg-foreground/5 text-[11px]">
                <span className={`h-1.5 w-1.5 rounded-full ${i.available ? 'bg-green-400' : 'bg-foreground/30'}`} />
                <span className="font-mono text-foreground/70 truncate">{i.domain}</span>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <div className="flex justify-center">
        <button onClick={load} disabled={loading}
          className="rumahl-secondary-button-sm">
          <ArrowClockwise size={14} /> Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ─── HA Developer Tools tab ─────────────────────────────────────────────
//
// Three power-user features that mirror Home Assistant's own Developer
// Tools page: render a Jinja2 template, fire an event into HA's bus, and
// browse the entity / device / area registries that HA reports.

export function HaDeveloperToolsTab({ token }: { token: string }) {
  const [tpl, setTpl] = useState('{{ states.sensor | count }} sensor entities')
  const [tplResult, setTplResult] = useState<string | null>(null)
  const [tplBusy, setTplBusy] = useState(false)
  const [tplError, setTplError] = useState<string | null>(null)

  const [evtType, setEvtType] = useState('rumahl_test_event')
  const [evtData, setEvtData] = useState('{"source":"admin","value":42}')
  const [evtBusy, setEvtBusy] = useState(false)
  const [evtMsg, setEvtMsg] = useState<string | null>(null)
  const [evtError, setEvtError] = useState<string | null>(null)

  const [registry, setRegistry] = useState<'entities' | 'devices' | 'areas'>('entities')
  const [regData, setRegData] = useState<Record<string, unknown> | null>(null)
  const [regBusy, setRegBusy] = useState(false)
  const [regError, setRegError] = useState<string | null>(null)

  const renderTpl = async () => {
    setTplBusy(true); setTplError(null); setTplResult(null)
    try {
      const r = await adminFetch('/api/admin/ha/template', token, {
        method: 'POST', body: JSON.stringify({ template: tpl }),
      })
      setTplResult(typeof r?.result === 'string' ? r.result : JSON.stringify(r?.result ?? r, null, 2))
    } catch (e) {
      setTplError(e instanceof Error ? e.message : String(e))
    } finally {
      setTplBusy(false)
    }
  }

  const fireEvt = async () => {
    setEvtBusy(true); setEvtError(null); setEvtMsg(null)
    let parsed: unknown = {}
    try {
      parsed = evtData.trim() ? JSON.parse(evtData) : {}
    } catch (e) {
      setEvtError(`Ungültiges JSON: ${e instanceof Error ? e.message : String(e)}`)
      setEvtBusy(false); return
    }
    try {
      await adminFetch(`/api/admin/ha/events/${encodeURIComponent(evtType)}`, token, {
        method: 'POST', body: JSON.stringify(parsed),
      })
      setEvtMsg(`Event "${evtType}" gesendet.`)
      toast.success(`Event ${evtType} gefeuert`)
    } catch (e) {
      setEvtError(e instanceof Error ? e.message : String(e))
    } finally {
      setEvtBusy(false)
    }
  }

  const loadRegistry = useCallback(async (kind: 'entities' | 'devices' | 'areas') => {
    setRegBusy(true); setRegError(null)
    try {
      const r = await adminFetch(`/api/admin/ha/registry/${kind}`, token)
      setRegData(r as Record<string, unknown>)
    } catch (e) {
      setRegError(e instanceof Error ? e.message : String(e))
    } finally {
      setRegBusy(false)
    }
  }, [token])

  useEffect(() => { loadRegistry(registry) }, [registry, loadRegistry])

  return (
    <div className="space-y-3">
      <AdminCard title="Template rendern" icon={Code}>
        <p className="text-xs text-foreground/60 mb-2">
          Sendet die Vorlage an Home Assistant zum Rendern. Identisch mit
          dem Tab „Template" in HAs Developer Tools.
        </p>
        <textarea
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          <button onClick={renderTpl} disabled={tplBusy || !tpl.trim()}
            className="rumahl-ghost-button-sm">
            {tplBusy ? 'Rendere…' : 'Rendern'}
          </button>
          {tplError && <span className="text-[11px] text-red-300">{tplError}</span>}
        </div>
        {tplResult !== null && (
          <pre className="mt-3 text-xs font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-64 overflow-auto">{tplResult}</pre>
        )}
      </AdminCard>

      <AdminCard title="Event feuern" icon={PaperPlaneTilt}>
        <p className="text-xs text-foreground/60 mb-2">
          Sendet ein Event auf den Event-Bus von Home Assistant. Nützlich
          zum Testen von Automatisierungs-Triggern.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            value={evtType}
            onChange={(e) => setEvtType(e.target.value)}
            placeholder="event_type"
            className="font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg px-3 py-2 text-foreground sm:col-span-1"
          />
          <textarea
            value={evtData}
            onChange={(e) => setEvtData(e.target.value)}
            rows={2}
            spellCheck={false}
            placeholder='{"key":"value"}'
            className="font-mono text-xs bg-foreground/5 border border-foreground/10 rounded-lg p-2 text-foreground sm:col-span-2"
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={fireEvt} disabled={evtBusy || !evtType.trim()}
            className="rumahl-ghost-button-sm">
            {evtBusy ? 'Sende…' : 'Event feuern'}
          </button>
          {evtMsg && <span className="text-[11px] text-green-300">{evtMsg}</span>}
          {evtError && <span className="text-[11px] text-red-300">{evtError}</span>}
        </div>
      </AdminCard>

      <AdminCard title="HA Registry" icon={Database}>
        <div className="flex items-center gap-1 mb-3">
          {(['entities', 'devices', 'areas'] as const).map((k) => (
            <button key={k} onClick={() => setRegistry(k)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                registry === k ? 'bg-accent/20 text-accent' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'
              }`}>
              {k === 'entities' ? 'Entities' : k === 'devices' ? 'Devices' : 'Areas'}
            </button>
          ))}
          <button onClick={() => loadRegistry(registry)} disabled={regBusy}
            className="ml-auto p-1.5 rounded-lg bg-foreground/5 text-foreground/60 hover:bg-foreground/10 disabled:opacity-40">
            <ArrowClockwise size={13} />
          </button>
        </div>
        {regBusy && <p className="text-xs text-foreground/50">Lade…</p>}
        {regError && <p className="text-xs text-red-300">{regError}</p>}
        {regData && !regBusy && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-foreground/5 border border-foreground/10 rounded-lg p-3 text-foreground/85 max-h-96 overflow-auto">{JSON.stringify(regData, null, 2)}</pre>
        )}
      </AdminCard>
    </div>
  )
}

// ─── Global Alert tab ───────────────────────────────────────────────────
//
// Sets / clears the cluster-wide emergency banner that is broadcast to
// every connected dashboard via WebSocket. Backed by ACTIVE_EMERGENCY in
// rumahl-home and the /api/admin/alert GET/PUT/DELETE trio.
