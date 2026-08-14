import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowClockwise,
  CircleNotch,
  Cube,
  Play,
  Power,
  Square,
  Stop,
} from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { toast } from 'sonner'

interface SupervisorApp {
  id: string
  name: string
  version: string
  description?: string
  status?: string
  enabled?: boolean
  ports?: Array<string | { external: number; internal: number; protocol: string }>
  icon?: string
}

interface ContainerResource {
  container_id: string
  container_name: string
  app_id?: string | null
  cpu_usage_percent: number
  memory_usage_bytes: number
  memory_usage_percent: number
  cpu_utilization: number
  memory_utilization: number
}

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++ }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

function statusColor(status?: string) {
  switch (status) {
    case 'running': return 'bg-emerald-500/10 text-emerald-300'
    case 'stopped': return 'bg-foreground/8 text-foreground/45'
    case 'starting': return 'bg-amber-500/10 text-amber-300'
    case 'error': case 'failed': return 'bg-red-500/10 text-red-300'
    default: return 'bg-foreground/8 text-foreground/45'
  }
}

export function OsContainersApp() {
  const { t } = useTranslation()
  const [apps, setApps] = useState<SupervisorApp[]>([])
  const [resources, setResources] = useState<ContainerResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [appsResponse, resourcesResponse] = await Promise.all([
        authFetch('/api/supervisor/apps'),
        authFetch('/api/resources/containers'),
      ])
      if (!appsResponse.ok) throw new Error(`HTTP ${appsResponse.status}`)
      const appsData = await appsResponse.json() as { apps?: SupervisorApp[] }
      setApps(appsData.apps || [])
      if (resourcesResponse.ok) {
        const resourcesData = await resourcesResponse.json()
        setResources(Array.isArray(resourcesData) ? resourcesData : resourcesData.containers || [])
      } else {
        setResources([])
      }
    } catch {
      setError(t('containersApp.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 8_000)
    return () => window.clearInterval(timer)
  }, [load])

  const resourceByContainer = useMemo(() => {
    const map = new Map<string, ContainerResource>()
    for (const resource of resources) {
      map.set(resource.container_name, resource)
      if (resource.app_id) map.set(resource.app_id, resource)
    }
    return map
  }, [resources])

  const runAction = async (app: SupervisorApp, action: 'start' | 'stop' | 'restart') => {
    setWorking(app.id)
    try {
      const response = await authFetch(`/api/supervisor/apps/${app.id}/${action}`, { method: 'POST' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      toast.success(t(`containersApp.actionDone.${action}`, { name: app.name }))
      await load()
    } catch {
      toast.error(t('containersApp.actionFailed'))
    } finally {
      setWorking(null)
    }
  }

  const filtered = apps.filter((app) => {
    if (filter === 'running') return app.status === 'running'
    if (filter === 'stopped') return app.status !== 'running'
    return true
  })

  const runningCount = apps.filter((app) => app.status === 'running').length

  return (
    <section className="ora-app-frame mx-auto max-w-7xl overflow-hidden">
      <OsAppNavbar
        pageId="os-containers"
        title={t('os.apps.containers.name')}
        description={t('os.apps.containers.description')}
        icon={<Cube size={24} weight="duotone" />}
        accent="oklch(0.63 0.15 265)"
        trailing={
          <button type="button" onClick={() => void load()} disabled={loading} className="ora-icon-button" title={t('containersApp.refresh')}>
            <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        }
      />

      <div className="p-4 pb-10 sm:p-6">
      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-foreground/6 p-1">
          {(['all', 'running', 'stopped'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => setFilter(kind)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filter === kind ? 'bg-accent text-white' : 'text-foreground/55 hover:text-foreground'}`}>
              {t(`containersApp.filter.${kind}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Summary icon={Cube} label={t('containersApp.total')} value={String(apps.length)} />
        <Summary icon={Play} label={t('containersApp.running')} value={String(runningCount)} />
        <Summary icon={Square} label={t('containersApp.stopped')} value={String(apps.length - runningCount)} />
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((app) => {
          const resource = resourceByContainer.get(app.name) || resourceByContainer.get(app.id)
          const running = app.status === 'running'
          const cpu = resource?.cpu_usage_percent ?? 0
          const memory = resource?.memory_usage_percent ?? 0
          const ports = (app.ports || [])
            .map((port) => typeof port === 'string' ? port : `${port.external}:${port.internal}/${port.protocol}`)
            .join(', ')
          return (
            <article key={app.id} className={`ora-card rounded-3xl p-5 ${running ? 'border-emerald-400/15' : ''}`}>
              <div className="flex items-start gap-3">
                <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${running ? 'bg-emerald-500/10 text-emerald-300' : 'bg-foreground/7 text-foreground/45'}`}>
                  {app.icon ? <img src={app.icon} alt="" className="size-6 object-contain" /> : <Cube size={20} weight="duotone" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate font-semibold">{app.name}</h3>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${statusColor(app.status)}`}>
                      {app.status === 'running' ? t('containersApp.status.running') : app.status === 'stopped' ? t('containersApp.status.stopped') : app.status}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-foreground/40">{app.id}{app.version ? ` · v${app.version}` : ''}</p>
                </div>
              </div>

              {ports && <p className="mt-3 truncate text-[11px] text-foreground/45">{ports}</p>}

              {running && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-foreground/40"><span>{t('containersApp.cpu')}</span><span>{cpu.toFixed(1)}%</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(cpu, 100)}%` }} /></div>
                  </div>
                  <div>
                    <div className="mb-1 flex justify-between text-[10px] text-foreground/40"><span>{t('containersApp.memory')}</span><span>{formatBytes(resource?.memory_usage_bytes || 0)}</span></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.min(memory, 100)}%` }} /></div>
                  </div>
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                {running ? (
                  <button type="button" disabled={working === app.id} onClick={() => void runAction(app, 'stop')} className="ora-secondary-button !py-2"><Stop size={14} />{t('containersApp.stop')}</button>
                ) : (
                  <button type="button" disabled={working === app.id} onClick={() => void runAction(app, 'start')} className="ora-primary-button !py-2"><Play size={14} />{t('containersApp.start')}</button>
                )}
                {running && (
                  <button type="button" disabled={working === app.id} onClick={() => void runAction(app, 'restart')} className="ora-secondary-button !py-2">
                    <ArrowClockwise size={14} />{t('containersApp.restart')}
                  </button>
                )}
                {working === app.id && <CircleNotch size={14} className="animate-spin text-foreground/40" />}
              </div>
            </article>
          )
        })}
        {!loading && filtered.length === 0 && (
          <div className="ora-card col-span-full rounded-3xl p-8 text-center text-sm text-foreground/40">{t('containersApp.empty')}</div>
        )}
      </div>
      </div>
    </section>
  )
}

function Summary({ icon: Icon, label, value }: { icon: typeof Cube; label: string; value: string }) {
  return <div className="ora-card rounded-2xl p-4"><Icon size={20} className="text-accent" /><p className="mt-3 text-xl font-semibold">{value}</p><p className="text-xs text-foreground/40">{label}</p></div>
}
