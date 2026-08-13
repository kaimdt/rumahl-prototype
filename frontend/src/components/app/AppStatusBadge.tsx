import { useTranslation } from 'react-i18next'
import { normalizeRuntimeState, type AppRuntimeState } from '@/lib/appSystem'

const STATUS_STYLES: Record<AppRuntimeState, string> = {
  running: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
  starting: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  stopped: 'border-foreground/10 bg-foreground/[0.05] text-foreground/55',
  failed: 'border-red-400/20 bg-red-400/10 text-red-300',
  unhealthy: 'border-orange-400/20 bg-orange-400/10 text-orange-300',
  not_found: 'border-foreground/10 bg-foreground/[0.05] text-foreground/45',
}

const STATUS_DOTS: Record<AppRuntimeState, string> = {
  running: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]',
  starting: 'animate-pulse bg-amber-400',
  stopped: 'bg-foreground/30',
  failed: 'bg-red-400',
  unhealthy: 'bg-orange-400',
  not_found: 'bg-foreground/25',
}

export function AppStatusBadge({ status, compact = false }: { status?: string | null; compact?: boolean }) {
  const { t } = useTranslation()
  const normalized = normalizeRuntimeState(status)

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${STATUS_STYLES[normalized]} ${compact ? 'px-2 py-0.5 text-[9px]' : 'px-2.5 py-1 text-[10px]'}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOTS[normalized]}`} aria-hidden="true" />
      {t(`apps.lifecycle.${normalized}`)}
    </span>
  )
}
