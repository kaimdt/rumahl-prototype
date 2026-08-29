import {
  ArrowClockwise,
  CheckCircle,
  CirclesFour,
  Database,
  Desktop,
  GearSix,
  HardDrives,
  Lifebuoy,
  ListBullets,
  MagnifyingGlass,
  ShieldCheck,
  Users,
  WifiHigh,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

interface DesktopAdminCenterProps {
  healthStatus?: string
  version?: string
  servicesUp: number | null
  onOpenApp: (pageId: string) => void
}

const chartData = [
  62, 57, 64, 48, 56, 70, 76, 63, 54, 58, 75, 69, 67, 84, 65, 73, 82, 66, 58, 69, 61, 63, 78, 75, 65, 73, 68, 84,
].map((value, index) => ({ time: ['23:18', '23:33', '23:48', '00:03', '00:18'][Math.floor(index / 7)] || '00:18', value }))

const serviceRows = [
  { name: 'rumahl OS Core', detail: 'Core system services', cpu: '2.1%', memory: '512 MB', uptime: '23h 41m', color: '#635bff' },
  { name: 'rumahl Drive', detail: 'File sync and sharing', cpu: '1.3%', memory: '256 MB', uptime: '23h 40m', color: '#27a8d7' },
  { name: 'Media Indexer', detail: 'Media scanning service', cpu: '0.7%', memory: '128 MB', uptime: '23h 39m', color: '#48a66b' },
  { name: 'Network Manager', detail: 'Network and connectivity', cpu: '0.4%', memory: '64 MB', uptime: '23h 41m', color: '#677487' },
  { name: 'Security Monitor', detail: 'System protection', cpu: '0.6%', memory: '96 MB', uptime: '23h 41m', color: '#7a78a8' },
]

const navGroups = [
  {
    label: 'adminCenter.desktop.system',
    items: [
      { label: 'os.apps.services.name', icon: GearSix, pageId: 'os-services' },
      { label: 'os.apps.storage.name', icon: HardDrives, pageId: 'os-storage' },
      { label: 'os.apps.network.name', icon: WifiHigh, pageId: 'os-network' },
      { label: 'adminCenter.desktop.users', icon: Users, pageId: 'admin' },
      { label: 'os.apps.devices.name', icon: Desktop, pageId: 'os-devices' },
    ],
  },
  {
    label: 'adminCenter.desktop.preferences',
    items: [
      { label: 'os.apps.updates.name', icon: ArrowClockwise, pageId: 'os-updates' },
      { label: 'os.apps.backups.name', icon: Database, pageId: 'os-backups' },
      { label: 'os.apps.logs.name', icon: ListBullets, pageId: 'os-logs' },
    ],
  },
]

export function DesktopAdminCenter({ healthStatus, version, servicesUp, onOpenApp }: DesktopAdminCenterProps) {
  const { t } = useTranslation()
  const isHealthy = !healthStatus || healthStatus === 'ok'

  return (
    <div className="rumahl-desktop-admin">
      <aside className="rumahl-desktop-admin-side">
        <button type="button" className="is-active" onClick={() => onOpenApp('admin')}>
          <CirclesFour size={17} weight="duotone" />
          {t('adminCenter.desktop.overview')}
        </button>
        {navGroups.map((group) => (
          <section key={group.label}>
            <p>{t(group.label)}</p>
            {group.items.map((item) => {
              const Icon = item.icon
              return <button type="button" key={item.label} onClick={() => onOpenApp(item.pageId)}><Icon size={17} />{t(item.label)}</button>
            })}
          </section>
        ))}
        <button type="button" className="rumahl-desktop-admin-support"><Lifebuoy size={17} />{t('adminCenter.desktop.support')}</button>
      </aside>

      <main className="rumahl-desktop-admin-main">
        <header className="rumahl-desktop-admin-search">
          <MagnifyingGlass size={15} />
          <span>{t('adminCenter.desktop.search')}</span>
          <kbd>Ctrl F</kbd>
        </header>

        <div className="rumahl-desktop-admin-scroll">
          <section className="rumahl-desktop-health">
            <CheckCircle size={27} weight="duotone" className={isHealthy ? 'text-violet-400' : 'text-amber-400'} />
            <div>
              <h1>{isHealthy ? t('adminCenter.desktop.healthy') : t('adminCenter.desktop.attention')}</h1>
              <p>{t('adminCenter.desktop.release', { version: version || '10.0' })}</p>
              <p>{t('adminCenter.desktop.lastChecked')}</p>
            </div>
            <button type="button"><ShieldCheck size={15} weight="duotone" />{t('adminCenter.desktop.diagnostics')}</button>
          </section>

          <section className="rumahl-desktop-panel rumahl-performance-panel">
            <div className="rumahl-desktop-panel-head">
              <strong>{t('adminCenter.desktop.performance')}</strong>
              <div><span className="is-active">1H</span><span>6H</span><span>24H</span><button type="button">{t('adminCenter.desktop.cpuUsage')}</button></div>
            </div>
            <div className="rumahl-performance-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 6, bottom: 0, left: -24 }}>
                  <defs>
                    <linearGradient id="rumahlAdminCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#7467ff" stopOpacity={0.26} />
                      <stop offset="100%" stopColor="#7467ff" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 10 }} unit="%" />
                  <XAxis dataKey="time" interval={6} axisLine={false} tickLine={false} tick={{ fill: 'rgba(255,255,255,.34)', fontSize: 10 }} />
                  <Tooltip contentStyle={{ background: '#17171f', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8, fontSize: 11 }} />
                  <Area type="linear" dataKey="value" stroke="#7668ff" strokeWidth={2.3} fill="url(#rumahlAdminCpu)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="rumahl-services-heading"><strong>{t('adminCenter.desktop.services')}</strong><span>{servicesUp == null ? t('adminCenter.checking') : t('adminCenter.desktop.runningCount', { count: servicesUp })}</span></div>
          <section className="rumahl-desktop-panel rumahl-services-table">
            <div className="rumahl-service-row rumahl-service-header"><span>{t('adminCenter.desktop.name')}</span><span>{t('adminCenter.desktop.status')}</span><span>CPU</span><span>{t('adminCenter.desktop.memory')}</span><span>{t('adminCenter.desktop.uptime')}</span></div>
            {serviceRows.map((service) => (
              <div className="rumahl-service-row" key={service.name}>
                <span className="rumahl-service-name"><i style={{ background: service.color }}><GearSix size={14} weight="duotone" /></i><span><b>{service.name}</b><small>{service.detail}</small></span></span>
                <span className="rumahl-service-running"><i />{t('adminCenter.desktop.running')}</span>
                <span>{service.cpu}</span><span>{service.memory}</span><span>{service.uptime}</span>
              </div>
            ))}
          </section>
          <footer><span>{t('adminCenter.desktop.serviceSummary')}</span><button type="button" onClick={() => onOpenApp('os-services')}>{t('adminCenter.desktop.viewAll')}</button></footer>
        </div>
      </main>
    </div>
  )
}
