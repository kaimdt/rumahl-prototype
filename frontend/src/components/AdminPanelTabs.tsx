import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Cpu, HardDrive, Globe, Plus, Cube, Lightning, ArrowClockwise, Play, Pause, TrashSimple, MagnifyingGlass, Gear, ShieldCheck } from '@phosphor-icons/react'
import { AdminCard, LoadingSpinner, ErrorMessage, InlineSpinner, adminFetch } from './AdminPanel'
import { startAppAndWatch } from '@/lib/appLifecycle'
import { confirmDialog } from '@/components/ui/confirmDialog'

// Export Phase 2 components
export { RegistrationManagementTab, SecurityMonitorTab, UpdateManagementTab, WidgetManagementTab } from './AdminPanelPhase2'

// Export App Store Tab
export { AppStoreTab } from './AppStoreTab'

// ── System Info Tab (Systeminformationen) ──────────────────────────────────

interface SystemInfo {
  hostname: string
  os_name: string
  os_version: string
  kernel_version: string
  cpu_count: number
  cpu_usage: number
  total_memory: number
  used_memory: number
  available_memory: number
  memory_usage_percent: number
  disks: DiskInfo[]
  network_interfaces: NetworkInterfaceInfo[]
  uptime: number
}

interface DiskInfo {
  name: string
  mount_point: string
  total_space: number
  available_space: number
  used_space: number
  usage_percent: number
  filesystem: string
}

interface NetworkInterfaceInfo {
  name: string
  mac_address: string
  ip_addresses: string[]
  is_up: boolean
  transmitted_bytes: number
  received_bytes: number
}

export function SystemInfoTab({ token }: { token: string }) {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/supervisor/system/info', token) as SystemInfo
      setSystemInfo(data)
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>
  if (!systemInfo) return <ErrorMessage>Keine Systeminformationen verfügbar</ErrorMessage>

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${days}d ${hours}h ${minutes}m`
  }

  return (
    <div className="space-y-3">
      {/* System Overview */}
      <AdminCard title="System" icon={Cpu}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-foreground/3">
            <div className="text-[10px] text-foreground/40 mb-1">Hostname</div>
            <div className="text-xs font-semibold text-foreground">{systemInfo.hostname}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/3">
            <div className="text-[10px] text-foreground/40 mb-1">Betriebssystem</div>
            <div className="text-xs font-semibold text-foreground">{systemInfo.os_name} {systemInfo.os_version}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/3">
            <div className="text-[10px] text-foreground/40 mb-1">Kernel</div>
            <div className="text-xs font-semibold text-foreground">{systemInfo.kernel_version}</div>
          </div>
          <div className="p-3 rounded-lg bg-foreground/3">
            <div className="text-[10px] text-foreground/40 mb-1">Uptime</div>
            <div className="text-xs font-semibold text-foreground">{formatUptime(systemInfo.uptime)}</div>
          </div>
        </div>
      </AdminCard>

      {/* CPU */}
      <AdminCard title="CPU" icon={Cpu}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-foreground/60">Kerne</span>
            <span className="text-xs font-semibold text-foreground">{systemInfo.cpu_count}</span>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-foreground/60">Auslastung</span>
              <span className="text-xs font-semibold text-foreground">{systemInfo.cpu_usage.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${systemInfo.cpu_usage}%` }} />
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Memory */}
      <AdminCard title="Arbeitsspeicher" icon={Cpu}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-lg bg-foreground/3">
              <div className="text-[10px] text-foreground/40 mb-0.5">Gesamt</div>
              <div className="text-xs font-semibold text-foreground">{formatBytes(systemInfo.total_memory)}</div>
            </div>
            <div className="p-2 rounded-lg bg-foreground/3">
              <div className="text-[10px] text-foreground/40 mb-0.5">Belegt</div>
              <div className="text-xs font-semibold text-foreground">{formatBytes(systemInfo.used_memory)}</div>
            </div>
            <div className="p-2 rounded-lg bg-foreground/3">
              <div className="text-[10px] text-foreground/40 mb-0.5">Verfügbar</div>
              <div className="text-xs font-semibold text-foreground">{formatBytes(systemInfo.available_memory)}</div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-foreground/60">Auslastung</span>
              <span className="text-xs font-semibold text-foreground">{systemInfo.memory_usage_percent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${systemInfo.memory_usage_percent}%` }} />
            </div>
          </div>
        </div>
      </AdminCard>

      {/* Disks */}
      <AdminCard title={`Festplatten (${systemInfo.disks.length})`} icon={HardDrive}>
        <div className="space-y-2">
          {systemInfo.disks.map((disk, i) => (
            <div key={i} className="p-3 rounded-lg bg-foreground/3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">{disk.name}</div>
                  <div className="text-[10px] text-foreground/40">{disk.mount_point} • {disk.filesystem}</div>
                </div>
                <span className="text-xs font-semibold text-foreground">{disk.usage_percent.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 bg-foreground/5 rounded-full overflow-hidden mb-1">
                <div className="h-full bg-accent transition-all" style={{ width: `${disk.usage_percent}%` }} />
              </div>
              <div className="flex items-center justify-between text-[10px] text-foreground/40">
                <span>{formatBytes(disk.used_space)} belegt</span>
                <span>{formatBytes(disk.available_space)} frei von {formatBytes(disk.total_space)}</span>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Network Interfaces */}
      <AdminCard title={`Netzwerk (${systemInfo.network_interfaces.length})`} icon={Globe}>
        <div className="space-y-2">
          {systemInfo.network_interfaces.map((iface, i) => (
            <div key={i} className="p-3 rounded-lg bg-foreground/3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                    {iface.name}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                      iface.is_up ? 'bg-green-500/15 text-green-400' : 'bg-foreground/10 text-foreground/40'
                    }`}>{iface.is_up ? 'UP' : 'DOWN'}</span>
                  </div>
                  <div className="text-[10px] text-foreground/40 font-mono">{iface.mac_address}</div>
                </div>
              </div>
              {iface.ip_addresses.length > 0 && (
                <div className="mb-2">
                  <div className="text-[10px] text-foreground/40 mb-1">IP-Adressen:</div>
                  {iface.ip_addresses.map((ip, j) => (
                    <div key={j} className="text-xs font-mono text-foreground/70">{ip}</div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="p-1.5 rounded bg-foreground/5">
                  <span className="text-foreground/40">↓ RX:</span> <span className="font-semibold text-foreground/70">{formatBytes(iface.received_bytes)}</span>
                </div>
                <div className="p-1.5 rounded bg-foreground/5">
                  <span className="text-foreground/40">↑ TX:</span> <span className="font-semibold text-foreground/70">{formatBytes(iface.transmitted_bytes)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="ora-secondary-button-sm">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Apps Tab (Docker Apps) ──────────────────────────────────────────────

interface AppMetadata {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  image: string
  ports: string[]
  environment: Record<string, string>
  volumes: string[]
  permissions: string[]
  enabled: boolean
  installed_at: string
  status?: 'running' | 'stopped' | 'installing' | 'error'
}

export function AppsTab({ token }: { token: string }) {
  const [apps, setApps] = useState<AppMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [newAppImage, setNewAppImage] = useState('')
  const [newAppName, setNewAppName] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/supervisor/apps', token) as { apps: AppMetadata[] }
      setApps(data.apps || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const installApp = async () => {
    if (!newAppImage || !newAppName) return
    setInstalling(true)
    try {
      await adminFetch('/api/supervisor/apps/install', token, {
        method: 'POST',
        body: JSON.stringify({
          image: newAppImage,
          name: newAppName,
          enabled: true,
        }),
      })
      setNewAppImage('')
      setNewAppName('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setInstalling(false)
  }

  const startApp = async (appId: string) => {
    try {
      await startAppAndWatch(appId)
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  const stopApp = async (appId: string) => {
    try {
      await adminFetch(`/api/supervisor/apps/${appId}/stop`, token, { method: 'POST' })
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  const uninstallApp = async (appId: string) => {
    if (!(await confirmDialog({ title: 'App deinstallieren', message: 'App wirklich deinstallieren?', confirmLabel: 'Deinstallieren', danger: true }))) return
    try {
      await adminFetch(`/api/supervisor/apps/${appId}`, token, { method: 'DELETE' })
      await load()
    } catch (e) { setError((e as Error).message) }
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  return (
    <div className="space-y-3">
      {/* Install App */}
      <AdminCard title="App installieren" icon={Plus}>
        <div className="space-y-2">
          <div>
            <label className="text-[10px] text-foreground/40 mb-1 block">App Name</label>
            <input type="text" value={newAppName} onChange={e => setNewAppName(e.target.value)}
              className="ora-field-sm w-full text-xs"
              placeholder="z.B. my-weather-app" />
          </div>
          <div>
            <label className="text-[10px] text-foreground/40 mb-1 block">Docker Image</label>
            <input type="text" value={newAppImage} onChange={e => setNewAppImage(e.target.value)}
              className="ora-field-sm w-full text-xs"
              placeholder="z.B. ghcr.io/user/weather-app:latest" />
          </div>
          <button onClick={installApp} disabled={installing || !newAppImage || !newAppName}
            className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-accent text-white rounded-lg text-xs font-semibold hover:bg-accent/90 transition-colors disabled:opacity-40">
            {installing ? <InlineSpinner size={14} /> : <Plus size={14} />} Installieren
          </button>
        </div>
      </AdminCard>

      {/* Apps List */}
      <AdminCard title={`Installierte Apps (${apps.length})`} icon={Cube}>
        {apps.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">Keine Apps installiert.</p>
        ) : (
          <div className="space-y-2">
            {apps.map((app, i) => (
              <div key={i} className="p-3 rounded-lg bg-foreground/3 hover:bg-foreground/5 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {app.icon && <img src={app.icon} alt="" className="w-4 h-4 rounded" />}
                      {app.name}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        app.status === 'running' ? 'bg-green-500/15 text-green-400' :
                        app.status === 'stopped' ? 'bg-foreground/10 text-foreground/40' :
                        app.status === 'installing' ? 'bg-blue-500/15 text-blue-400' :
                        'bg-red-500/15 text-red-400'
                      }`}>{app.status || 'unknown'}</span>
                    </div>
                    <div className="text-[10px] text-foreground/40">{app.description}</div>
                    <div className="text-[10px] text-foreground/40 font-mono mt-0.5">{app.image}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {app.status === 'running' ? (
                    <button onClick={() => stopApp(app.id)}
                      className="flex items-center gap-1 px-2 py-1 bg-foreground/5 text-foreground/60 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors">
                      <Pause size={12} /> Stoppen
                    </button>
                  ) : (
                    <button onClick={() => startApp(app.id)}
                      className="flex items-center gap-1 px-2 py-1 bg-green-500/15 text-green-400 rounded text-[10px] font-semibold hover:bg-green-500/25 transition-colors">
                      <Play size={12} /> Starten
                    </button>
                  )}
                  <button onClick={() => uninstallApp(app.id)}
                    className="flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-400 rounded text-[10px] font-semibold hover:bg-red-500/25 transition-colors">
                    <TrashSimple size={12} /> Deinstallieren
                  </button>
                </div>
                {app.ports.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-foreground/5">
                    <div className="text-[10px] text-foreground/40 mb-1">Ports:</div>
                    <div className="flex flex-wrap gap-1">
                      {app.ports.map((port, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60 font-mono">{port}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="ora-secondary-button-sm">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}

// ── Plugins Tab (Code Extensions) ──────────────────────────────────────

interface PluginMetadata {
  id: string
  name: string
  version: string
  description: string
  author: string
  plugin_type: string
  permissions: string[]
  sandbox_config: {
    max_execution_time_ms: number
    max_memory_mb: number
    allow_network: boolean
    allow_file_system: boolean
  }
}

interface PluginStats {
  total_executions: number
  successful_executions: number
  failed_executions: number
  total_duration_ms: number
  last_execution?: string
}

type PluginWithStats = [PluginMetadata, PluginStats | null]

export function PluginsTab({ token }: { token: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('de') ? 'de-DE' : 'en-US'
  const [plugins, setPlugins] = useState<PluginWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [executing, setExecuting] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await adminFetch('/api/core/plugins/with-stats', token) as { plugins: PluginWithStats[] }
      setPlugins(data.plugins || [])
    } catch (e) { setError((e as Error).message) }
    setLoading(false)
  }, [token])

  useEffect(() => { load() }, [load])

  const executePlugin = async (pluginId: string) => {
    setExecuting(pluginId)
    try {
      await adminFetch(`/api/core/plugins/${pluginId}/execute`, token, {
        method: 'POST',
        body: JSON.stringify({ input: {} }),
      })
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
    setExecuting(null)
  }

  if (loading) return <LoadingSpinner />
  if (error) return <ErrorMessage>{error}</ErrorMessage>

  const pluginTypes = Array.from(new Set(plugins.map(([plugin]) => plugin.plugin_type))).filter(Boolean)
  const filteredPlugins = plugins.filter(([plugin]) => {
    const matchesType = typeFilter === 'all' || plugin.plugin_type === typeFilter
    const q = query.trim().toLowerCase()
    const matchesQuery = !q || [plugin.name, plugin.id, plugin.description, plugin.author, plugin.plugin_type]
      .some(value => value.toLowerCase().includes(q))
    return matchesType && matchesQuery
  })
  const executions = plugins.reduce((sum, [, stats]) => sum + (stats?.total_executions || 0), 0)
  const failures = plugins.reduce((sum, [, stats]) => sum + (stats?.failed_executions || 0), 0)
  const networkEnabled = plugins.filter(([plugin]) => plugin.sandbox_config.allow_network).length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('navigation.plugins')}</div>
          <div className="text-lg font-semibold text-foreground">{plugins.length}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('plugins.overview.executions')}</div>
          <div className="text-lg font-semibold text-accent">{executions}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('plugins.overview.failures')}</div>
          <div className="text-lg font-semibold text-red-300">{failures}</div>
        </div>
        <div className="ora-card rounded-xl p-3">
          <div className="text-[10px] text-foreground/50 font-semibold uppercase">{t('plugins.overview.network')}</div>
          <div className="text-lg font-semibold text-cyan-300">{networkEnabled}</div>
        </div>
      </div>

      <div className="ora-card rounded-xl p-2 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/35" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('plugins.overview.search')}
            className="ora-field-sm w-full pl-9 pr-3 text-xs"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          <button onClick={() => setTypeFilter('all')} className={`px-3 py-2 rounded-lg text-[10px] font-semibold transition-colors ${typeFilter === 'all' ? 'bg-accent text-white' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>{t('common.all')}</button>
          {pluginTypes.map(type => (
            <button key={type} onClick={() => setTypeFilter(type)} className={`px-3 py-2 rounded-lg text-[10px] font-semibold transition-colors whitespace-nowrap ${typeFilter === type ? 'bg-accent text-white' : 'bg-foreground/5 text-foreground/60 hover:bg-foreground/10'}`}>{type}</button>
          ))}
        </div>
      </div>

      {/* Plugins List */}
      <AdminCard title={`Plugins (${filteredPlugins.length}/${plugins.length})`} icon={Lightning}>
        {plugins.length === 0 ? (
          <p className="text-xs text-foreground/50 text-center py-4">{t('plugins.overview.noneInstalled')}</p>
        ) : (
          <div className="space-y-2">
            {filteredPlugins.map(([plugin, stats], i) => (
              <div key={i} className="p-3 rounded-xl bg-foreground/[0.03] border border-foreground/10 hover:bg-foreground/[0.06] transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                      {plugin.name}
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-accent/15 text-accent">{plugin.plugin_type}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-foreground/10 text-foreground/60">{plugin.id}</span>
                    </div>
                    <div className="text-[10px] text-foreground/40">{plugin.description}</div>
                    <div className="text-[10px] text-foreground/40 mt-0.5">v{plugin.version} • {plugin.author}</div>
                  </div>
                </div>

                {/* Sandbox Config */}
                <div className="mt-2 pt-2 border-t border-foreground/5">
                  <div className="text-[10px] text-foreground/40 mb-1">Sandbox:</div>
                  <div className="grid grid-cols-2 gap-1 text-[10px]">
                    <div className="p-1 rounded bg-foreground/5">
                      <span className="text-foreground/40">Max Zeit:</span> <span className="font-semibold text-foreground/70">{plugin.sandbox_config.max_execution_time_ms}ms</span>
                    </div>
                    <div className="p-1 rounded bg-foreground/5">
                      <span className="text-foreground/40">Max RAM:</span> <span className="font-semibold text-foreground/70">{plugin.sandbox_config.max_memory_mb}MB</span>
                    </div>
                    <div className="p-1 rounded bg-foreground/5">
                      <span className="text-foreground/40">{t('plugins.overview.network')}:</span> <span className={`font-semibold ${plugin.sandbox_config.allow_network ? 'text-cyan-300' : 'text-foreground/50'}`}>{plugin.sandbox_config.allow_network ? t('plugins.overview.allowed') : t('plugins.overview.blocked')}</span>
                    </div>
                    <div className="p-1 rounded bg-foreground/5">
                      <span className="text-foreground/40">{t('plugins.overview.filesystem')}:</span> <span className={`font-semibold ${plugin.sandbox_config.allow_file_system ? 'text-yellow-300' : 'text-foreground/50'}`}>{plugin.sandbox_config.allow_file_system ? t('plugins.overview.allowed') : t('plugins.overview.blocked')}</span>
                    </div>
                  </div>
                </div>

                {/* Statistics */}
                {stats && (
                  <div className="mt-2 pt-2 border-t border-foreground/5">
                    <div className="text-[10px] text-foreground/40 mb-1">Statistiken:</div>
                    <div className="grid grid-cols-3 gap-1 text-[10px]">
                      <div className="p-1.5 rounded bg-foreground/5 text-center">
                        <div className="text-foreground/40">Gesamt</div>
                        <div className="font-semibold text-foreground/70">{stats.total_executions}</div>
                      </div>
                      <div className="p-1.5 rounded bg-green-500/10 text-center">
                        <div className="text-green-400/70">Erfolg</div>
                        <div className="font-semibold text-green-400">{stats.successful_executions}</div>
                      </div>
                      <div className="p-1.5 rounded bg-red-500/10 text-center">
                        <div className="text-red-400/70">Fehler</div>
                        <div className="font-semibold text-red-400">{stats.failed_executions}</div>
                      </div>
                    </div>
                    {stats.last_execution && (
                      <div className="text-[10px] text-foreground/40 mt-1">
                        {t('plugins.overview.lastExecution')}: {new Date(stats.last_execution).toLocaleString(locale)}
                      </div>
                    )}
                    <div className="text-[10px] text-foreground/40 mt-0.5">
                      Ø Dauer: {stats.total_executions > 0 ? (stats.total_duration_ms / stats.total_executions).toFixed(1) : 0}ms
                    </div>
                  </div>
                )}

                {/* Permissions */}
                {plugin.permissions.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-foreground/5">
                    <div className="text-[10px] text-foreground/40 mb-1 flex items-center gap-1"><ShieldCheck size={11} /> {t('apps.permissions')} ({plugin.permissions.length}):</div>
                    <div className="flex flex-wrap gap-1">
                      {plugin.permissions.map((perm, j) => (
                        <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-foreground/5 text-foreground/60">{perm}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-2 mt-2">
                  <button onClick={() => executePlugin(plugin.id)} disabled={executing === plugin.id}
                    className="flex items-center gap-1 px-2 py-1 bg-accent/15 text-accent rounded text-[10px] font-semibold hover:bg-accent/25 transition-colors disabled:opacity-40">
                    {executing === plugin.id ? <InlineSpinner size={12} /> : <Lightning size={12} />} {t('plugins.overview.execute')}
                  </button>
                  <button onClick={() => { window.location.href = `/settings/apps/${encodeURIComponent(plugin.id)}` }}
                    className="flex items-center gap-1 px-2 py-1 bg-foreground/5 text-foreground/70 rounded text-[10px] font-semibold hover:bg-foreground/10 transition-colors">
                    <Gear size={12} /> {t('settings.title')}
                  </button>
                </div>
              </div>
            ))}
            {filteredPlugins.length === 0 && (
              <p className="text-xs text-foreground/50 text-center py-6">{t('plugins.overview.noFiltered')}</p>
            )}
          </div>
        )}
      </AdminCard>

      {/* Refresh */}
      <div className="flex justify-center">
        <button onClick={async () => { setRefreshing(true); try { await load() } finally { setRefreshing(false) } }} disabled={refreshing}
          className="ora-secondary-button-sm">
          {refreshing ? <InlineSpinner size={14} /> : <ArrowClockwise size={14} />} Aktualisieren
        </button>
      </div>
    </div>
  )
}
