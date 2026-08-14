import { motion, AnimatePresence } from 'motion/react'
import { Warning, WifiSlash, CheckCircle, Terminal } from '@phosphor-icons/react'
import { useConnection } from '@/contexts/ConnectionContext'
import { usePageNavigation } from '@/contexts/PageNavigationContext'

export function ConnectionStatus() {
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
        <span className="truncate">Backend nicht erreichbar — Apps derzeit nicht verfügbar</span>
      </div>
    </div>
  )
}

/**
 * Full-screen overlay when backend is completely unavailable
 */
export function BackendUnavailableOverlay() {
  const { backend } = useConnection()

  if (backend !== 'error') {
    return null
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background/95 backdrop-blur-xl flex items-center justify-center"
      >
        <div className="text-center space-y-6 max-w-md px-6">
          {/* Breathing ring behind icon */}
          <div className="relative flex items-center justify-center">
            <div
              className="absolute w-28 h-28 rounded-full breathe-ring"
              style={{ background: 'radial-gradient(circle, oklch(from var(--destructive) l c h / 0.15) 0%, transparent 70%)' }}
            />
            <motion.div
              animate={{
                scale: [1, 1.05, 1],
              }}
              transition={{
                duration: 3,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <WifiSlash size={64} weight="fill" className="text-destructive" />
            </motion.div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">
              Backend nicht erreichbar
            </h2>
            <p className="text-foreground/60 leading-relaxed">
              Die Verbindung zum Backend konnte nicht hergestellt werden.
              Alle Funktionen sind vorübergehend nicht verfügbar.
            </p>
          </div>

          <div className="glass-card p-4 rounded-xl">
            <p className="text-sm text-foreground/80 font-medium mb-2">
              Bitte überprüfe:
            </p>
            <ul className="text-sm text-foreground/60 text-left space-y-1.5">
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-foreground/30 shrink-0" />
                Home Assistant ist gestartet
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-foreground/30 shrink-0" />
                Netzwerkverbindung ist aktiv
              </li>
              <li className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-foreground/30 shrink-0" />
                Backend-Konfiguration ist korrekt
              </li>
            </ul>
          </div>

          <motion.div
            animate={{ opacity: [0.3, 0.8, 0.3] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="text-xs text-foreground/40 tracking-wide"
          >
            Automatische Neuverbindung...
          </motion.div>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
