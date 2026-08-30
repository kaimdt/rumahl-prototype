import { useMemo, useState, type ReactNode } from 'react'
import { ArrowClockwise, CheckCircle, CirclesFour, Cube, Database, Desktop, GearSix, HardDrives, Heartbeat, ListBullets, MagnifyingGlass, ShieldCheck, Users, WifiHigh } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

export type DesktopAdminSection = 'overview' | 'services' | 'storage' | 'network' | 'devices' | 'containers' | 'logs' | 'system' | 'updates' | 'backups' | 'users'

export interface DesktopServiceSummary {
  name: string
  description?: string
  active?: string
  sub?: string
}

interface DesktopAdminCenterProps {
  activeSection: DesktopAdminSection
  healthStatus?: string
  version?: string
  services: DesktopServiceSummary[]
  checkedAt?: Date | null
  content?: ReactNode
  onSelectSection: (section: DesktopAdminSection) => void
  onRefresh: () => void
}

const navGroups: Array<{ label: string; items: Array<{ section: DesktopAdminSection; label: string; icon: typeof GearSix }> }> = [
  {
    label: 'adminCenter.desktop.system',
    items: [
      { section: 'services', label: 'os.apps.services.name', icon: GearSix },
      { section: 'storage', label: 'os.apps.storage.name', icon: HardDrives },
      { section: 'network', label: 'os.apps.network.name', icon: WifiHigh },
      { section: 'devices', label: 'os.apps.devices.name', icon: Desktop },
      { section: 'containers', label: 'os.apps.containers.name', icon: Cube },
      { section: 'system', label: 'os.apps.system.name', icon: Heartbeat },
    ],
  },
  {
    label: 'adminCenter.desktop.preferences',
    items: [
      { section: 'updates', label: 'os.apps.updates.name', icon: ArrowClockwise },
      { section: 'backups', label: 'os.apps.backups.name', icon: Database },
      { section: 'logs', label: 'os.apps.logs.name', icon: ListBullets },
      { section: 'users', label: 'adminCenter.desktop.users', icon: Users },
    ],
  },
]

export function DesktopAdminCenter({ activeSection, healthStatus, version, services, checkedAt, content, onSelectSection, onRefresh }: DesktopAdminCenterProps) {
  const { t, i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const runningServices = services.filter((service) => service.active === 'active' && service.sub === 'running')
  const failedServices = services.filter((service) => service.active === 'failed')
  const healthKnown = Boolean(healthStatus)
  const isHealthy = healthStatus === 'ok' && failedServices.length === 0
  const normalizedQuery = query.trim().toLocaleLowerCase(i18n.language)
  const visibleGroups = useMemo(() => navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !normalizedQuery || t(item.label).toLocaleLowerCase(i18n.language).includes(normalizedQuery)),
  })).filter((group) => group.items.length > 0), [i18n.language, normalizedQuery, t])

  return (
    <div className="rumahl-desktop-admin" data-admin-section={activeSection}>
      <aside className="rumahl-desktop-admin-side" aria-label={t('adminCenter.title')}>
        <button type="button" className={activeSection === 'overview' ? 'is-active' : ''} onClick={() => onSelectSection('overview')}>
          <CirclesFour size={17} weight="duotone" />{t('adminCenter.desktop.overview')}
        </button>
        {visibleGroups.map((group) => (
          <section key={group.label}>
            <p>{t(group.label)}</p>
            {group.items.map((item) => {
              const Icon = item.icon
              return <button type="button" key={item.section} className={activeSection === item.section ? 'is-active' : ''} aria-current={activeSection === item.section ? 'page' : undefined} onClick={() => onSelectSection(item.section)}><Icon size={17} />{t(item.label)}</button>
            })}
          </section>
        ))}
      </aside>

      <main className="rumahl-desktop-admin-main">
        <label className="rumahl-desktop-admin-search">
          <MagnifyingGlass size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('adminCenter.desktop.search')} />
          <kbd>Ctrl F</kbd>
        </label>

        {activeSection === 'overview' ? (
          <div className="rumahl-desktop-admin-scroll">
            <section className="rumahl-desktop-health" data-state={!healthKnown ? 'checking' : isHealthy ? 'healthy' : 'attention'}>
              {isHealthy ? <CheckCircle size={27} weight="duotone" /> : <ShieldCheck size={27} weight="duotone" />}
              <div>
                <h1>{!healthKnown ? t('adminCenter.checking') : isHealthy ? t('adminCenter.desktop.healthy') : t('adminCenter.desktop.attention')}</h1>
                <p>{t('adminCenter.desktop.release', { version: version || '–' })}</p>
                <p>{checkedAt ? t('adminCenter.desktop.lastCheckedAt', { time: checkedAt.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) }) : t('adminCenter.desktop.notChecked')}</p>
              </div>
              <button type="button" onClick={onRefresh}><ArrowClockwise size={15} />{t('adminCenter.desktop.checkNow')}</button>
            </section>

            <div className="rumahl-admin-overview-stats">
              <article><strong>{services.length || '–'}</strong><span>{t('adminCenter.desktop.services')}</span></article>
              <article><strong>{runningServices.length}</strong><span>{t('adminCenter.desktop.running')}</span></article>
              <article data-warning={failedServices.length > 0 ? 'true' : 'false'}><strong>{failedServices.length}</strong><span>{t('adminCenter.desktop.failed')}</span></article>
            </div>

            <div className="rumahl-services-heading"><strong>{t('adminCenter.desktop.services')}</strong><span>{t('adminCenter.desktop.runningCount', { count: runningServices.length })}</span></div>
            <section className="rumahl-desktop-panel rumahl-services-table">
              <div className="rumahl-service-row rumahl-service-header"><span>{t('adminCenter.desktop.name')}</span><span>{t('adminCenter.desktop.status')}</span><span>{t('adminCenter.desktop.subState')}</span></div>
              {services.slice(0, 8).map((service) => (
                <div className="rumahl-service-row" key={service.name}>
                  <span className="rumahl-service-name"><i><GearSix size={14} weight="duotone" /></i><span><b>{service.name}</b><small>{service.description || t('adminCenter.desktop.systemService')}</small></span></span>
                  <span className={service.active === 'active' ? 'rumahl-service-running' : 'rumahl-service-stopped'}><i />{service.active || '–'}</span>
                  <span>{service.sub || '–'}</span>
                </div>
              ))}
              {services.length === 0 && <p className="rumahl-admin-empty">{t('adminCenter.desktop.noServiceData')}</p>}
            </section>
            <footer><span>{t('adminCenter.desktop.serviceSummaryDynamic', { running: runningServices.length, total: services.length })}</span><button type="button" onClick={() => onSelectSection('services')}>{t('adminCenter.desktop.viewAll')}</button></footer>
          </div>
        ) : <div className="rumahl-desktop-admin-content">{content}</div>}
      </main>
    </div>
  )
}
