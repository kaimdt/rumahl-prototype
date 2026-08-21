import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Info, Cpu, Memory, HardDrive, Pulse, Clock } from '@phosphor-icons/react'
import { OsAppNavbar } from '@/components/OsAppNavbar'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { useRealtime } from '@/hooks/useRealtime'
import { cachedGet } from '@/lib/apiCache'

interface OsInfo {
  hostname: string
  os_name: string
  os_version: string
  kernel_version: string
  cpu_usage_percent: number
  memory_total_bytes: number
  memory_used_bytes: number
  uptime_seconds: number
}

interface SystemStats {
  cpu: { cores: number; usage_percent: number }
  backend: { version: string }
}

interface SystemStatsData {
  cpu_usage_percent: number
  cpu_cores: number
  memory_total_bytes: number
  memory_used_bytes: number
  uptime_seconds: number
}

function formatBytes(value = 0) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const mins = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

/**
 * OsInfoApp — a Windows-About-style system info page available to every user
 * (device name, operating system, kernel, CPU, RAM, uptime).
 */
export function OsInfoApp() {
  const { t } = useTranslation()
  const [os, setOs] = useState<OsInfo | null>(null)
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [loading, setLoading] = useState(true)
  const realtime = useRealtime<SystemStatsData>('system_stats')

  const load = useCallback(async () => {
    try {
      const [osRes, statsRes] = await Promise.all([
        cachedGet('/api/os/control/system', 15000),
        cachedGet('/api/system/stats', 8000),
      ])
      if (osRes.ok) setOs(await osRes.json())
      if (statsRes.ok) setStats(await statsRes.json())
    } catch {
      // info is best-effort
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll OS info only while the tab is visible; real-time values arrive over WS.
  useVisibleInterval(load, 60_000)

  const rows: Array<{ icon: typeof Info; label: string; value: string }> = [
    { icon: Info, label: t('settings.deviceName'), value: os?.hostname || '–' },
    { icon: Info, label: t('settings.operatingSystem'), value: os ? `${os.os_name} ${os.os_version}` : '–' },
    { icon: Info, label: t('settings.kernel'), value: os?.kernel_version || '–' },
    { icon: Cpu, label: t('settings.processor'), value: `${realtime?.cpu_cores ?? stats?.cpu.cores ?? '–'} ${t('settings.cores')} · ${Math.round(realtime?.cpu_usage_percent ?? os?.cpu_usage_percent ?? 0)}%` },
    { icon: Memory, label: t('settings.memory'), value: `${formatBytes(realtime?.memory_used_bytes ?? os?.memory_used_bytes ?? 0)} / ${formatBytes(realtime?.memory_total_bytes ?? os?.memory_total_bytes ?? 0)}` },
    { icon: Clock, label: t('settings.uptime'), value: formatUptime(realtime?.uptime_seconds ?? os?.uptime_seconds ?? 0) },
    { icon: Pulse, label: t('settings.backendVersion'), value: stats?.backend?.version ? `v${stats.backend.version}` : '–' },
  ]

  return (
    <section className="rumahl-app-frame mx-auto max-w-4xl overflow-hidden">
      <OsAppNavbar
        pageId="os-info"
        title={t('settings.about')}
        description={t('settings.aboutDesc')}
        icon={<Info size={24} weight="duotone" />}
        accent="oklch(0.67 0.16 205)"
      />
      <div className="p-4 sm:p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-foreground/20 border-t-accent" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-foreground/8 bg-foreground/[0.03] divide-y divide-foreground/6">
            {rows.map((row) => {
              const Icon = row.icon
              return (
                <div key={row.label} className="flex items-center gap-3 px-4 py-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                    <Icon size={18} weight="duotone" />
                  </span>
                  <span className="text-sm text-foreground/55">{row.label}</span>
                  <span className="ml-auto min-w-0 truncate text-right text-sm font-medium text-foreground">{row.value}</span>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-4 flex items-center gap-2 text-xs text-foreground/40">
          <HardDrive size={14} className="shrink-0" />
          {t('settings.aboutDesc')}
        </p>
      </div>
    </section>
  )
}
