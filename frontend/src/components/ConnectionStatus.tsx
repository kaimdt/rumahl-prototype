import { motion, AnimatePresence } from 'motion/react'
import { Warning, WifiSlash, CheckCircle, Terminal, ArrowClockwise, Plug, House, Cpu, ShieldCheck } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'
import { useConnection } from '@/contexts/ConnectionContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'
import { RumahlMark } from '@/components/RumahlMark'

export function ConnectionStatus() {
  const { t } = useTranslation()
  const { backend, homeAssistant, devBridge, haConfigured } = useConnection()
  const { currentPageId } = usePageNavigation()

  const showBackendError = backend === 'error' || backend === 'disconnected'
  // HA banner: only when HA is VERIFIED as configured (haConfigured === true)
  // and only on the Home page — never globally, never on fresh installs where
  // the backend hasn't reported a config yet (null).
  const showHAError = haConfigured === true && homeAssistant === 'error' && currentPageId === 'home'
  const showDevBridge = devBridge === 'connected'

  if (!showBackendError && !showHAError && !showDevBridge) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[max(4.5rem,env(safe-area-inset-bottom))] z-[76] flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border border-destructive/30 bg-background/90 px-4 py-2 text-xs font-medium text-foreground shadow-xl backdrop-blur-xl">
        <WifiSlash size={15} weight="fill" className="shrink-0 text-destructive" />
        <span className="truncate">{t('connection.backendUnavailable')}</span>
      </div>
    </div>
  )
}

/**
 * Full-screen overlay when the backend is completely unavailable.
 * Richer illustration with live status for the backend + Home Assistant, a
 * troubleshooting checklist and a manual retry.
 */
export function BackendUnavailableOverlay() {
  const { t } = useTranslation()
  const { backend, checkBackend } = useConnection()

  if (backend !== 'error') {
    return null
  }

  const backendOk = backend === 'connected'

  const StatusChip = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="flex items-center gap-2.5 rounded-xl border border-foreground/8 bg-foreground/[0.03] px-3.5 py-2.5">
      <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-destructive/15 text-destructive'}`}>
        {ok ? <CheckCircle size={14} weight="bold" /> : <Warning size={14} weight="bold" />}
      </span>
      <span className="text-sm text-foreground/80">{label}</span>
      <span className={`ml-auto text-xs font-semibold ${ok ? 'text-emerald-400' : 'text-foreground/45'}`}>
        {ok ? t('connection.online') : t('connection.offline')}
      </span>
    </div>
  )

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex items-center justify-center overflow-y-auto py-8"
      >
        <div className="text-center space-y-7 w-[min(30rem,calc(100vw-2rem))] px-6">
          {/* Brand mark */}
          <div className="flex items-center justify-center gap-2 text-foreground/70">
            <RumahlMark className="h-6" />
            <span className="text-sm font-semibold tracking-[0.12em]">rumahl OS</span>
          </div>

          {/* Breathing ring behind icon */}
          <div className="relative mx-auto flex items-center justify-center">
            <div
              className="absolute w-32 h-32 rounded-full breathe-ring"
              style={{ background: 'radial-gradient(circle, oklch(from var(--destructive) l c h / 0.16) 0%, transparent 70%)' }}
            />
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
              className="grid h-24 w-24 place-items-center rounded-3xl border border-destructive/25 bg-destructive/8"
            >
              <WifiSlash size={46} weight="fill" className="text-destructive" />
            </motion.div>
          </div>

          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground mb-2">
              {t('connection.backendUnavailableTitle')}
            </h2>
            <p className="mx-auto max-w-md text-foreground/55 leading-relaxed">
              {t('connection.backendUnavailableDesc')}
            </p>
          </div>

          {/* Live status */}
          <div className="space-y-2.5 text-left">
            <StatusChip ok={backendOk} label={t('connection.backend')} />
          </div>

          {/* Troubleshooting */}
          <div className="glass-card rounded-2xl p-5 text-left">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground/85 mb-3">
              <ShieldCheck size={16} className="text-accent" />
              {t('connection.troubleshoot')}
            </p>
            <ul className="space-y-2.5 text-sm text-foreground/60">
              {[
                { icon: Cpu, label: t('connection.troubleService') },
                { icon: House, label: t('connection.troubleNetwork') },
                { icon: Terminal, label: t('connection.troubleBackend') },
              ].map((item) => (
                <li key={item.label} className="flex items-start gap-2.5">
                  <item.icon size={15} className="mt-0.5 shrink-0 text-foreground/40" />
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Retry */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void checkBackend() }}
              className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-accent/90"
            >
              <ArrowClockwise size={16} weight="bold" />
              {t('connection.retry')}
            </button>
            <motion.span
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="text-xs text-foreground/40"
            >
              {t('connection.autoReconnect')}
            </motion.span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
