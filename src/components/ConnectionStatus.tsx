import { motion, AnimatePresence } from 'framer-motion'
import { Warning, WifiSlash, CheckCircle } from '@phosphor-icons/react'
import { useConnection } from '@/contexts/ConnectionContext'

export function ConnectionStatus() {
  const { backend, homeAssistant } = useConnection()

  const showBackendError = backend === 'error' || backend === 'disconnected'
  const showHAError = homeAssistant === 'error' || homeAssistant === 'disconnected'

  if (!showBackendError && !showHAError) {
    return null
  }

  return (
    <AnimatePresence>
      {(showBackendError || showHAError) && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed top-4 right-4 z-50 flex flex-col gap-2"
        >
          {showBackendError && (
            <motion.div
              className="glass-card px-4 py-3 rounded-lg border border-destructive/20 bg-destructive/10 backdrop-blur-xl"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <div className="flex items-center gap-3">
                <Warning size={20} weight="fill" className="text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Backend nicht erreichbar
                  </p>
                  <p className="text-xs text-destructive/80">
                    Verbindung wird wiederhergestellt...
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          {showHAError && (
            <motion.div
              className="glass-card px-4 py-3 rounded-lg border border-destructive/20 bg-destructive/10 backdrop-blur-xl"
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
            >
              <div className="flex items-center gap-3">
                <WifiSlash size={20} weight="fill" className="text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Home Assistant nicht erreichbar
                  </p>
                  <p className="text-xs text-destructive/80">
                    Prüfe deine Verbindung
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
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
