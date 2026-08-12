import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowClockwise, CircleNotch, Play, Power, Square, Triangle } from '@phosphor-icons/react'
import { authFetch } from '@/lib/authHelpers'
import { OsWindowActions } from '@/components/OsWindowActions'
import { toast } from 'sonner'

interface SystemdService {
  name: string
  load: string
  active: string
  sub: string
  description?: string
}

function isRunning(service: SystemdService) {
  return service.active === 'active' && service.sub === 'running'
}

function statusBadge(service: SystemdService) {
  if (isRunning(service)) return 'bg-emerald-500/10 text-emerald-300'
  if (service.active === 'failed') return 'bg-red-500/10 text-red-300'
  if (service.active === 'activating') return 'bg-amber-500/10 text-amber-300'
  return 'bg-foreground/8 text-foreground/45'
}

export function OsServicesApp() {
  const { t } = useTranslation()
  const [services, setServices] = useState<SystemdService[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'running' | 'inactive' | 'failed'>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await authFetch('/api/os/control/os/services')
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setServices(data.services || [])
    } catch {
      setError(t('servicesApp.unavailable'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { void load() }, 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  const runAction = async (service: SystemdService, action: 'start' | 'stop' | 'restart') => {
    setWorking(service.name)
    try {
      const response = await authFetch(`/api/os/control/os/services/${encodeURIComponent(service.name)}/${action}`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${response.status}`)
      }
      toast.success(t(`servicesApp.actionDone.${action}`, { name: service.name }))
      await load()
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : t('servicesApp.actionFailed'))
    } finally {
      setWorking(null)
    }
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return services.filter((service) => {
      if (filter === 'running' && !isRunning(service)) return false
      if (filter === 'inactive' && (isRunning(service) || service.active === 'failed')) return false
      if (filter === 'failed' && service.active !== 'failed') return false
      if (query && !service.name.toLowerCase().includes(query) && !(service.description || '').toLowerCase().includes(query)) return false
      return true
    })
  }, [services, filter, search])

  const runningCount = services.filter(isRunning).length
  const failedCount = services.filter((service) => service.active === 'failed').length

  return (
    <section className="ora-app-frame mx-auto max-w-7xl p-4 pb-10 sm:p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground/40">ORA OS</p>
          <h1 className="mt-1 text-3xl font-semibold">{t('servicesApp.title')}</h1>
          <p className="mt-1 text-sm text-foreground/45">{t('servicesApp.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} className="glass-card rounded-full p-3" title={t('servicesApp.refresh')}>
            <ArrowClockwise size={18} className={loading ? 'animate-spin' : ''} />
          </button>
          <OsWindowActions pageId="os-services" />
        </div>
      </header>

      {error && <div className="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Summary icon={Power} label={t('servicesApp.total')} value={String(services.length)} />
        <Summary icon={Play} label={t('servicesApp.running')} value={String(runningCount)} />
        <Summary icon={Square} label={t('servicesApp.inactive')} value={String(services.length - runningCount - failedCount)} />
        <Summary icon={Triangle} label={t('servicesApp.failed')} value={String(failedCount)} warning={failedCount > 0} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-foreground/6 p-1">
          {(['all', 'running', 'inactive', 'failed'] as const).map((kind) => (
            <button key={kind} type="button" onClick={() => setFilter(kind)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filter === kind ? 'bg-accent text-white' : 'text-foreground/55 hover:text-foreground'}`}>
              {t(`servicesApp.filter.${kind}`)}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('servicesApp.search')}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-foreground/5 px-3 py-2 text-xs outline-none focus:border-accent/40 sm:max-w-xs"
        />
      </div>

      <div className="space-y-2">
        {filtered.map((service) => {
          const running = isRunning(service)
          return (
            <article key={service.name} className={`glass-card rounded-2xl p-4 ${running ? 'border-emerald-400/10' : ''}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${statusBadge(service)}`}>
                  {t(`servicesApp.state.${service.active}`)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-medium">{service.name}</p>
                  {service.description && <p className="truncate text-[11px] text-foreground/45">{service.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!running && service.active !== 'failed' && (
                    <button type="button" disabled={working === service.name} onClick={() => void runAction(service, 'start')} className="ora-primary-button !py-2">
                      <Play size={14} />{t('servicesApp.start')}
                    </button>
                  )}
                  {running && (
                    <button type="button" disabled={working === service.name} onClick={() => void runAction(service, 'stop')} className="ora-secondary-button !py-2">
                      <Square size={13} />{t('servicesApp.stop')}
                    </button>
                  )}
                  <button type="button" disabled={working === service.name} onClick={() => void runAction(service, 'restart')} className="ora-secondary-button !py-2">
                    <ArrowClockwise size={14} />{t('servicesApp.restart')}
                  </button>
                  {working === service.name && <CircleNotch size={14} className="animate-spin text-foreground/40" />}
                </div>
              </div>
            </article>
          )
        })}
        {!loading && filtered.length === 0 && <p className="py-8 text-center text-sm text-foreground/40">{t('servicesApp.empty')}</p>}
      </div>
    </section>
  )
}

function Summary({ icon: Icon, label, value, warning = false }: { icon: typeof Power; label: string; value: string; warning?: boolean }) {
  return <div className="glass-card rounded-2xl p-4"><Icon size={20} className={warning ? 'text-red-400' : 'text-cyan-300'} /><p className="mt-3 text-xl font-semibold">{value}</p><p className="text-xs text-foreground/40">{label}</p></div>
}
